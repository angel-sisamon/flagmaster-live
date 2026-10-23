/**
 * js/player-profile.js — Perfil de jugador híbrido: localStorage + Cloud Firestore
 *
 *   players/{playerId}    Documento del jugador (uno por jugador)
 *   friend_codes/{CODE}   Índice inverso código de amigo → playerId (garantiza unicidad)
 *
 * PRINCIPIOS
 *   • Local-first: el juego SIEMPRE lee y escribe en localStorage (storage.js).
 *     Firestore es la copia en la nube (reinstalaciones, otros dispositivos, amigos).
 *   • Una sola lectura por sesión: bootstrap() hace UN get() de players/{id} al
 *     arrancar (o al iniciar sesión en PGS). Después se trabaja con la copia local
 *     y el documento no se vuelve a leer durante la sesión.
 *   • Escrituras coalescidas: cualquier cambio de progreso local (detectado con
 *     onStorageSave de storage.js) marca un flag "dirty" PERSISTENTE y programa un
 *     update() con debounce. Flush inmediato al pasar a segundo plano. Si no hay
 *     red, el flag sobrevive al cierre de la app y se reintenta más tarde.
 *   • Escrituras idempotentes: se envían valores absolutos (no incrementos), así
 *     que un reintento nunca duplica contadores.
 *
 * CASOS AL ARRANCAR (bootstrap)
 *   A — No existe players/{id} y no hay progreso local → alta de jugador nuevo.
 *   B — No existe players/{id} y SÍ hay progreso local → migración: se sube el
 *       progreso local (mapeado) al nuevo documento.
 *   C — Existe players/{id} → se descarga y se fusiona con el local (máximos y
 *       uniones: no se pierde el progreso de ninguno de los dos lados).
 *
 * IDENTIDAD
 *   El ID del documento es el playerId de Google Play Games (estable entre
 *   dispositivos y reinstalaciones), igual que en daily_scores/tournament_scores.
 *   Sin PGS no hay un ID fiable → el invitado juega en local y su progreso se
 *   migra (Caso B) la primera vez que inicia sesión.
 *   Cambio de cuenta en el dispositivo: el progreso local pasa a la cuenta nueva en
 *   cuanto PGS la informa (sin esperar a la red) y lo pendiente de la anterior se
 *   aparta (stash) para fusionarlo con SU documento. Lo jugado con la cuenta nueva
 *   antes de sincronizar se SUMA a sus contadores en la primera fusión (baseEmpty).
 *
 * ORDEN DE CARGA: después de storage.js, countries-data.js, play-games.js y
 * firebase-leaderboard.js; antes de profile-ui.js y main.js.
 */

