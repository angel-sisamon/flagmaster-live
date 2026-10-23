/**
 * js/firebase-marathon-leaderboard.js — Ranking global de la Maratón (mejores rachas)
 *
 *   marathon_scores/{playerId}   UN documento por jugador (ID = playerId de Play Games)
 *     { playerId, playerName, bestStreak, avatarUrl?, country?, continent?, updatedAt }
 *   marathon_rank/daily · marathon_top1/{playerId}   solo lectura (los escribe la Cloud
 *     Function marathonRankSnapshot): foto del último cierre y días como nº1.
 *
 * • Escritura monótona: solo si bestStreak supera al guardado (lo exigen también las
 *   reglas). Se hace en transacción (leer → comparar → escribir) para no chocar con
 *   la regla cuando otro dispositivo ya subió una racha igual o mayor.
 * • Solo escriben jugadores con PGS; los invitados solo leen.
 * • Idempotente y barato: 'marathon_lb_synced' recuerda {pid, best} ya confirmado →
 *   sin lecturas ni escrituras si no hay mejora. Se reintenta al iniciar sesión en PGS.
 *
 * ORDEN DE CARGA: después de storage.js, play-games.js y firebase-leaderboard.js;
 * antes de main.js. Depende de: storage.js (getMarathonBestStreak), play-games.js.
 */

