/**
 * js/firebase-leaderboard.js — Ranking global con Firebase Firestore
 *
 * Gestiona el leaderboard del Reto del Día usando Firestore como backend.
 * Soporta consultar ranking de cualquier fecha (navegación entre días).
 *
 * ★ FASE 1: submitDailyScore SOLO acepta jugadores autenticados con PGS.
 *   Si PGS está conectado pero el plugin nativo no devuelve un playerId válido,
 *   se bloquea la escritura (return null). El antiguo path pgs_fallback_ ha sido
 *   eliminado porque producía documentos anónimos con playerName "Invitado".
 *
 * ★ FASE 2: syncDailyStatusFromFirestore solo opera con PGS activo.
 *   Si el jugador no está autenticado, la sincronización se omite.
 *
 * ★ FASE 3: submitDailyScore detecta el país del jugador vía api.country.is
 *   antes de escribir en Firestore. El campo `country` (ISO-2) se guarda
 *   opcionalmente — si la API falla o hace timeout, el score se envía igual.
 *   El resultado se cachea en localStorage (TTL 24 h) y en memoria.
 *
 * ORDEN DE CARGA: después de play-games.js, antes de leaderboard-ui.js y main.js
 * Depende de: storage.js, play-games.js
 */

var FirebaseLeaderboard = (function () {

  var _db        = null;
  var _isReady   = false;
  var _playerId  = null;   /* UUID local — fallback de solo lectura y fallback PGS */
  var _lastError = null;
  var COLLECTION         = 'daily_scores';
  var WEEKLY_COLLECTION  = 'weekly_scores';

  /* ── Cache para no repetir requests ────────────────── */
  var _cache         = {}; /* { 'YYYY-MM-DD': { data: [...], ts: timestamp } } */
  var _filteredCache = {}; /* { 'period|dateKey|country|continent': { data: [...], ts: timestamp } } */
  var CACHE_TTL = 30000; /* 30 segundos */

  /* ══════════════════════════════════════════════════════
   * INIT
   * ══════════════════════════════════════════════════════ */

  function init() {
    try {
      if (typeof firebase === 'undefined' || !firebase.firestore) {
        console.log('[Leaderboard] Firebase no disponible');
        return false;
      }
      _db = firebase.firestore();
      _playerId = _getOrCreatePlayerId();
      _isReady = true;
      console.log('[Leaderboard] ✓ Init OK, localId:', _playerId);
      return true;
    } catch (e) {
      _lastError = e.message || String(e);
      console.warn('[Leaderboard] ✗ Init error:', e);
      return false;
    }
  }

  /* UUID local persistente — se conserva como fallback en caso de que
     el plugin PGS no devuelva un playerId numérico. */
  function _getOrCreatePlayerId() {
    var stored = storageLoad('firebase_player_id', null);
    if (stored) return stored;
    var id = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
    storageSave('firebase_player_id', id);
    return id;
  }

  /* ── Helpers de identidad ───────────────────────────── */

  /** true cuando PlayGamesService está disponible y el usuario ha iniciado sesión. */
  function _isPgsSignedIn() {
    return typeof PlayGamesService !== 'undefined' && PlayGamesService.isSignedIn();
  }

  /**
   * Devuelve el ID de Firestore apropiado para escritura.
   *
   * Lógica de prioridad:
   *   1. PGS conectado + playerId disponible  → 'pgs_' + playerId   (estable cross-device)
   *   2. PGS conectado + playerId null        → 'pgs_fallback_' + UUID local
   *      (PGS confirma que el usuario está autenticado; registra aviso diagnóstico)
   *   3. PGS no conectado                    → null  (no enviar al ranking)
   *
   * @returns {string|null}
   */
  function _resolvePgsPlayerId() {
    if (!_isPgsSignedIn()) return null;

    var info = PlayGamesService.getPlayerInfo();

    if (info && info.playerId) {
      return info.playerId;
    }

    /* ★ FIX: Si PGS dice estar conectado pero no tenemos playerId real,
       bloqueamos la escritura. Antes usábamos pgs_fallback_ + UUID local,
       lo que llenaba Firestore con documentos anónimos con playerName "Invitado".
       play-games.js ya debería haber puesto _isSignedIn = false en este caso,
       pero esta comprobación actúa como segunda línea de defensa. */
    console.warn('[Leaderboard] isSignedIn=true pero playerId es null — escritura bloqueada.');
    return null;
  }

  /**
   * Para getRanking: devuelve el ID canónico para marcar "isMe" en la lista.
   * Usa PGS cuando está disponible; UUID local como fallback de solo lectura.
   */
  function _resolveReadPlayerId() {
    return _resolvePgsPlayerId() || _playerId;
  }

  function _getPlayerName() {
    if (_isPgsSignedIn()) {
      var info = PlayGamesService.getPlayerInfo();
      if (info && info.displayName) return info.displayName;
    }
    var local = storageLoad('player_name', null);
    if (local) return local;
    return typeof t === 'function' ? t('profile_guest') : 'Jugador';
  }

  /* Avatar PGS publicable (mismo criterio que marathon_scores): https y ≤ 512 */
  function _publicAvatar(url) {
    return (typeof url === 'string' && /^https:\/\/.+$/.test(url) && url.length <= 512) ? url : null;
  }

  function _getAvatarUrl() {
    if (!_isPgsSignedIn()) return null;
    var info = PlayGamesService.getPlayerInfo();
    return _publicAvatar(info && info.avatarUrl);
  }

  /* ── Fechas ─────────────────────────────────────────── */

  function formatDate(d) {
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }

  function getTodayKey() {
    return formatDate(new Date());
  }

  /* ══════════════════════════════════════════════════════
   * GEO: detectar país del jugador vía IP
   * ══════════════════════════════════════════════════════ */

  var COUNTRY_API    = 'https://api.country.is/';
  var _cachedCountry = null; /* caché en memoria durante la sesión */

  /**
   * Consulta la API de geolocalización por IP.
   * Devuelve el código ISO-2 del país ("ES", "MX"…) o null si falla.
   *
   * Estrategia de caché (tres capas):
   *   1. Memoria      — misma sesión, coste cero.
   *   2. localStorage — TTL 24 h, evita llamadas en aperturas sucesivas del día.
   *   3. Fetch real   — timeout 3 s; fallo silencioso, nunca bloquea el submit.
   *
   * @returns {Promise<string|null>}
   */
  function _fetchCountry() {
    /* 1. Caché en memoria */
    if (_cachedCountry !== null) {
      return Promise.resolve(_cachedCountry);
    }

    /* 2. Caché en localStorage (TTL 24 h) */
    var stored = storageLoad('player_country_cache', null);
    if (stored &&
        stored.ts &&
        (Date.now() - stored.ts < 86400000) &&
        typeof stored.country === 'string' &&
        stored.country.length === 2) {
      _cachedCountry = stored.country;
      return Promise.resolve(_cachedCountry);
    }

    /* 3. Fetch real con timeout de 3 segundos */
    var settled = false;

    var timeoutPromise = new Promise(function (resolve) {
      setTimeout(function () {
        if (!settled) {
          settled = true;
          console.warn('[Leaderboard] País: timeout alcanzado (3 s), se continúa sin país.');
          resolve(null);
        }
      }, 3000);
    });

    var fetchPromise = fetch(COUNTRY_API)
      .then(function (res) { return res.json(); })
      .then(function (data) {
        settled = true;
        var c = (data && typeof data.country === 'string' && data.country.length === 2)
          ? data.country.toUpperCase()
          : null;
        if (c) {
          _cachedCountry = c;
          storageSave('player_country_cache', { country: c, ts: Date.now() });
          console.log('[Leaderboard] 🌍 País detectado:', c);
        } else {
          console.warn('[Leaderboard] País: respuesta inesperada de la API:', data);
        }
        return c;
      })
      .catch(function (err) {
        settled = true;
        console.warn('[Leaderboard] País no detectado (error de red):', err.message || err);
        return null;
      });

    return Promise.race([fetchPromise, timeoutPromise]);
  }

  /* ══════════════════════════════════════════════════════
   * ENVIAR PUNTUACIÓN
   * ★ FASE 1: Solo se permite si el jugador está autenticado con PGS.
   * ★ FASE 3: Detecta país vía IP antes de escribir en Firestore.
   * ══════════════════════════════════════════════════════ */

  /**
   * Envía la puntuación del Reto del Día al ranking global.
   *
   * @param {number} score
   * @returns {Promise<boolean>} true si el envío fue exitoso o ya existía un score igual/mejor
   */
  function submitDailyScore(score) {
    if (!_isReady || !_db) return Promise.resolve(false);

    /* ★ FASE 1: requerir autenticación PGS para escribir en Firestore */
    var pid = _resolvePgsPlayerId();
    if (!pid) {
      console.log('[Leaderboard] Score NO enviado: jugador sin autenticación PGS.');
      return Promise.resolve(false);
    }

    var today = getTodayKey();
    var docId = pid + '_' + today;

    console.log('[Leaderboard] Enviando score. pid:', pid, '| docId:', docId, '| score:', score);

    /* ★ FASE 3: detectar país antes de escribir; fallo no bloquea el submit */
    return _fetchCountry().then(function (country) {
      return _db.collection(COLLECTION).doc(docId).get()
        .then(function (doc) {
          if (doc.exists && doc.data().score >= score) {
            console.log('[Leaderboard] Score existente igual o mejor — no se actualiza.');
            return true;
          }

          var payload = {
            date:       today,
            playerId:   pid,
            playerName: _getPlayerName(),
            score:      score,
            timestamp:  firebase.firestore.FieldValue.serverTimestamp()
          };
          var avatarUrl = _getAvatarUrl();
          if (avatarUrl) payload.avatarUrl = avatarUrl;

          /* Solo añadir el campo si la detección fue exitosa */
          if (country) {
            payload.country = country;
            var detectedContinent = (typeof getContinentForCountry === 'function') ? getContinentForCountry(country) : null;
            if (detectedContinent) payload.continent = detectedContinent;
          }

          return _db.collection(COLLECTION).doc(docId).set(payload)
            .then(function () {
              console.log('[Leaderboard] ✓ Score enviado:', score,
                country ? '| País: ' + country : '| País: no detectado');
              delete _cache[today]; /* Invalidar cache de hoy */
              /* Invalidar cache filtrado de hoy */
              var fKeys = Object.keys(_filteredCache);
              for (var fi = 0; fi < fKeys.length; fi++) {
                if (fKeys[fi].indexOf('daily|' + today) === 0) delete _filteredCache[fKeys[fi]];
              }
              _lastError = null;
              /* Actualizar ranking semanal — fallo no bloquea el resultado */
              _updateWeeklyScore(pid, _getPlayerName(), score, country, payload.continent || null)
                .catch(function (err) {
                  console.warn('[Leaderboard] ✗ Error actualizando score semanal:', err);
                });
              return true;
            });
        })
        .catch(function (err) {
          _lastError = err.message || String(err);
          console.error('[Leaderboard] ✗ Error submit:', err.code, err.message);
          return false;
        });
    });
  }

  /**
   * Envía el score de un día recuperado (ayer) al ranking global.
   * Funciona igual que submitDailyScore pero usa la fecha proporcionada.
   *
   * @param {number} score
   * @param {string} dateKey  Fecha en formato 'YYYY-MM-DD' — debe ser ayer
   * @returns {Promise<boolean>}
   */
  function submitRecoveredDailyScore(score, dateKey) {
    if (!_isReady || !_db) return Promise.resolve(false);

    var pid = _resolvePgsPlayerId();
    if (!pid) {
      console.log('[Leaderboard] Score recuperado NO enviado: jugador sin autenticación PGS.');
      return Promise.resolve(false);
    }

    var docId = pid + '_' + dateKey;

    console.log('[Leaderboard] Enviando score recuperado. pid:', pid, '| docId:', docId, '| score:', score);

    return _fetchCountry().then(function (country) {
      return _db.collection(COLLECTION).doc(docId).get()
        .then(function (doc) {
          if (doc.exists && doc.data().score >= score) {
            console.log('[Leaderboard] Score recuperado existente igual o mejor — no se actualiza.');
            return true;
          }

          var payload = {
            date:       dateKey,
            playerId:   pid,
            playerName: _getPlayerName(),
            score:      score,
            timestamp:  firebase.firestore.FieldValue.serverTimestamp()
          };
          var avatarUrl = _getAvatarUrl();
          if (avatarUrl) payload.avatarUrl = avatarUrl;

          if (country) {
            payload.country = country;
            var detectedContinent = (typeof getContinentForCountry === 'function') ? getContinentForCountry(country) : null;
            if (detectedContinent) payload.continent = detectedContinent;
          }

          return _db.collection(COLLECTION).doc(docId).set(payload)
            .then(function () {
              console.log('[Leaderboard] ✓ Score recuperado enviado:', score, '| Fecha:', dateKey);
              delete _cache[dateKey];
              /* Invalidar cache filtrado de ese día */
              var cachePrefix = 'daily|' + dateKey;
              var keys = Object.keys(_filteredCache);
              for (var i = 0; i < keys.length; i++) {
                if (keys[i].indexOf(cachePrefix) === 0) delete _filteredCache[keys[i]];
              }
              _lastError = null;
              /* Actualizar ranking semanal con la semana que contiene dateKey.
                 Parsear la fecha en UTC para evitar problemas de zona horaria. */
              if (typeof WeekUtils !== 'undefined') {
                var parts = dateKey.split('-');
                var dateForWeek = new Date(Date.UTC(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10)));
                var weekForDate = WeekUtils.getWeekId(dateForWeek);
                _updateWeeklyScore(pid, _getPlayerName(), score, country, payload.continent || null, dateKey, weekForDate)
                  .catch(function (err) {
                    console.warn('[Leaderboard] ✗ Error actualizando score semanal (recuperación):', err);
                  });
              }
              return true;
            });
        })
        .catch(function (err) {
          _lastError = err.message || String(err);
          console.error('[Leaderboard] ✗ Error submit recuperado:', err.code, err.message);
          return false;
        });
    });
  }

  /* ══════════════════════════════════════════════════════
   * RANKING SEMANAL
   * Acumula los scores diarios en weekly_scores.
   * ══════════════════════════════════════════════════════ */

  /**
   * Actualiza (o crea) el documento semanal del jugador en Firestore.
   * Solo persiste si el nuevo score del día es mejor que el ya registrado.
   *
   * @param {string}      pid
   * @param {string}      playerName
   * @param {number}      score
   * @param {string|null} country    Código ISO-2
   * @param {string|null} continent  Clave de continente
   * @param {string}      [dayKey]   Fecha del día (por defecto hoy)
   * @param {string}      [weekId]   Semana destino (por defecto semana actual)
   * @returns {Promise<void>}
   */
  function _updateWeeklyScore(pid, playerName, score, country, continent, dayKey, weekId) {
    if (!_db) return Promise.resolve();

    weekId    = weekId || WeekUtils.getWeekId();
    var today = dayKey || getTodayKey();
    var weekDocId = pid + '_' + weekId;

    return _db.collection(WEEKLY_COLLECTION).doc(weekDocId).get()
      .then(function (doc) {
        var breakdown = {};
        var missedDaysRecovered = 0;

        if (doc.exists) {
          var data = doc.data();
          breakdown           = data.dailyBreakdown  || {};
          missedDaysRecovered = data.missedDaysRecovered || 0;
        }

        /* Solo actualizar si el nuevo score es mejor que el ya registrado hoy */
        if (breakdown[today] && breakdown[today] >= score) {
          return;
        }

        breakdown[today] = score;

        /* Recalcular totales iterando el breakdown */
        var totalScore    = 0;
        var daysPlayed    = 0;
        var bestDayScore  = 0;
        var days = Object.keys(breakdown);
        for (var i = 0; i < days.length; i++) {
          var dayScore = breakdown[days[i]];
          totalScore += dayScore;
          daysPlayed++;
          if (dayScore > bestDayScore) bestDayScore = dayScore;
        }

        var payload = {
          weekId:              weekId,
          playerId:            pid,
          playerName:          playerName,
          totalScore:          totalScore,
          daysPlayed:          daysPlayed,
          bestDayScore:        bestDayScore,
          missedDaysRecovered: missedDaysRecovered,
          dailyBreakdown:      breakdown,
          lastUpdated:         firebase.firestore.FieldValue.serverTimestamp()
        };

        if (country)   payload.country   = country;
        if (continent) payload.continent = continent;
        var avatarUrl = _getAvatarUrl();
        if (avatarUrl) payload.avatarUrl = avatarUrl;

        return _db.collection(WEEKLY_COLLECTION).doc(weekDocId).set(payload);
      });
  }

  /* ══════════════════════════════════════════════════════
   * AVATARES DEL RANKING
   * ══════════════════════════════════════════════════════ */

  /* Los documentos anteriores a guardar avatarUrl no lo tienen: se toma
     del ranking de la Maratón (marathon_scores/{playerId}, lectura pública).
     Caché de sesión, incluidos los "sin avatar", para no repetir lecturas. */
  var _avatarCache = {};
  var AVATAR_BATCH = 10; /* Límite seguro del operador 'in' */

  function _fillAvatars(results) {
    results.forEach(function (r) {
      if (r.avatarUrl) _avatarCache[r.playerId] = r.avatarUrl;
    });
    var missing = [];
    results.forEach(function (r) {
      if (!r.avatarUrl && r.playerId && !(r.playerId in _avatarCache) &&
          missing.indexOf(r.playerId) === -1) missing.push(r.playerId);
    });

    var batches = [];
    for (var i = 0; i < missing.length; i += AVATAR_BATCH) {
      batches.push(missing.slice(i, i + AVATAR_BATCH));
    }

    return Promise.all(batches.map(function (ids) {
      return _db.collection('marathon_scores')
        .where(firebase.firestore.FieldPath.documentId(), 'in', ids).get()
        .then(function (snap) {
          ids.forEach(function (id) { _avatarCache[id] = null; });
          snap.forEach(function (doc) { _avatarCache[doc.id] = _publicAvatar(doc.data().avatarUrl); });
        })
        .catch(function (err) { console.warn('[Leaderboard] Avatares no disponibles:', err && err.code); });
    })).then(function () {
      results.forEach(function (r) {
        if (!r.avatarUrl) r.avatarUrl = _avatarCache[r.playerId] || null;
      });
      return results;
    });
  }

  /* ══════════════════════════════════════════════════════
   * RANKING FILTRADO (diario o semanal, con filtros geo)
   * ══════════════════════════════════════════════════════ */

  /**
   * Consulta el ranking con filtros opcionales de período y geografía.
   *
   * @param {object} opts
   * @param {string}  opts.period    'daily' | 'weekly'
   * @param {string}  opts.dateKey   'YYYY-MM-DD' (daily) o 'YYYY-WNN' (weekly)
   * @param {string}  [opts.country]   Filtro por país ISO-2
   * @param {string}  [opts.continent] Filtro por continente (ignorado si hay country)
   * @param {number}  [opts.limit=50]
   * @returns {Promise<Array>}
   */
  function getFilteredRanking(opts) {
    if (!_isReady || !_db) return Promise.reject(new Error('Firebase no inicializado'));

    opts = opts || {};
    var period     = opts.period    || 'daily';
    var dateKey    = opts.dateKey   || getTodayKey();
    var limitVal   = opts.limit     || 50;
    var filterCountry   = opts.country   || null;
    var filterContinent = opts.continent || null;

    /* Clave de cache compuesta: period|dateKey|country|continent */
    var cacheKey = period + '|' + dateKey + '|' + (filterCountry || '') + '|' + (filterContinent || '');
    var cached = _filteredCache[cacheKey];
    if (cached && (Date.now() - cached.ts < CACHE_TTL)) {
      console.log('[Leaderboard] Cache hit (filtered):', cacheKey);
      return Promise.resolve(cached.data.slice(0, limitVal));
    }

    var collection = (period === 'weekly') ? WEEKLY_COLLECTION : COLLECTION;
    var dateField  = (period === 'weekly') ? 'weekId'     : 'date';
    var scoreField = (period === 'weekly') ? 'totalScore' : 'score';

    var query = _db.collection(collection).where(dateField, '==', dateKey);

    if (filterCountry) {
      query = query.where('country', '==', filterCountry);
    } else if (filterContinent) {
      query = query.where('continent', '==', filterContinent);
    }

    query = query.orderBy(scoreField, 'desc').limit(limitVal);

    return query.get()
      .then(function (snapshot) {
        var myPid   = _resolveReadPlayerId();
        var results = [];

        snapshot.forEach(function (doc) {
          var data = doc.data();
          var entry = {
            playerId:   data.playerId,
            playerName: data.playerName || 'Jugador',
            score:      data[scoreField],
            country:    data.country   || null,
            continent:  data.continent || null,
            avatarUrl:  _publicAvatar(data.avatarUrl),
            isMe:       data.playerId === myPid
          };
          if (period === 'weekly') {
            entry.daysPlayed = data.daysPlayed || 0;
          }
          results.push(entry);
        });

        /* Añadir posición */
        results.forEach(function (r, i) { r.position = i + 1; });

        return _fillAvatars(results);
      })
      .then(function (results) {
        /* Guardar en cache */
        _filteredCache[cacheKey] = { data: results, ts: Date.now() };
        return results;
      })
      .catch(function (err) {
        _lastError = err.message || String(err);
        console.error('[Leaderboard] ✗ Error getFilteredRanking:', err.code, err.message);
        throw err;
      });
  }

  /* ══════════════════════════════════════════════════════
   * LEER RANKING (cualquier fecha)
   * ══════════════════════════════════════════════════════ */

  /**
   * @param {string} dateKey — 'YYYY-MM-DD'
   * @param {number} [limit=50]
   * @returns {Promise<Array<{playerId, playerName, score, country, isMe, position}>>}
   */
  function getRanking(dateKey, limit) {
    if (!_isReady || !_db) return Promise.reject(new Error('Firebase no inicializado'));

    limit = limit || 50;

    /* Cache check */
    var cached = _cache[dateKey];
    if (cached && (Date.now() - cached.ts < CACHE_TTL)) {
      console.log('[Leaderboard] Cache hit:', dateKey);
      return Promise.resolve(cached.data.slice(0, limit));
    }

    return _db.collection(COLLECTION)
      .where('date', '==', dateKey)
      .orderBy('score', 'desc')
      .limit(limit)
      .get()
      .then(function (snapshot) {
        var myPid = _resolveReadPlayerId();
        var results = [];
        snapshot.forEach(function (doc) {
          var data = doc.data();
          results.push({
            playerId:   data.playerId,
            playerName: data.playerName || 'Jugador',
            score:      data.score,
            country:    data.country || null, /* ★ FASE 3: exponer país para futuros rankings regionales */
            isMe:       data.playerId === myPid
          });
        });

        /* Ordenar por nombre en caso de empate (Firestore ya ordena por score desc) */
        results.sort(function (a, b) {
          return a.playerName.localeCompare(b.playerName);
        });

        /* Añadir posición */
        results.forEach(function (r, i) { r.position = i + 1; });

        /* Guardar en cache */
        _cache[dateKey] = { data: results, ts: Date.now() };

        return results;
      })
      .catch(function (err) {
        _lastError = err.message || String(err);
        console.error('[Leaderboard] ✗ Error read:', err.code, err.message);
        throw err;
      });
  }

  /* ══════════════════════════════════════════════════════
   * SINCRONIZAR ESTADO DIARIO DESDE FIRESTORE
   * ★ FASE 2: Solo opera con PGS activo.
   * ══════════════════════════════════════════════════════ */

  /**
   * Comprueba en Firestore si el jugador ya jugó el reto del día y,
   * si es así, restaura la marca local (útil tras reinstalar la app).
   *
   * ★ FASE 2: Si el jugador no está autenticado con PGS, no hay forma
   * de identificarlo de forma fiable entre reinstalaciones → omitir.
   *
   * @returns {Promise<boolean>} true si se restauró el estado
   */
  function syncDailyStatusFromFirestore() {
    if (!_isReady || !_db) return Promise.resolve(false);
    if (isDailyCompleted()) return Promise.resolve(false);

    /* ★ FASE 2: Exigir PGS para buscar */
    var pid = _resolvePgsPlayerId();
    if (!pid) {
      console.log('[Leaderboard] Sync omitido: jugador sin PGS — no hay ID estable.');
      return Promise.resolve(false);
    }

    var today = getTodayKey();
    var docId = pid + '_' + today;

    return _db.collection(COLLECTION).doc(docId).get()
      .then(function (doc) {
        if (doc.exists) {
          var data = doc.data();
          if (typeof data.score === 'number') {
            markDailyCompleted(data.score);
            console.log('[Leaderboard] ✓ Estado diario restaurado desde Firestore, puntuación:', data.score);
            return true;
          }
        }
        return false;
      })
      .catch(function (err) {
        console.warn('[Leaderboard] Error al sincronizar estado diario:', err);
        return false;
      });
  }

  /* ══════════════════════════════════════════════════════
   * POSICIÓN DEL JUGADOR
   * ══════════════════════════════════════════════════════ */

  /**
   * Busca la posición del jugador actual en un día concreto.
   * @returns {Promise<{position, score, total}|null>}
   */
  function getMyPosition(dateKey) {
    return getRanking(dateKey, 200).then(function (entries) {
      var total = entries.length;
      for (var i = 0; i < entries.length; i++) {
        if (entries[i].isMe) {
          return { position: entries[i].position, score: entries[i].score, total: total };
        }
      }
      return null;
    });
  }

  /* ── API pública ─────────────────────────────────────── */

  return {
    init:                         init,
    submitDailyScore:             submitDailyScore,
    submitRecoveredDailyScore:    submitRecoveredDailyScore,
    syncDailyStatusFromFirestore: syncDailyStatusFromFirestore,
    getRanking:                   getRanking,
    getFilteredRanking:           getFilteredRanking,
    getMyPosition:                getMyPosition,
    getTodayKey:                  getTodayKey,
    formatDate:                   formatDate,
    /* Detección de país reutilizable (misma lógica y caché que el reto diario).
       Usado por PlayerProfile para el campo `country` del documento players/{id}. */
    getPlayerCountry:             _fetchCountry,
    isReady:      function () { return _isReady; },
    getPlayerId:  function () { return _playerId; },
    getLastError: function () { return _lastError; }
  };

})();