var PlayerProfile = (function () {

  var COLLECTION       = 'players';
  var CODES_COLLECTION = 'friend_codes';
  var SCHEMA_VERSION   = 1;

  var LOCAL_KEY = 'player_profile'; /* identidad + datos sociales (copia local del documento) */
  var SYNC_KEY  = 'player_sync';    /* { dirty, rev, lastPushAt, baseEmpty } */
  var STASH_KEY = 'player_sync_stash'; /* { ownerId: { profile, progress, at, baseEmpty } } pendiente de cuentas anteriores */
  var STASH_MAX = 3;

  /* Código de amigo estilo Steam: 6 caracteres [A-Z0-9] sin los ambiguos 0/O y 1/I
     (mismo alfabeto que los códigos de duelo) → 32^6 ≈ 1.073 millones de combinaciones. */
  var FRIEND_CODE_CHARSET      = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var FRIEND_CODE_LENGTH       = 6;
  var FRIEND_CODE_RE           = /^[A-HJ-NP-Z2-9]{6}$/;
  var FRIEND_CODE_MAX_ATTEMPTS = 5;

  var NICKNAME_MAX       = 30;
  var PUSH_DEBOUNCE_MS   = 4000;
  var READ_TIMEOUT_MS    = 8000;
  var WRITE_TIMEOUT_MS   = 10000;
  var BOOTSTRAP_TIMEOUT_MS = 25000;
  /* Reintentos automáticos del bootstrap (sin red al arrancar): acotados para no
     generar lecturas facturables en bucle si el error es persistente. */
  var BOOTSTRAP_MAX_ATTEMPTS = 3;
  var BOOTSTRAP_RETRY_MIN_MS = 60000;
  var DAILY_HISTORY_MAX  = 400;  /* días de histórico en remoto (la racha mira como mucho 365) */
  var SOCIAL_LIST_MAX    = 500;
  /* Modos admitidos en stats.porModo: MISMA lista que isValidStatsByMode (firestore.rules).
     Un modo desconocido haría que las reglas rechazasen el documento entero. */
  var STATS_BY_MODE_ALLOWED = ['daily', 'guess-country', 'guess-flag', 'timetrial', 'guess-capital',
                               'guess-country-from-capital', 'guess-silhouette', 'marathon'];

  var _db              = null;
  var _initialized     = false;
  var _syncedId        = null;   /* playerId con bootstrap completado en esta sesión */
  var _bootstrapping   = null;   /* Promise del bootstrap en curso */
  var _lastBootstrap   = null;   /* último resultado: { status, ... } */
  var _bootstrapAttempts = 0;
  var _lastBootstrapAt = 0;
  var _fatalError      = false;  /* permission-denied / invalid-argument → no reintentar en la sesión */
  var _pushing         = null;   /* Promise del update() en curso */
  var _stashUploading  = null;   /* Promise de la subida de pendientes de cuentas anteriores */
  var _pushQueued      = false;
  var _pushTimer       = null;
  var _applyingRemote  = false;  /* suprime el marcado "dirty" al volcar datos remotos */
  var _countryPromise  = null;
  var _detectedCountry = null;
  var _lastError       = null;
  var _listeners       = [];

  /* ══════════════════════════════════════════════════════
   * HELPERS GENÉRICOS
   * ══════════════════════════════════════════════════════ */

  function _isMap(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }

  /** Entero ≥ 0 (Firestore lo guarda como integer → validable con `is int` en las reglas). */
  function _int(v) {
    var n = Number(v);
    return (isFinite(n) && n > 0) ? Math.floor(n) : 0;
  }

  /** Número finito ≥ 0 (conserva decimales). */
  function _num(v) {
    var n = Number(v);
    return (isFinite(n) && n > 0) ? n : 0;
  }

  /**
   * Identificador (modo, logro, código de país…): solo [A-Za-z0-9_-]. Sin Firebase Auth
   * cualquiera puede escribir el documento remoto y algunos de estos valores acaban en
   * innerHTML (p. ej. el modo favorito de las estadísticas) → nunca pueden llevar marcado.
   */
  function _isSafeId(s) { return typeof s === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(s); }

  /** Clave válida como campo de un map de Firestore (identificador seguro, no reservada `__x__`). */
  function _isSafeKey(k) { return _isSafeId(k) && !/^__.*__$/.test(k); }

  function _isDateKey(k) { return typeof k === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(k); }

  /** Mediodía local de una clave 'YYYY-MM-DD' (ts aproximado al restaurar el histórico). */
  function _dateKeyToTs(k) {
    var p = k.split('-');
    return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]), 12).getTime();
  }

  /** Lista de strings no vacíos, sin duplicados y acotada. */
  function _strList(arr, max) {
    var out = [];
    if (!Array.isArray(arr)) return out;
    var limit = max || 200;
    for (var i = 0; i < arr.length && out.length < limit; i++) {
      var s = arr[i];
      if (_isSafeId(s) && out.indexOf(s) === -1) out.push(s);
    }
    return out;
  }

  function _union(a, b) { return _strList((a || []).concat(b || [])); }

  /** { clave: entero ≥ 0 } con claves seguras para Firestore. */
  function _intMap(obj) {
    var out = {};
    if (!_isMap(obj)) return out;
    Object.keys(obj).forEach(function (k) {
      if (_isSafeKey(k)) out[k] = _int(obj[k]);
    });
    return out;
  }

  function _maxMap(a, b) {
    var out = _intMap(a);
    var bb  = _intMap(b);
    Object.keys(bb).forEach(function (k) { out[k] = Math.max(out[k] || 0, bb[k]); });
    return out;
  }

  function _copy(obj) {
    var out = {};
    Object.keys(obj).forEach(function (k) { out[k] = obj[k]; });
    return out;
  }

  /** Timestamp de Firestore / número / Date → milisegundos (o null). */
  function _tsToMs(v) {
    if (!v) return null;
    if (typeof v.toMillis === 'function') return v.toMillis();
    if (typeof v === 'number' && isFinite(v)) return v;
    if (v instanceof Date) return v.getTime();
    return null;
  }

  /** Rechaza la promesa si no se resuelve en `ms` (evita esperas infinitas sin red). */
  function _withTimeout(promise, ms, label) {
    return new Promise(function (resolve, reject) {
      var done = false;
      var timer = setTimeout(function () {
        if (done) return;
        done = true;
        reject(new Error((label || 'operation') + '-timeout'));
      }, ms);
      promise.then(function (v) {
        if (done) return;
        done = true; clearTimeout(timer); resolve(v);
      }, function (err) {
        if (done) return;
        done = true; clearTimeout(timer); reject(err);
      });
    });
  }

  function _errCode(err) {
    return (err && (err.code || err.message)) || String(err);
  }

  /* ══════════════════════════════════════════════════════
   * IDENTIDAD (Google Play Games)
   * ══════════════════════════════════════════════════════ */

  function _pgsInfo() {
    try {
      if (typeof PlayGamesService === 'undefined' || !PlayGamesService.isSignedIn()) return null;
      return PlayGamesService.getPlayerInfo() || null;
    } catch (e) { return null; }
  }

  /** playerId de PGS válido como ID de documento, o null (invitado). */
  function _currentPlayerId() {
    var info = _pgsInfo();
    if (!info || info.playerId === null || info.playerId === undefined) return null;
    var id = String(info.playerId);
    if (!id || id.length > 128 || id.indexOf('/') !== -1 ||
        id === '.' || id === '..' || /^__.*__$/.test(id)) return null;
    return id;
  }

  /**
   * Nickname saneado y acotado a NICKNAME_MAX unidades UTF-16, que es lo que mide
   * `string.size()` en firestore.rules (un emoji cuenta 2). Se recorre por code
   * points (Array.from) para no partir nunca un par suplente al truncar.
   */
  function _cleanNickname(s) {
    if (typeof s !== 'string') return '';
    var chars = Array.from(s.replace(/[\x00-\x1F\x7F]/g, '').trim());
    var out = '';
    for (var i = 0; i < chars.length && out.length + chars[i].length <= NICKNAME_MAX; i++) out += chars[i];
    return out.trim();
  }

  /** Nickname: nombre de PGS (siempre el más fresco) > guardado > nombre del ranking local. */
  function _resolveNickname(stored) {
    var info = _pgsInfo();
    return _cleanNickname(info && info.displayName) ||
      _cleanNickname(stored) ||
      _cleanNickname(storageLoad('player_name', null)) || null;
  }

  function _cleanAvatar(url) {
    return (typeof url === 'string' && url && url.length <= 512) ? url : null;
  }

  function _resolveAvatar(stored) {
    var info = _pgsInfo();
    return _cleanAvatar(info && info.avatarUrl) || _cleanAvatar(stored);
  }

  /**
   * Solo se publican en Firestore URLs https (las content:// locales no sirven a otros
   * dispositivos). Mismo criterio que firestore.rules (`matches('^https://.+')`: sensible
   * a mayúsculas y sin saltos de línea) para que el alta nunca sea rechazada.
   */
  function _publicAvatar(url) {
    return (typeof url === 'string' && /^https:\/\/.+$/.test(url) && url.length <= 512) ? url : null;
  }

  function _deviceInfo() {
    var platform = 'web';
    try {
      if (window.Capacitor && typeof window.Capacitor.getPlatform === 'function') {
        platform = String(window.Capacitor.getPlatform() || 'web');
      }
    } catch (e) {}
    var version = (typeof AppConfig !== 'undefined' && AppConfig.version) ? String(AppConfig.version) : null;
    return { platform: platform, appVersion: version };
  }

  /* ══════════════════════════════════════════════════════
   * ESTADO LOCAL (copia del documento + estado de sincronización)
   * ══════════════════════════════════════════════════════ */

  function _defaultLocal() {
    return {
      ownerId:        null,  /* playerId al que pertenece el progreso guardado en este dispositivo */
      nickname:       null,
      avatarUrl:      null,
      friendCode:     null,
      country:        null,
      continent:      null,
      createdAt:      null,  /* ms */
      lastConnection: null,  /* ms */
      lastSyncAt:     null,  /* ms — última escritura confirmada en Firestore */
      stars:          0,
      friends:        [],
      trophies:       []
    };
  }

  function _loadLocal() {
    var raw = storageLoad(LOCAL_KEY, null);
    var p = _defaultLocal();
    if (!_isMap(raw)) return p;
    p.ownerId        = (typeof raw.ownerId === 'string' && raw.ownerId) ? raw.ownerId : null;
    p.nickname       = _cleanNickname(raw.nickname) || null;
    p.avatarUrl      = _cleanAvatar(raw.avatarUrl);
    p.friendCode     = isValidFriendCode(raw.friendCode) ? raw.friendCode : null;
    p.country        = (typeof raw.country === 'string' && /^[A-Z]{2}$/.test(raw.country)) ? raw.country : null;
    p.continent      = (typeof raw.continent === 'string' && raw.continent) ? raw.continent : null;
    p.createdAt      = _tsToMs(raw.createdAt);
    p.lastConnection = _tsToMs(raw.lastConnection);
    p.lastSyncAt     = _tsToMs(raw.lastSyncAt);
    p.stars          = _int(raw.stars);
    p.friends        = Array.isArray(raw.friends)  ? raw.friends.slice(0, SOCIAL_LIST_MAX)  : [];
    p.trophies       = Array.isArray(raw.trophies) ? raw.trophies.slice(0, SOCIAL_LIST_MAX) : [];
    return p;
  }

  function _saveLocal(p) { storageSave(LOCAL_KEY, p); }

  /**
   * baseEmpty: el progreso local empezó de cero para su cuenta tras un cambio de cuenta y
   * todavía NO incluye su documento remoto → en la primera fusión los contadores acumulados
   * se suman. Se desactiva ANTES de enviar ese progreso a ningún sitio: desde entonces los
   * valores son absolutos y un reintento nunca vuelve a sumar lo mismo.
   */
  function _loadSync() {
    var s = storageLoad(SYNC_KEY, null);
    return {
      dirty:      !!(_isMap(s) && s.dirty),
      rev:        _isMap(s) ? _int(s.rev) : 0,
      lastPushAt: _isMap(s) ? _int(s.lastPushAt) : 0,
      baseEmpty:  !!(_isMap(s) && s.baseEmpty)
    };
  }

  function _saveSync(s) { storageSave(SYNC_KEY, s); }

  function _loadStash() {
    var s = storageLoad(STASH_KEY, null);
    var out = {};
    if (!_isMap(s)) return out;
    Object.keys(s).forEach(function (id) {
      if (_isMap(s[id]) && _isMap(s[id].profile) && _isMap(s[id].progress)) out[id] = s[id];
    });
    return out;
  }

  /** Guarda el stash conservando solo las STASH_MAX cuentas más recientes. */
  function _saveStash(stash) {
    var ids = Object.keys(stash).sort(function (a, b) { return _int(stash[b].at) - _int(stash[a].at); });
    var out = {};
    ids.slice(0, STASH_MAX).forEach(function (id) { out[id] = stash[id]; });
    storageSave(STASH_KEY, out);
  }

  /* ══════════════════════════════════════════════════════
   * MAPEO LOCAL ⇄ FIRESTORE
   *
   *  localStorage (storage.js)                 players/{id}
   *  ───────────────────────────────────────   ─────────────────────────────
   *  achievements.stats.total_correct          stats.aciertos
   *  total_attempted − total_correct           stats.fallos
   *  achievements.stats.total_games            stats.totalPartidas
   *  achievements.stats.max_streak_ever        stats.mejorRacha
   *  achievements.stats.daily_completed        stats.retosDiarios
   *  achievements.stats.max_time_attack        stats.mejorContrarreloj
   *  achievements.stats.modes_played           stats.modosJugados
   *  achievements.stats.statsByMode             stats.porModo  (incl. porModo.marathon)
   *  marathon.bestStreak                       stats.maratonMejorRacha
   *  marathon.games                            stats.maratonPartidas
   *  marathon.lastPlayed                       stats.maratonUltimo (YYYY-MM-DD | null)
   *  achievements.unlocked                     achievements
   *  best_scores                               bestScores
   *  daily {fecha:{score,ts}}                  dailyHistory {fecha: score}  (+ streakDays)
   *  wrong_countries_v2                        wrongCountries
   *  player_country_cache                      country / continent
   *
   *  NO se sincronizan (preferencias del dispositivo o estado efímero):
   *  settings, lang, last_mode, last_continent, onboarding_*, daily_attempt,
   *  tournament_attempt, marathon_attempt, marathon_runs, marathon_lb_synced,
   *  ad_recoveries, update_checker_cache.
   * ══════════════════════════════════════════════════════ */

  /** local {fecha:{score,ts}} → remoto {fecha: score} (solo los últimos N días). */
  function _dailyToRemote(daily) {
    var out = {};
    if (!_isMap(daily)) return out;
    Object.keys(daily).filter(_isDateKey).sort().reverse().slice(0, DAILY_HISTORY_MAX)
      .forEach(function (k) {
        var e = daily[k];
        if (!e) return;
        out[k] = _int(_isMap(e) ? e.score : e);
      });
    return out;
  }

  /** remoto → local. Sin fechas futuras: darían por jugado un reto diario que aún no ha llegado. */
  function _dailyFromRemote(hist) {
    var out = {};
    if (!_isMap(hist)) return out;
    var today = getDailyKey();
    Object.keys(hist).filter(_isDateKey).forEach(function (k) {
      if (k > today) return;
      out[k] = { score: _int(hist[k]), ts: _dateKeyToTs(k) };
    });
    return out;
  }

  /** wrong_countries_v2 ⇄ wrongCountries (mismo formato, saneado). */
  function _wrongSanitize(wc) {
    var out = {};
    if (!_isMap(wc)) return out;
    Object.keys(wc).forEach(function (code) {
      var e = wc[code];
      if (!_isSafeKey(code) || code.length > 8 || !_isMap(e)) return;
      out[code] = {
        total:    _int(e.total),
        byMode:   _intMap(e.byMode),
        lastSeen: _isDateKey(e.lastSeen) ? e.lastSeen : null
      };
    });
    return out;
  }

  /** { modo: {games, correct, wrong} } saneado para localStorage y Firestore. */
  function _statsByModeSanitize(statsByMode) {
    var out = {};
    if (!_isMap(statsByMode)) return out;
    Object.keys(statsByMode).forEach(function (mode) {
      var entry = statsByMode[mode];
      if (STATS_BY_MODE_ALLOWED.indexOf(mode) === -1 || !_isMap(entry)) return;
      out[mode] = {
        games:   _int(entry.games),
        correct: _int(entry.correct),
        wrong:   _int(entry.wrong)
      };
    });
    return out;
  }

  function _mergeStatsByMode(a, b, additive) {
    var combine = additive ? _sum : Math.max;
    var out = _statsByModeSanitize(a);
    var remote = _statsByModeSanitize(b);
    Object.keys(remote).forEach(function (mode) {
      if (!out[mode]) out[mode] = { games: 0, correct: 0, wrong: 0 };
      ['games', 'correct', 'wrong'].forEach(function (field) {
        out[mode][field] = combine(out[mode][field], remote[mode][field]);
      });
    });
    return out;
  }

  /** 'marathon' local ⇄ remoto: { bestStreak, games, lastPlayed } saneado (mismo formato en ambos lados). */
  function _marathonSanitize(m) {
    var mm = _isMap(m) ? m : {};
    var last = (_isDateKey(mm.lastPlayed) && mm.lastPlayed <= getDailyKey()) ? mm.lastPlayed : null;
    return { bestStreak: _int(mm.bestStreak), games: _int(mm.games), lastPlayed: last };
  }

  function _mergeMarathon(a, b, additive) {
    var la = _marathonSanitize(a), rb = _marathonSanitize(b);
    var last = la.lastPlayed;
    if (rb.lastPlayed && (!last || rb.lastPlayed > last)) last = rb.lastPlayed;
    return {
      bestStreak: Math.max(la.bestStreak, rb.bestStreak),
      games:      additive ? la.games + rb.games : Math.max(la.games, rb.games),
      lastPlayed: last
    };
  }

  /** Progreso local (formato de loadProgressSnapshot) → campos del documento remoto. */
  function _progressToRemote(snap) {
    var ach = _isMap(snap.achievements) ? snap.achievements : {};
    var st  = _isMap(ach.stats) ? ach.stats : {};
    var mar = _marathonSanitize(snap.marathon);
    var correct   = _int(st.total_correct);
    var attempted = _int(st.total_attempted);
    return {
      streakDays: _int(getDailyStreak(_isMap(snap.daily) ? snap.daily : {})),
      stats: {
        aciertos:          correct,
        fallos:            Math.max(0, attempted - correct),
        totalPartidas:     _int(st.total_games),
        mejorRacha:        _int(st.max_streak_ever),
        retosDiarios:      _int(st.daily_completed),
        mejorContrarreloj: _int(st.max_time_attack),
        modosJugados:      _strList(st.modes_played, 50),
        porModo:           _statsByModeSanitize(st.statsByMode),
        maratonMejorRacha: mar.bestStreak,
        maratonPartidas:   mar.games,
        maratonUltimo:     mar.lastPlayed
      },
      achievements:   _strList(ach.unlocked, 100),
      bestScores:     _intMap(snap.bestScores),
      dailyHistory:   _dailyToRemote(snap.daily),
      wrongCountries: _wrongSanitize(snap.wrongCountries)
    };
  }

  /** Documento remoto → progreso local (formato de saveProgressSnapshot). */
  function _remoteToProgress(doc) {
    var d = _isMap(doc) ? doc : {};
    var s = _isMap(d.stats) ? d.stats : {};
    var aciertos = _int(s.aciertos);
    return {
      achievements: {
        unlocked: _strList(d.achievements, 100),
        stats: {
          total_correct:   aciertos,
          total_games:     _int(s.totalPartidas),
          total_attempted: aciertos + _int(s.fallos),
          modes_played:    _strList(s.modosJugados, 50),
          daily_completed: _int(s.retosDiarios),
          max_time_attack: _int(s.mejorContrarreloj),
          max_streak_ever: _int(s.mejorRacha),
          statsByMode:     _statsByModeSanitize(s.porModo)
        }
      },
      bestScores:     _intMap(d.bestScores),
      daily:          _dailyFromRemote(d.dailyHistory),
      wrongCountries: _wrongSanitize(d.wrongCountries),
      ranking:        [],
      marathon:       _marathonSanitize({
        bestStreak: s.maratonMejorRacha,
        games:      s.maratonPartidas,
        lastPlayed: s.maratonUltimo
      })
    };
  }

  function _emptyProgress() { return _remoteToProgress({}); }

  /* ══════════════════════════════════════════════════════
   * FUSIÓN (Caso C): nunca se pierde progreso de ningún lado.
   * Contadores → máximo · conjuntos → unión · mapas → fusión por clave.
   * Con `additive` (progreso local que empezó de cero: baseEmpty) los contadores
   * acumulados (partidas, aciertos, intentos, retos, fallos por país) se SUMAN;
   * récords y mejores rachas siguen siendo el máximo.
   * ══════════════════════════════════════════════════════ */

  function _sum(a, b) { return a + b; }

  function _mergeDaily(a, b) {
    var out = {};
    [a, b].forEach(function (src) {
      if (!_isMap(src)) return;
      Object.keys(src).forEach(function (k) {
        var e = src[k];
        if (!_isDateKey(k) || !e) return;
        var entry = _isMap(e) ? e : { score: _int(e), ts: _dateKeyToTs(k) };
        if (!out[k] || _int(entry.score) > _int(out[k].score)) out[k] = entry;
      });
    });
    return out;
  }

  function _mergeWrong(a, b, additive) {
    var comb = additive ? _sum : Math.max;
    var out = _wrongSanitize(a);
    var bb  = _wrongSanitize(b);
    Object.keys(bb).forEach(function (code) {
      var e = bb[code], cur = out[code];
      if (!cur) { out[code] = e; return; }
      cur.total = comb(cur.total, e.total);
      Object.keys(e.byMode).forEach(function (m) {
        cur.byMode[m] = comb(cur.byMode[m] || 0, e.byMode[m]);
      });
      if (e.lastSeen && (!cur.lastSeen || e.lastSeen > cur.lastSeen)) cur.lastSeen = e.lastSeen;
    });
    return out;
  }

  function _mergeProgress(local, remote, additive) {
    var comb = additive ? _sum : Math.max;
    var la = _isMap(local.achievements) ? local.achievements : {}, ra = remote.achievements;
    var ls = _isMap(la.stats) ? la.stats : {},                     rs = ra.stats;
    return {
      achievements: {
        unlocked: _union(la.unlocked, ra.unlocked),
        stats: {
          total_correct:   comb(_int(ls.total_correct),   rs.total_correct),
          total_games:     comb(_int(ls.total_games),     rs.total_games),
          total_attempted: comb(_int(ls.total_attempted), rs.total_attempted),
          modes_played:    _union(ls.modes_played, rs.modes_played),
          daily_completed: comb(_int(ls.daily_completed), rs.daily_completed),
          max_time_attack: Math.max(_int(ls.max_time_attack), rs.max_time_attack),
          max_streak_ever: Math.max(_int(ls.max_streak_ever), rs.max_streak_ever),
          statsByMode:     _mergeStatsByMode(ls.statsByMode, rs.statsByMode, additive)
        }
      },
      bestScores:     _maxMap(local.bestScores, remote.bestScores),
      daily:          _mergeDaily(local.daily, remote.daily),
      wrongCountries: _mergeWrong(local.wrongCountries, remote.wrongCountries, additive),
      ranking:        Array.isArray(local.ranking) ? local.ranking.slice() : [],
      marathon:       _mergeMarathon(local.marathon, remote.marathon, additive)
    };
  }

  /** Vuelca progreso en localStorage sin que cuente como "cambio local pendiente". */
  function _writeProgressLocally(progress) {
    _applyingRemote = true;
    try { saveProgressSnapshot(progress); }
    finally { _applyingRemote = false; }
  }

  /* ══════════════════════════════════════════════════════
   * CONSTRUCCIÓN DEL DOCUMENTO
   * ══════════════════════════════════════════════════════ */

  function _nicknameForRemote(nickname, pid) {
    return _cleanNickname(nickname) || ('Player ' + String(pid).slice(-4));
  }

  /** Campos que el cliente mantiene (identidad visible + progreso). */
  function _clientFields(pid, profile, progress) {
    var prog = _progressToRemote(progress);
    return {
      schemaVersion:  SCHEMA_VERSION,
      nickname:       _nicknameForRemote(profile.nickname, pid),
      avatarUrl:      _publicAvatar(profile.avatarUrl),
      country:        profile.country || null,
      continent:      profile.continent || null,
      streakDays:     prog.streakDays,
      stats:          prog.stats,
      achievements:   prog.achievements,
      bestScores:     prog.bestScores,
      dailyHistory:   prog.dailyHistory,
      wrongCountries: prog.wrongCountries,
      device:         _deviceInfo()
    };
  }

  /**
   * Documento completo para el alta (Casos A y B). `friendCode` se asigna dentro de
   * la transacción que reserva el código. stars/friends/trophies nacen vacíos y el
   * cliente NUNCA los sobrescribe después (quedan reservados para lógica de servidor).
   */
  function _buildNewDocument(pid, profile, progress, migrated) {
    var FV = firebase.firestore.FieldValue;
    var doc = _clientFields(pid, profile, progress);
    doc.id                = pid;
    doc.friendCode        = null;
    doc.createdAt         = FV.serverTimestamp();
    doc.lastConnection    = FV.serverTimestamp();
    doc.updatedAt         = FV.serverTimestamp();
    doc.stars             = 0;
    doc.friends           = [];
    doc.trophies          = [];
    doc.migratedFromLocal = !!migrated;
    return doc;
  }

  /** Payload de update() rutinario: sustituye por completo cada campo enviado. */
  function _buildUpdatePayload(pid, profile, progress, withConnection) {
    var FV = firebase.firestore.FieldValue;
    var payload = _clientFields(pid, profile, progress);
    payload.topGames = FV.delete();
    payload.updatedAt = FV.serverTimestamp();
    if (withConnection) payload.lastConnection = FV.serverTimestamp();
    return payload;
  }

  /**
   * Payload SOLO de progreso (sin nickname/avatar/país/dispositivo): para subir lo apartado
   * de otra cuenta, cuya identidad guardada puede estar vacía o desfasada.
   */
  function _buildProgressPayload(progress) {
    var payload = _progressToRemote(progress);
    payload.topGames = firebase.firestore.FieldValue.delete();
    payload.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
    return payload;
  }

  /* ══════════════════════════════════════════════════════
   * CÓDIGO DE AMIGO
   * ══════════════════════════════════════════════════════ */

  /** Genera un código aleatorio de 6 caracteres (no garantiza unicidad por sí solo). */
  function generateFriendCode() {
    var bytes = null;
    try {
      if (window.crypto && typeof window.crypto.getRandomValues === 'function') {
        bytes = new Uint8Array(FRIEND_CODE_LENGTH);
        window.crypto.getRandomValues(bytes);
      }
    } catch (e) { bytes = null; }
    var out = '';
    for (var i = 0; i < FRIEND_CODE_LENGTH; i++) {
      var r = bytes ? bytes[i] : Math.floor(Math.random() * 256);
      /* 256 es múltiplo de 32 → el módulo no introduce sesgo */
      out += FRIEND_CODE_CHARSET.charAt(r % FRIEND_CODE_CHARSET.length);
    }
    return out;
  }

  function isValidFriendCode(code) {
    return typeof code === 'string' && FRIEND_CODE_RE.test(code);
  }

  /** Normaliza la entrada del usuario: mayúsculas, sin espacios/guiones, máx. 6. */
  function normalizeFriendCode(input) {
    return String(input || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, FRIEND_CODE_LENGTH);
  }

  /**
   * Reserva un código de amigo ÚNICO en una transacción atómica:
   *   1. tx.get(players/{id})        → si ya tiene código válido, no hace nada.
   *   2. tx.get(friend_codes/{CODE}) → si existe (colisión), se reintenta con otro código.
   *   3. tx.set(friend_codes/{CODE}, {playerId}) + tx.set/update(players/{id}, {friendCode}).
   * El ID del documento de friend_codes ES el código → Firestore garantiza que no
   * existan dos iguales; las reglas prohíben sobrescribirlo (solo create).
   *
   * @param {object|null} newDoc  Documento a crear si players/{id} no existe (Casos A/B).
   *                              null = solo "reparar" un documento existente sin código.
   * @returns {Promise<{status:'created'|'healed'|'exists'|'missing', code?, data?}>}
   */
  function _reserveFriendCode(db, pid, newDoc) {
    var FV = firebase.firestore.FieldValue;
    var playerRef = db.collection(COLLECTION).doc(pid);
    var attempt = 0;

    function tryOnce() {
      attempt++;
      var code = generateFriendCode();
      var codeRef = db.collection(CODES_COLLECTION).doc(code);

      return db.runTransaction(function (tx) {
        return tx.get(playerRef).then(function (pSnap) {
          var existing = pSnap.exists ? pSnap.data() : null;
          if (existing && isValidFriendCode(existing.friendCode)) return { status: 'exists', data: existing };
          if (!existing && !newDoc) return { status: 'missing' };

          return tx.get(codeRef).then(function (cSnap) {
            if (cSnap.exists) return { status: 'collision' };
            tx.set(codeRef, { playerId: pid, createdAt: FV.serverTimestamp() });
            if (existing) {
              tx.update(playerRef, { friendCode: code, updatedAt: FV.serverTimestamp() });
              var healed = _copy(existing);
              healed.friendCode = code;
              return { status: 'healed', code: code, data: healed };
            }
            var doc = _copy(newDoc);
            doc.friendCode = code;
            tx.set(playerRef, doc);
            return { status: 'created', code: code };
          });
        });
      }).then(function (res) {
        if (res.status !== 'collision') return res;
        if (attempt < FRIEND_CODE_MAX_ATTEMPTS) {
          console.log('[PlayerProfile] Colisión de código de amigo, reintentando (' + attempt + ')');
          return tryOnce();
        }
        throw new Error('friend-code-exhausted');
      });
    }

    return tryOnce();
  }

  /* ══════════════════════════════════════════════════════
   * PAÍS (misma lógica y caché que el reto diario)
   * ══════════════════════════════════════════════════════ */

  function _detectCountry() {
    if (typeof FirebaseLeaderboard === 'undefined' ||
        typeof FirebaseLeaderboard.getPlayerCountry !== 'function') {
      return Promise.resolve(null);
    }
    return FirebaseLeaderboard.getPlayerCountry().then(function (c) {
      if (typeof c !== 'string' || !/^[A-Z]{2}$/.test(c)) return null;
      _detectedCountry = c;
      var p = _loadLocal();
      if (p.country !== c) {
        p.country   = c;
        p.continent = (typeof getContinentForCountry === 'function') ? getContinentForCountry(c) : null;
        _saveLocal(p);
        if (_syncedId) _markDirty(); /* el nuevo país viaja en el siguiente update() */
        _emit();
      }
      return c;
    }).catch(function () { return null; });
  }

  /* ══════════════════════════════════════════════════════
   * ESCRITURAS (local → remoto)
   * ══════════════════════════════════════════════════════ */

  function _getDb() {
    if (_db) return _db;
    try {
      if (typeof firebase !== 'undefined' && firebase.firestore) _db = firebase.firestore();
    } catch (e) { _db = null; }
    return _db;
  }

  function _friendError(code) { return { code: code }; }

  /** Busca el jugador asociado a un código sin consultar listados. */
  function resolveFriendCode(code) {
    var normalized = normalizeFriendCode(code);
    if (!isValidFriendCode(normalized)) return Promise.resolve(null);
    var db = _getDb();
    if (!db) return Promise.reject(_friendError('signin'));
    return db.collection(CODES_COLLECTION).doc(normalized).get().then(function (snap) {
      if (!snap.exists) return null;
      var data = snap.data() || {};
      return (typeof data.playerId === 'string' && data.playerId) ? data.playerId : null;
    });
  }

  /** Añade una amistad mutua y restaura la primera lista si falla la segunda escritura. */
  function addFriendByCode(code) {
    var normalized = normalizeFriendCode(code);
    var me = getProfile();
    var db = _getDb();
    if (!isValidFriendCode(normalized)) return Promise.reject(_friendError('invalid'));
    if (!me.signedIn || !me.id || !db) return Promise.reject(_friendError('signin'));
    if (me.friendCode && normalized === me.friendCode) return Promise.reject(_friendError('self'));
    if (me.friends.some(function (f) { return String((f && f.id) || f) === me.id; })) {
      return Promise.reject(_friendError('already'));
    }

    var stage = 'friend-code lookup';
    var failureStage = null;
    function fail(err) {
      if (err && ['invalid', 'self', 'not_found', 'already', 'signin'].indexOf(err.code) !== -1) {
        return Promise.reject(err);
      }
      console.warn('[PlayerProfile] Error adding friend during ' + (failureStage || stage) + ':',
        (err && err.code) || 'unknown', (err && err.message) || '');
      return Promise.reject(_friendError('error'));
    }

    return resolveFriendCode(normalized).then(function (friendId) {
      if (!friendId) throw _friendError('not_found');
      if (friendId === me.id) throw _friendError('self');
      if (me.friends.some(function (f) { return String((f && f.id) || f) === friendId; })) {
        throw _friendError('already');
      }
      if (friendId.length > 128 || friendId.indexOf('/') !== -1 ||
          friendId === '.' || friendId === '..' || /^__.*__$/.test(friendId)) {
        throw _friendError('error');
      }

      var myRef = db.collection(COLLECTION).doc(me.id);
      var friendRef = db.collection(COLLECTION).doc(friendId);
      stage = 'friend profile read';
      return friendRef.get().then(function (friendSnap) {
        if (!friendSnap.exists) throw _friendError('not_found');
        var friend = friendSnap.data() || {};
        var friendEntry = {
          id: friendId,
          nickname: _cleanNickname(friend.nickname) || friendId,
          friendCode: isValidFriendCode(friend.friendCode) ? friend.friendCode : normalized,
          country: (typeof friend.country === 'string' && /^[A-Z]{2}$/.test(friend.country)) ? friend.country : null,
          since: new Date().toISOString()
        };
        var myEntry = {
          id: me.id,
          nickname: _cleanNickname(me.nickname) || me.id,
          friendCode: isValidFriendCode(me.friendCode) ? me.friendCode : null,
          country: (typeof me.country === 'string' && /^[A-Z]{2}$/.test(me.country)) ? me.country : null,
          since: friendEntry.since
        };
        var fieldValue = firebase.firestore.FieldValue;
        stage = 'own player friends update';
        return myRef.update({ friends: fieldValue.arrayUnion(friendEntry) }).then(function () {
          stage = 'friend player friends update';
          return friendRef.update({ friends: fieldValue.arrayUnion(myEntry) }).catch(function (err) {
            failureStage = stage;
            stage = 'rollback own player friends update';
            return myRef.update({ friends: fieldValue.arrayRemove(friendEntry) }).catch(function (rollbackErr) {
              console.warn('[PlayerProfile] Could not roll back own-player friend entry:',
                (rollbackErr && rollbackErr.code) || 'unknown',
                (rollbackErr && rollbackErr.message) || '');
            }).then(function () {
              throw err;
            });
          });
        }).then(function () {
          addFriendLocal(friendEntry);
          return friendEntry;
        });
      });
    }).catch(fail);
  }

  /** Elimina la relación mutua y actualiza la copia local tras el commit. */
  function removeFriendById(friendId) {
    var me = getProfile();
    var db = _getDb();
    if (!me.signedIn || !me.id || !db) return Promise.reject(_friendError('signin'));
    if (typeof friendId !== 'string' || !friendId || friendId === me.id ||
        friendId.length > 128 || friendId.indexOf('/') !== -1 ||
        friendId === '.' || friendId === '..' || /^__.*__$/.test(friendId)) {
      return Promise.reject(_friendError('error'));
    }
    var myRef = db.collection(COLLECTION).doc(me.id);
    var friendRef = db.collection(COLLECTION).doc(friendId);
    var stage = 'friend list read';

    return db.runTransaction(function (tx) {
      return Promise.all([tx.get(myRef), tx.get(friendRef)]).then(function (snaps) {
        if (!snaps[0].exists || !snaps[1].exists) throw _friendError('error');
        var myFriends = snaps[0].data().friends || [];
        var theirFriends = snaps[1].data().friends || [];
        tx.update(myRef, {
          friends: myFriends.filter(function (f) { return String((f && f.id) || f) !== friendId; })
        });
        tx.update(friendRef, {
          friends: theirFriends.filter(function (f) { return String((f && f.id) || f) !== me.id; })
        });
        stage = 'friend list updates';
      });
    }).then(function () {
      removeFriendLocal(friendId);
      return { ok: true, friendId: friendId };
    }).catch(function (err) {
      console.warn('[PlayerProfile] Error removing friend during ' + stage + ':',
        (err && err.code) || 'unknown', (err && err.message) || '');
      return Promise.reject(_friendError('error'));
    });
  }

  function addFriendLocal(entry) {
    var p = _loadLocal();
    if (!p.friends.some(function (f) { return String((f && f.id) || f) === entry.id; })) {
      p.friends.push(entry);
      _saveLocal(p);
      _emit();
    }
  }

  function removeFriendLocal(id) {
    var p = _loadLocal();
    p.friends = p.friends.filter(function (f) { return String((f && f.id) || f) !== id; });
    _saveLocal(p);
    _emit();
  }

  function _markDirty() {
    var s = _loadSync();
    s.dirty = true;
    s.rev   = s.rev + 1;
    _saveSync(s);
    if (_syncedId) _schedulePush();
  }

  function _schedulePush(delayMs) {
    if (_pushTimer) clearTimeout(_pushTimer);
    _pushTimer = setTimeout(function () {
      _pushTimer = null;
      _pushNow(false);
    }, typeof delayMs === 'number' ? delayMs : PUSH_DEBOUNCE_MS);
  }

  /**
   * update() del documento `pid` con el progreso local actual.
   * update() (y no set/merge) sustituye cada campo enviado por completo → el
   * remoto queda como espejo exacto del local, sin claves huérfanas en los maps.
   * @returns {Promise<'ok'|'not-found'|'denied'|'error'>}  'denied' = rechazo definitivo
   *          de las reglas (reintentar con los mismos datos no lo arreglaría).
   */
  function _pushTo(db, pid, profile, progress, withConnection) {
    var payload;
    try {
      payload = _buildUpdatePayload(pid, profile, progress, withConnection);
    } catch (e) {
      console.warn('[PlayerProfile] No se pudo construir el payload:', e);
      return Promise.resolve('error');
    }
    return _withTimeout(db.collection(COLLECTION).doc(pid).update(payload), WRITE_TIMEOUT_MS, 'write')
      .then(function () { return 'ok'; })
      .catch(function (err) {
        _lastError = _errCode(err);
        console.warn('[PlayerProfile] Error al sincronizar players/' + pid + ':', _lastError);
        var code = err && err.code;
        if (code === 'not-found') return 'not-found';
        if (code === 'permission-denied' || code === 'invalid-argument') return 'denied';
        return 'error';
      });
  }

  function _pushNow(withConnection) {
    var pid = _syncedId;
    if (!pid || pid !== _currentPlayerId()) return Promise.resolve(false);
    if (_pushing) { _pushQueued = true; return _pushing; }
    var db = _getDb();
    if (!db) return Promise.resolve(false);

    var rev = _loadSync().rev;
    _pushing = _pushTo(db, pid, _loadLocal(), loadProgressSnapshot(), withConnection).then(function (result) {
      if (result === 'ok') {
        var s = _loadSync();
        if (s.rev === rev) s.dirty = false; /* si hubo cambios durante el envío, sigue dirty */
        s.lastPushAt = Date.now();
        _saveSync(s);
        var p = _loadLocal();
        p.lastSyncAt = Date.now();
        if (withConnection) p.lastConnection = Date.now();
        _saveLocal(p);
      } else if (result === 'not-found' && _syncedId === pid) {
        /* El documento ha desaparecido (p. ej. borrado desde consola) → recrear en el próximo bootstrap */
        _syncedId = null;
      }
      return result === 'ok';
    }).then(function (ok) {
      _pushing = null;
      if (_pushQueued) {
        _pushQueued = false;
        if (_loadSync().dirty) _schedulePush();
      }
      _emit();
      return ok;
    });
    _emit();
    return _pushing;
  }

  /* ══════════════════════════════════════════════════════
   * BOOTSTRAP (lectura única + casos A / B / C)
   * ══════════════════════════════════════════════════════ */

  /** Perfil local a partir del documento remoto (Caso C). */
  function _profileFromRemote(pid, remote, prev) {
    var p = _defaultLocal();
    p.ownerId        = pid;
    p.nickname       = _resolveNickname(remote.nickname || prev.nickname);
    p.avatarUrl      = _resolveAvatar(remote.avatarUrl || prev.avatarUrl);
    p.friendCode     = isValidFriendCode(remote.friendCode) ? remote.friendCode : null;
    p.country        = _detectedCountry || prev.country ||
                       ((typeof remote.country === 'string' && /^[A-Z]{2}$/.test(remote.country)) ? remote.country : null);
    p.continent      = p.country && typeof getContinentForCountry === 'function'
                       ? getContinentForCountry(p.country) : (remote.continent || null);
    p.createdAt      = _tsToMs(remote.createdAt) || Date.now();
    p.lastConnection = Date.now();
    p.lastSyncAt     = prev.lastSyncAt;
    p.stars          = _int(remote.stars);
    p.friends        = Array.isArray(remote.friends)  ? remote.friends.slice(0, SOCIAL_LIST_MAX)  : [];
    p.trophies       = Array.isArray(remote.trophies) ? remote.trophies.slice(0, SOCIAL_LIST_MAX) : [];
    return p;
  }

  /**
   * CASO C — el documento existe: descargar, fusionar con el local y escribir UNA
   * vez (lastConnection + progreso fusionado, que incluye lo que solo existía en local).
   * @param {boolean} additive  El progreso local empezó de cero (baseEmpty) → sumar contadores.
   */
  function _applyRemote(db, pid, data, additive) {
    var ready = isValidFriendCode(data.friendCode)
      ? Promise.resolve(data)
      : _reserveFriendCode(db, pid, null)
          .then(function (r) { return r.data || data; })
          .catch(function () { return data; }); /* se reintentará en el próximo arranque */

    return ready.then(function (remote) {
      /* Leer local → fusionar → escribir local de forma SÍNCRONA: ningún otro
         callback puede intercalarse y perder un cambio local. baseEmpty se relee aquí:
         si otra fusión (p. ej. un bootstrap reintentado) ya lo consumió, no se suma dos veces. */
      var s = _loadSync();
      var sum = !!additive && s.baseEmpty;
      _writeProgressLocally(_mergeProgress(loadProgressSnapshot(), _remoteToProgress(remote), sum));
      _saveLocal(_profileFromRemote(pid, remote, _loadLocal()));
      if (s.baseEmpty) { s = _loadSync(); s.baseEmpty = false; _saveSync(s); } /* ya incluye el remoto */
      _syncedId = pid;
      console.log('[PlayerProfile] ✓ Caso C: perfil descargado de Firestore y fusionado con el local' +
        (sum ? ' (partidas sin sincronizar sumadas)' : ''));
      return _pushNow(true).then(function () {
        return { status: 'C', localChanged: true };
      });
    });
  }

  /** CASOS A / B — el documento no existe: alta (A) o migración del progreso local (B). */
  function _createRemote(db, pid) {
    var progress = loadProgressSnapshot();
    var migrated = hasProgressData(progress);
    var prev     = _loadLocal();
    var profile  = _defaultLocal();
    profile.nickname  = _resolveNickname(prev.nickname);
    profile.avatarUrl = _resolveAvatar(prev.avatarUrl);
    profile.country   = _detectedCountry || prev.country;
    profile.continent = profile.country && typeof getContinentForCountry === 'function'
                        ? getContinentForCountry(profile.country) : null;

    var s0 = _loadSync();
    var revAtStart = s0.rev;
    var doc = _buildNewDocument(pid, profile, progress, migrated);
    /* El alta sube el progreso local tal cual → deja de ser "desde cero" ANTES de enviarlo:
       si el commit se aplica pero la respuesta no llega, el siguiente arranque no lo suma otra vez. */
    if (s0.baseEmpty) { s0.baseEmpty = false; _saveSync(s0); }

    return _reserveFriendCode(db, pid, doc).then(function (res) {
      if (res.status === 'exists' || res.status === 'healed') {
        /* Otro dispositivo lo creó entre el get() y la transacción → tratar como Caso C.
           Fusión normal (máximo): un reintento interno de la transacción también llega aquí
           con NUESTRO documento, y sumar contaría dos veces las mismas partidas. */
        return _applyRemote(db, pid, res.data, false);
      }
      if (res.status !== 'created') throw new Error('unexpected-create-status-' + res.status);

      var now = Date.now();
      var p = _loadLocal();
      p.ownerId        = pid;
      p.nickname       = profile.nickname;
      p.avatarUrl      = profile.avatarUrl;
      p.friendCode     = res.code;
      p.country        = profile.country;
      p.continent      = profile.continent;
      p.createdAt      = now;
      p.lastConnection = now;
      p.lastSyncAt     = now;
      p.stars          = 0;
      p.friends        = [];
      p.trophies       = [];
      _saveLocal(p);
      _syncedId = pid;

      var s = _loadSync();
      if (s.rev === revAtStart) { s.dirty = false; s.lastPushAt = now; _saveSync(s); }
      else _schedulePush(0); /* hubo partidas durante el alta → subirlas ya */

      console.log('[PlayerProfile] ✓ Caso ' + (migrated ? 'B: progreso local migrado' : 'A: jugador nuevo creado') +
        ' — friendCode ' + res.code);
      return { status: migrated ? 'B' : 'A', localChanged: false };
    });
  }

  /**
   * Cambio de cuenta en el mismo dispositivo (síncrono, sin red). El progreso local es de
   * la cuenta anterior (ownerId): si tiene cambios sin subir se aparta en el stash para
   * enviarlos a SU documento, y el almacenamiento local pasa a la cuenta nueva, vacío o con
   * lo que esa cuenta tuviera apartado. Así las partidas jugadas antes de que termine el
   * bootstrap de la cuenta nueva (p. ej. sin conexión) cuentan para ella y no para la anterior.
   * Si empieza de cero (baseEmpty), esas partidas se SUMAN a su documento en la primera fusión.
   * @returns {boolean} true si se ha sustituido el progreso local.
   */
  function _adoptAccount(pid) {
    var local = _loadLocal();
    var prevOwner = local.ownerId;
    if (!prevOwner || prevOwner === pid) return false;

    var sync  = _loadSync();
    var stash = _loadStash();
    var at    = Date.now();
    if (sync.dirty) {
      stash[prevOwner] = { profile: local, progress: loadProgressSnapshot(), at: at, baseEmpty: sync.baseEmpty };
    }
    var restored = stash[pid] || null;
    delete stash[pid];
    _saveStash(stash);
    var saved = _loadStash()[prevOwner];
    if (sync.dirty && (!saved || saved.at !== at)) return false; /* localStorage lleno: no se toca nada */

    _writeProgressLocally(restored ? restored.progress : _emptyProgress());
    var p = _defaultLocal();
    p.ownerId   = pid;
    p.country   = local.country;   /* el país es del dispositivo, no de la cuenta */
    p.continent = local.continent;
    _saveLocal(p);
    _saveSync({ dirty: !!restored, rev: sync.rev + 1, lastPushAt: 0,
                baseEmpty: restored ? !!restored.baseEmpty : true });
    _syncedId = null;
    console.log('[PlayerProfile] Cambio de cuenta: el progreso local pasa a ' + pid +
      (sync.dirty ? ' (lo pendiente de ' + prevOwner + ' se subirá a su documento)' : ''));
    return true;
  }

  /**
   * Sube lo apartado de una cuenta anterior a SU documento en una transacción (leer →
   * fusionar → escribir): nunca sobrescribe a ciegas lo que esa cuenta tenga en la nube y
   * solo envía campos de progreso. Cada intento relee la entrada del stash (si la cuenta la
   * ha recuperado al volver a iniciar sesión, ya no se sube) y, si el progreso empezó de
   * cero (baseEmpty), la sustituye por el resultado fusionado ANTES del commit: un reintento
   * (timeout, respuesta perdida) nunca vuelve a sumar las mismas partidas.
   * @returns {Promise<'ok'|'gone'|'not-found'|'denied'|'error'>}
   */
  function _uploadStashEntry(db, ownerId, at) {
    var ref = db.collection(COLLECTION).doc(ownerId);
    function current() {
      var e = _loadStash()[ownerId];
      return (e && e.at === at) ? e : null;
    }
    var run = db.runTransaction(function (tx) {
      if (!current()) return Promise.resolve('gone');
      return tx.get(ref).then(function (snap) {
        var entry = current();
        if (!entry) return 'gone';
        if (!snap.exists) return 'not-found';
        var merged = _mergeProgress(entry.progress, _remoteToProgress(snap.data()), !!entry.baseEmpty);
        if (entry.baseEmpty) {
          var stash = _loadStash();
          stash[ownerId] = { profile: entry.profile, progress: merged, at: at, baseEmpty: false };
          _saveStash(stash);
          var saved = current();
          if (!saved || saved.baseEmpty) throw new Error('stash-save-failed');
        }
        tx.update(ref, _buildProgressPayload(merged));
        return 'ok';
      });
    });
    return _withTimeout(run, READ_TIMEOUT_MS + WRITE_TIMEOUT_MS, 'stash-upload').catch(function (err) {
      _lastError = _errCode(err);
      console.warn('[PlayerProfile] Error al subir lo pendiente de players/' + ownerId + ':', _lastError);
      var code = err && err.code;
      if (code === 'permission-denied' || code === 'invalid-argument') return 'denied';
      return 'error';
    });
  }

  /** Envía (en segundo plano) todo el stash; lo que falle por red se reintenta en el próximo bootstrap. */
  function _uploadStash(db) {
    if (_stashUploading) return _stashUploading;
    var stash = _loadStash();
    var ids = Object.keys(stash);
    if (!ids.length) return Promise.resolve();
    _stashUploading = ids.reduce(function (chain, ownerId) {
      return chain.then(function () {
        var entry = stash[ownerId];
        return _uploadStashEntry(db, ownerId, entry.at).then(function (result) {
          if (result === 'error' || result === 'gone') return;
          /* Cuenta que nunca llegó a sincronizar aquí y sin documento: se conserva para
             restaurarla (y migrarla, Caso B) si vuelve a iniciar sesión en este dispositivo */
          if (result === 'not-found' && !entry.profile.createdAt) return;
          if (result !== 'ok') {
            console.warn('[PlayerProfile] Cambios pendientes de ' + ownerId + ' descartados (' + result + ')');
          }
          var cur = _loadStash();
          if (cur[ownerId] && cur[ownerId].at === entry.at) { delete cur[ownerId]; _saveStash(cur); }
        });
      });
    }, Promise.resolve()).then(function () { _stashUploading = null; }, function () { _stashUploading = null; });
    return _stashUploading;
  }

  function _runBootstrap(db, pid) {
    /* _adoptAccount() no pudo apartar el progreso de otra cuenta → no mezclarlo con esta */
    var owner = _loadLocal().ownerId;
    if (owner && owner !== pid) return Promise.reject(new Error('account-switch-pending'));

    _uploadStash(db); /* pendiente de cuentas anteriores → a SUS documentos, en paralelo */

    return Promise.all([
      /* ★ ÚNICA LECTURA de players/{id} en toda la sesión ★ */
      _withTimeout(db.collection(COLLECTION).doc(pid).get(), READ_TIMEOUT_MS, 'read'),
      _countryPromise || Promise.resolve(null)
    ]).then(function (results) {
      var snap = results[0];
      if (snap.exists) return _applyRemote(db, pid, snap.data(), _loadSync().baseEmpty); /* Caso C */
      return _createRemote(db, pid);                                                     /* Caso A / B */
    });
  }

  /**
   * Sincronización inicial con Firestore. Idempotente: como mucho una lectura
   * correcta por sesión y cuenta. Llamar al arrancar (tras PGS) y tras un sign-in manual.
   * @returns {Promise<{status:'A'|'B'|'C'|'guest'|'already-synced'|'unavailable'|'error', localChanged?:boolean}>}
   */
  function bootstrap() {
    var pid = _currentPlayerId();
    if (!pid) return Promise.resolve({ status: 'guest' });
    if (_syncedId === pid) {
      if (_loadSync().dirty) _schedulePush();
      return Promise.resolve({ status: 'already-synced' });
    }
    if (_bootstrapping) return _bootstrapping;
    /* Antes de cualquier acceso a red: si el progreso local es de otra cuenta, pasa a esta */
    var switched = _adoptAccount(pid);
    var db = _getDb();
    if (!db) {
      if (switched) _emit();
      return Promise.resolve({ status: 'unavailable', localChanged: switched });
    }

    _bootstrapAttempts++;
    _lastBootstrapAt = Date.now();
    _bootstrapping = _withTimeout(_runBootstrap(db, pid), BOOTSTRAP_TIMEOUT_MS, 'bootstrap')
      .then(function (res) {
        _lastError = null;
        return res;
      }, function (err) {
        _lastError = _errCode(err);
        var code = err && err.code;
        if (code === 'permission-denied' || code === 'invalid-argument') _fatalError = true;
        console.warn('[PlayerProfile] Bootstrap no completado' +
          (_fatalError ? ' (error permanente, revisa firestore.rules):' : ' (se reintentará):'), _lastError);
        return { status: 'error', error: _lastError };
      })
      .then(function (res) {
        if (switched) res.localChanged = true;
        _bootstrapping = null;
        _lastBootstrap = res;
        _emit();
        return res;
      });
    _emit();
    return _bootstrapping;
  }

  /** ¿Procede reintentar automáticamente un bootstrap fallido? */
  function _canRetryBootstrap() {
    return !_syncedId && !_bootstrapping && !_fatalError &&
      !!_lastBootstrap && _lastBootstrap.status === 'error' &&
      _bootstrapAttempts < BOOTSTRAP_MAX_ATTEMPTS &&
      (Date.now() - _lastBootstrapAt) >= BOOTSTRAP_RETRY_MIN_MS;
  }

  /* ══════════════════════════════════════════════════════
   * API DE CICLO DE VIDA
   * ══════════════════════════════════════════════════════ */

  /** Inicialización local (sin red): detección de país y reintentos al recuperar conexión. */
  function init() {
    if (_initialized) return;
    _initialized = true;
    _countryPromise = _detectCountry();
    try {
      window.addEventListener('online', function () {
        if (_syncedId) flush();
        else if (_canRetryBootstrap()) bootstrap();
      });
    } catch (e) {}
  }

  /**
   * Llamar al terminar una partida, después de los guardados locales.
   * El progreso ya se marcó como pendiente vía onStorageSave; aquí solo se
   * reprograma el envío o se reintenta un bootstrap que falló por falta de red.
   */
  function onGameFinished() {
    if (_syncedId) {
      if (_loadSync().dirty) _schedulePush();
    } else if (_canRetryBootstrap()) {
      bootstrap();
    }
  }

  /** Envío inmediato de cambios pendientes (app a segundo plano). */
  function flush() {
    if (_pushTimer) { clearTimeout(_pushTimer); _pushTimer = null; }
    if (!_syncedId || !_loadSync().dirty) return Promise.resolve(false);
    return _pushNow(false);
  }

  /* ══════════════════════════════════════════════════════
   * LECTURA PARA LA UI (siempre desde la copia local: 0 lecturas en Firestore)
   * ══════════════════════════════════════════════════════ */

  function _syncState(pid) {
    if (!pid) return 'guest';
    if (_bootstrapping || _pushing) return 'syncing';
    if (_syncedId !== pid) return 'pending';
    return _loadSync().dirty ? 'pending' : 'synced';
  }

  /**
   * Vista del perfil para la interfaz.
   * @returns {{ id, nickname, avatarUrl, friendCode, country, continent, createdAt,
   *             lastConnection, streakDays, stars, friends, trophies, signedIn, syncState }}
   */
  function getProfile() {
    var p    = _loadLocal();
    var pid  = _currentPlayerId();
    var info = _pgsInfo();
    /* Si hay otra cuenta conectada que aún no ha sincronizado, no mostrar datos ajenos */
    var own  = !pid || !p.ownerId || p.ownerId === pid;
    var country = _detectedCountry || p.country || null;
    return {
      id:             pid || p.ownerId || null,
      nickname:       _cleanNickname(info && info.displayName) || (own ? p.nickname : null) ||
                      _cleanNickname(storageLoad('player_name', null)) || null,
      avatarUrl:      _cleanAvatar(info && info.avatarUrl) || (own ? p.avatarUrl : null),
      friendCode:     (own && p.ownerId) ? p.friendCode : null,
      country:        country,
      continent:      p.continent,
      createdAt:      own ? p.createdAt : null,
      lastConnection: own ? p.lastConnection : null,
      streakDays:     getDailyStreak(),
      stars:          own ? p.stars : 0,
      friends:        own ? p.friends.slice() : [],
      trophies:       own ? p.trophies.slice() : [],
      signedIn:       !!pid,
      syncState:      _syncState(pid)
    };
  }

  /** Vista previa (depuración) del documento que se escribiría en players/{id}. */
  function previewDocument() {
    var pid = _currentPlayerId() || _loadLocal().ownerId || 'preview';
    var p   = _loadLocal();
    var progress = loadProgressSnapshot();
    var doc = _clientFields(pid, {
      nickname:  _resolveNickname(p.nickname),
      avatarUrl: _resolveAvatar(p.avatarUrl),
      country:   _detectedCountry || p.country,
      continent: p.continent
    }, progress);
    var now = new Date().toISOString();
    doc.id                = pid;
    doc.friendCode        = p.friendCode;
    doc.createdAt         = p.createdAt ? new Date(p.createdAt).toISOString() : now;
    doc.lastConnection    = now;
    doc.updatedAt         = now;
    doc.stars             = p.stars;
    doc.friends           = p.friends;
    doc.trophies          = p.trophies;
    doc.migratedFromLocal = hasProgressData(progress);
    return doc;
  }

  function onChange(fn) { if (typeof fn === 'function') _listeners.push(fn); }

  function _emit() {
    for (var i = 0; i < _listeners.length; i++) {
      try { _listeners[i](); } catch (e) {}
    }
  }

  /* ── Detección de cambios de progreso local (fin de partida, sweeps, restauraciones…) ── */
  if (typeof onStorageSave === 'function' && typeof PROGRESS_STORAGE_KEYS !== 'undefined') {
    onStorageSave(function (key) {
      if (_applyingRemote) return;
      if (PROGRESS_STORAGE_KEYS.indexOf(key) === -1) return;
      _markDirty();
    });
  }

  /* ── API pública ─────────────────────────────────────── */

  return {
    init:                init,
    bootstrap:           bootstrap,
    onGameFinished:      onGameFinished,
    flush:               flush,
    getProfile:          getProfile,
    previewDocument:     previewDocument,
    onChange:            onChange,
    generateFriendCode:  generateFriendCode,
    isValidFriendCode:   isValidFriendCode,
    normalizeFriendCode: normalizeFriendCode,
    resolveFriendCode:   resolveFriendCode,
    addFriendByCode:     addFriendByCode,
    removeFriendById:    removeFriendById,
    FRIEND_CODE_LENGTH:  FRIEND_CODE_LENGTH,
    isSynced:     function () { return !!_syncedId && _syncedId === _currentPlayerId(); },
    getLastError: function () { return _lastError; }
  };

})();