var MarathonLeaderboard = (function () {

  var COLLECTION   = 'marathon_scores';
  var SYNC_KEY     = 'marathon_lb_synced';
  var NAME_MAX     = 30;
  var CACHE_TTL    = 30000;
  var TIMEOUT_MS   = 10000;

  /* Escritos solo por la Cloud Function marathonRankSnapshot (cierre diario 00:05 UTC) */
  var SNAPSHOT_COLLECTION = 'marathon_rank';
  var TOP1_COLLECTION     = 'marathon_top1';
  var SNAPSHOT_TTL        = 10 * 60 * 1000;

  var _submitting = null;
  var _cache      = null; /* { ts, limit, data } */
  var _snapCache  = null; /* { ts, data } */

  function _db() {
    try {
      if (typeof firebase !== 'undefined' && firebase.firestore) return firebase.firestore();
    } catch (e) {}
    return null;
  }

  function _pgsInfo() {
    try {
      if (typeof PlayGamesService === 'undefined' || !PlayGamesService.isSignedIn()) return null;
      return PlayGamesService.getPlayerInfo() || null;
    } catch (e) { return null; }
  }

  /** playerId de PGS válido como ID de documento (mismo criterio que PlayerProfile), o null. */
  function _pid() {
    var info = _pgsInfo();
    if (!info || info.playerId === null || info.playerId === undefined) return null;
    var id = String(info.playerId);
    if (!id || id.length > 128 || id.indexOf('/') !== -1 ||
        id === '.' || id === '..' || /^__.*__$/.test(id)) return null;
    return id;
  }

  /** Nombre acotado a NAME_MAX unidades UTF-16 (lo que mide string.size() en las reglas). */
  function _cleanName(s) {
    if (typeof s !== 'string') return '';
    var chars = Array.from(s.replace(/[\x00-\x1F\x7F]/g, '').trim());
    var out = '';
    for (var i = 0; i < chars.length && out.length + chars[i].length <= NAME_MAX; i++) out += chars[i];
    return out.trim();
  }

  function _playerName(pid) {
    var info = _pgsInfo();
    var prof = (typeof PlayerProfile !== 'undefined') ? PlayerProfile.getProfile() : null;
    return _cleanName(info && info.displayName) || _cleanName(prof && prof.nickname) ||
      ('Player ' + String(pid).slice(-4));
  }

  function _publicAvatar(url) {
    return (typeof url === 'string' && /^https:\/\/.+$/.test(url) && url.length <= 512) ? url : null;
  }

  function _withTimeout(promise, ms) {
    return Promise.race([promise, new Promise(function (_, reject) {
      setTimeout(function () { reject(new Error('marathon-lb-timeout')); }, ms);
    })]);
  }

  function _loadSynced() {
    var s = storageLoad(SYNC_KEY, null);
    return (s && typeof s === 'object' && typeof s.pid === 'string') ? s : { pid: null, best: -1 };
  }

  /**
   * Sube la mejor racha local si mejora la ya confirmada. Best-effort, nunca lanza.
   * @returns {Promise<boolean>} true si el ranking refleja la mejor racha local
   */
  function submitBest() {
    if (_submitting) return _submitting;
    var pid = _pid();
    var db  = _db();
    var best = (typeof getMarathonBestStreak === 'function') ? getMarathonBestStreak() : 0;
    if (!pid || !db || best <= 0) return Promise.resolve(false);
    var synced = _loadSynced();
    if (synced.pid === pid && synced.best >= best) return Promise.resolve(true);

    var countryP = (typeof FirebaseLeaderboard !== 'undefined' && FirebaseLeaderboard.getPlayerCountry)
      ? FirebaseLeaderboard.getPlayerCountry().catch(function () { return null; })
      : Promise.resolve(null);

    _submitting = countryP.then(function (country) {
      var ref = db.collection(COLLECTION).doc(pid);
      return _withTimeout(db.runTransaction(function (tx) {
        return tx.get(ref).then(function (snap) {
          var remoteBest = snap.exists ? Number(snap.data().bestStreak) || 0 : -1;
          if (remoteBest >= best) return remoteBest;
          var payload = {
            playerId:   pid,
            playerName: _playerName(pid),
            bestStreak: best,
            updatedAt:  firebase.firestore.FieldValue.serverTimestamp()
          };
          var info = _pgsInfo();
          var avatar = _publicAvatar(info && info.avatarUrl);
          if (avatar) payload.avatarUrl = avatar;
          if (typeof country === 'string' && /^[A-Z]{2}$/.test(country)) {
            payload.country = country;
            var cont = (typeof getContinentForCountry === 'function') ? getContinentForCountry(country) : null;
            if (cont) payload.continent = cont;
          }
          tx.set(ref, payload);
          return best;
        });
      }), TIMEOUT_MS);
    }).then(function (confirmed) {
      storageSave(SYNC_KEY, { pid: pid, best: Math.max(best, confirmed) });
      _cache = null;
      console.log('[MarathonLB] ✓ Mejor racha sincronizada:', best);
      return true;
    }).catch(function (err) {
      console.warn('[MarathonLB] ✗ No se pudo subir la racha:', (err && (err.code || err.message)) || err);
      return false;
    }).then(function (ok) {
      _submitting = null;
      return ok;
    });
    return _submitting;
  }

  /**
   * Top global por mejor racha.
   * @param {number} [limit=50]
   * @returns {Promise<Array<{position, playerId, playerName, bestStreak, avatarUrl, country, isMe}>>}
   */
  function getTop(limit) {
    var n = limit || 50;
    var db = _db();
    if (!db) return Promise.reject(new Error('firestore-unavailable'));
    if (_cache && _cache.limit >= n && (Date.now() - _cache.ts) < CACHE_TTL) {
      return Promise.resolve(_cache.data.slice(0, n));
    }
    var me = _pid();
    return _withTimeout(db.collection(COLLECTION).orderBy('bestStreak', 'desc').limit(n).get(), TIMEOUT_MS)
      .then(function (snapshot) {
        var out = [];
        snapshot.forEach(function (doc) {
          var d = doc.data() || {};
          out.push({
            position:   out.length + 1,
            playerId:   doc.id,
            playerName: _cleanName(d.playerName) || '?',
            bestStreak: Math.max(0, Math.floor(Number(d.bestStreak) || 0)),
            avatarUrl:  _publicAvatar(d.avatarUrl),
            country:    (typeof d.country === 'string' && /^[A-Z]{2}$/.test(d.country)) ? d.country : null,
            isMe:       !!me && doc.id === me
          });
        });
        _cache = { ts: Date.now(), limit: n, data: out };
        return out;
      });
  }

  /**
   * Foto del último cierre diario (Cloud Function marathonRankSnapshot) para
   * calcular cuántos puestos ha subido/bajado cada jugador.
   * @returns {Promise<{dateKey, positions:Object<string,number>, holderId, holderSince}|null>}
   *          null si aún no hay ningún cierre (no se muestran indicadores)
   */
  function getDailySnapshot() {
    var db = _db();
    if (!db) return Promise.reject(new Error('firestore-unavailable'));
    if (_snapCache && (Date.now() - _snapCache.ts) < SNAPSHOT_TTL) return Promise.resolve(_snapCache.data);
    return _withTimeout(db.collection(SNAPSHOT_COLLECTION).doc('daily').get(), TIMEOUT_MS)
      .then(function (snap) {
        var d = snap.exists ? (snap.data() || {}) : null;
        var data = (d && d.positions && typeof d.positions === 'object') ? {
          dateKey:     typeof d.dateKey === 'string' ? d.dateKey : null,
          positions:   d.positions,
          holderId:    typeof d.holderId === 'string' ? d.holderId : null,
          holderSince: typeof d.holderSince === 'string' ? d.holderSince : null
        } : null;
        _snapCache = { ts: Date.now(), data: data };
        return data;
      });
  }

  /**
   * Jugadores con más días como nº1 (al cierre diario), como las semanas nº1 del tenis.
   * @param {number} [limit=50]
   * @returns {Promise<Array<{position, playerId, playerName, days, currentRun, longestRun,
   *                          avatarUrl, country, isMe}>>}
   */
  function getTop1(limit) {
    var db = _db();
    if (!db) return Promise.reject(new Error('firestore-unavailable'));
    var me = _pid();
    return _withTimeout(db.collection(TOP1_COLLECTION).orderBy('days', 'desc').limit(limit || 50).get(), TIMEOUT_MS)
      .then(function (snapshot) {
        var out = [];
        snapshot.forEach(function (doc) {
          var d = doc.data() || {};
          out.push({
            position:   out.length + 1,
            playerId:   doc.id,
            playerName: _cleanName(d.playerName) || '?',
            days:       Math.max(0, Math.floor(Number(d.days) || 0)),
            currentRun: Math.max(0, Math.floor(Number(d.currentRun) || 0)),
            longestRun: Math.max(0, Math.floor(Number(d.longestRun) || 0)),
            avatarUrl:  _publicAvatar(d.avatarUrl),
            country:    (typeof d.country === 'string' && /^[A-Z]{2}$/.test(d.country)) ? d.country : null,
            isMe:       !!me && doc.id === me
          });
        });
        return out;
      });
  }

  return {
    submitBest:       submitBest,
    getTop:           getTop,
    getDailySnapshot: getDailySnapshot,
    getTop1:          getTop1,
    isSignedIn: function () { return !!_pid(); }
  };

})();
