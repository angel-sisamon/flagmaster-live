/**
 * js/tournaments.js — FlagMaster · Sistema de Torneos
 *
 * TournamentService: IIFE global.
 * Depende de: firebase (SDK compat), PlayGamesService, storage.js
 *
 * API pública:
 *   init()                              → bool
 *   isEnabled()                         → Promise<boolean>
 *   getOpenTournaments()                → Promise<Array>
 *   getOpenTournamentByMode(mode)       → Promise<object|null>
 *   getClosedTournaments(mode, limit)   → Promise<Array>
 *   getTournamentById(id)               → Promise<object|null>
 *   getLiveRanking(tournamentId, limit) → Promise<Array>
 *   getClosedRanking(tournamentDoc)     → Array
 *   submitScore(tournament, result)     → Promise<boolean>
 *   buildTournamentQuestions(tournament)→ Array
 *   computeTournamentSeed(startDateKey, mode) → number
 *
 * ORDEN DE CARGA: después de firebase-leaderboard.js, antes de tournaments-ui.js y main.js
 */

var TournamentService = (function () {
  'use strict';

  /* ── Estado interno ────────────────────────────────────────────── */
  var _ready = false;
  var _db    = null;

  /* ── Caché en memoria ──────────────────────────────────────────── */
  var _flagCache       = null;  // { value: bool, ts: number }
  var _openCache       = null;  // { data: Array, ts: number }
  var FLAG_CACHE_TTL   = 300000;  // 5 min
  var OPEN_CACHE_TTL   = 30000;   // 30 s

  /* ── Geo / country ─────────────────────────────────────────────── */
  var COUNTRY_API    = 'https://api.country.is/';
  var _cachedCountry = null;

  /* ── Salts por modo (idéntico al servidor) ──────────────────────── */
  var MODE_SALTS = {
    'guess-country':              0x9E3779B1,
    'guess-flag':                 0x85EBCA77,
    'guess-capital':              0xC2B2AE3D,
    'guess-country-from-capital': 0x27D4EB2F
  };

  /* ══════════════════════════════════════════════════════════════════
     INIT
     ══════════════════════════════════════════════════════════════════ */

  function init() {
    if (typeof firebase === 'undefined' || !firebase.firestore) {
      console.warn('[TournamentService] Firestore no disponible.');
      _ready = false;
      return false;
    }
    try {
      _db    = firebase.firestore();
      _ready = true;
      console.log('[TournamentService] ✓ Init OK');
    } catch (e) {
      console.warn('[TournamentService] Error al obtener Firestore:', e);
      _ready = false;
    }
    return _ready;
  }

  /* ══════════════════════════════════════════════════════════════════
     FEATURE FLAG
     ══════════════════════════════════════════════════════════════════ */

  /**
   * Lee app_config/flags.tournamentsEnabled con caché de 5 min.
   * @returns {Promise<boolean>}
   */
  function isEnabled() {
    if (!_ready) return Promise.resolve(false);

    if (_flagCache && (Date.now() - _flagCache.ts) < FLAG_CACHE_TTL) {
      return Promise.resolve(_flagCache.value);
    }

    return _db.doc('app_config/flags').get()
      .then(function (snap) {
        var value = snap.exists && snap.data().tournamentsEnabled === true;
        _flagCache = { value: value, ts: Date.now() };
        return value;
      })
      .catch(function (err) {
        console.warn('[TournamentService] isEnabled error:', err);
        return false;
      });
  }

  /* ══════════════════════════════════════════════════════════════════
     SEED (idéntico al servidor — bit a bit)
     ══════════════════════════════════════════════════════════════════ */

  /**
   * Calcula el seed Park-Miller para un torneo.
   * Esta función es idéntica a functions/src/seed.js.
   *
   * @param {string} startDateKey  — 'YYYY-MM-DD'
   * @param {string} mode          — uno de los 4 modos de torneo
   * @returns {number}             — Park-Miller válido (1 … 2^31-2)
   */
  function computeTournamentSeed(startDateKey, mode) {
    var parts   = startDateKey.split('-').map(Number);
    var y = parts[0], m = parts[1], d = parts[2];
    var baseInt = (y - 20) * 10000 + m * 100 + d;     // año - 20 (reduce el rango del entero base)
    var h = ((0x811C9DC5 ^ MODE_SALTS[mode]) >>> 0);   // FNV-1a 32-bit con sal
    var buf = String(baseInt) + '|' + mode;
    for (var i = 0; i < buf.length; i++) {
      h ^= buf.charCodeAt(i);
      h = (Math.imul(h, 0x01000193) >>> 0);
    }
    var s = h % 2147483646;
    if (s === 0) s = 1;
    return s;
  }

  /* ══════════════════════════════════════════════════════════════════
     IDENTIDAD DEL JUGADOR
     ══════════════════════════════════════════════════════════════════ */

  function _isPgsSignedIn() {
    return typeof PlayGamesService !== 'undefined' && PlayGamesService.isSignedIn();
  }

  /**
   * Devuelve el ID PGS para escritura, o null si no está autenticado.
   * Misma lógica que _resolvePgsPlayerId en firebase-leaderboard.js.
   * @returns {string|null}
   */
  function _resolvePgsPlayerId() {
    if (!_isPgsSignedIn()) return null;
    var info = PlayGamesService.getPlayerInfo();
    if (info && info.playerId) return info.playerId;
    console.warn('[TournamentService] isSignedIn=true pero playerId es null — escritura bloqueada.');
    return null;
  }

  /**
   * ID para lectura (PGS si disponible, UUID local de fallback).
   * @returns {string}
   */
  function _resolveReadPlayerId() {
    var pgs = _resolvePgsPlayerId();
    if (pgs) return pgs;
    var local = storageLoad('firebase_player_id', null);
    return local || 'anon';
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

  /* ══════════════════════════════════════════════════════════════════
     GEO: detectar país del jugador vía IP
     ══════════════════════════════════════════════════════════════════ */

  function _fetchCountry() {
    if (_cachedCountry !== null) return Promise.resolve(_cachedCountry);

    var stored = storageLoad('player_country_cache', null);
    if (stored && stored.ts && (Date.now() - stored.ts < 86400000) &&
        typeof stored.country === 'string' && stored.country.length === 2) {
      _cachedCountry = stored.country;
      return Promise.resolve(_cachedCountry);
    }

    var settled = false;

    var timeoutPromise = new Promise(function (resolve) {
      setTimeout(function () {
        if (!settled) { settled = true; resolve(null); }
      }, 3000);
    });

    var fetchPromise = fetch(COUNTRY_API)
      .then(function (res) { return res.json(); })
      .then(function (data) {
        settled = true;
        var c = (data && typeof data.country === 'string' && data.country.length === 2)
          ? data.country.toUpperCase() : null;
        if (c) {
          _cachedCountry = c;
          storageSave('player_country_cache', { country: c, ts: Date.now() });
        }
        return c;
      })
      .catch(function () { settled = true; return null; });

    return Promise.race([fetchPromise, timeoutPromise]);
  }

  /* ══════════════════════════════════════════════════════════════════
     CONSULTAS DE TORNEOS
     ══════════════════════════════════════════════════════════════════ */

  var MODES_4 = [
    'guess-country',
    'guess-flag',
    'guess-capital',
    'guess-country-from-capital'
  ];

  /**
   * Devuelve los torneos abiertos (uno por modo). Caché 30 s.
   * @returns {Promise<Array>}
   */
  function getOpenTournaments() {
    if (!_ready) return Promise.resolve([]);

    if (_openCache && (Date.now() - _openCache.ts) < OPEN_CACHE_TTL) {
      return Promise.resolve(_openCache.data);
    }

    var queries = MODES_4.map(function (mode) {
      return _db.collection('tournaments')
        .where('mode', '==', mode)
        .where('status', '==', 'open')
        .limit(1)
        .get()
        .then(function (snap) {
          return snap.empty ? null : _docToTournament(snap.docs[0]);
        });
    });

    return Promise.all(queries).then(function (results) {
      var data = results.filter(Boolean);
      _openCache = { data: data, ts: Date.now() };
      return data;
    });
  }

  /**
   * Devuelve el torneo abierto de un modo concreto.
   * @param {string} mode
   * @returns {Promise<object|null>}
   */
  function getOpenTournamentByMode(mode) {
    if (!_ready) return Promise.resolve(null);
    return _db.collection('tournaments')
      .where('mode', '==', mode)
      .where('status', '==', 'open')
      .limit(1)
      .get()
      .then(function (snap) {
        return snap.empty ? null : _docToTournament(snap.docs[0]);
      });
  }

  /**
   * Devuelve torneos cerrados de un modo (paginado, ordenado por startDateKey desc).
   * @param {string} mode
   * @param {number} [limit=20]
   * @returns {Promise<Array>}
   */
  function getClosedTournaments(mode, limit) {
    if (!_ready) return Promise.resolve([]);
    return _db.collection('tournaments')
      .where('mode', '==', mode)
      .where('status', '==', 'closed')
      .orderBy('startDateKey', 'desc')
      .limit(limit || 20)
      .get()
      .then(function (snap) {
        return snap.docs.map(_docToTournament);
      });
  }

  /**
   * Devuelve un torneo por su ID.
   * @param {string} id
   * @returns {Promise<object|null>}
   */
  function getTournamentById(id) {
    if (!_ready) return Promise.resolve(null);
    return _db.doc('tournaments/' + id).get()
      .then(function (snap) {
        return snap.exists ? _docToTournament(snap) : null;
      });
  }

  /**
   * Convierte un DocumentSnapshot a un objeto de torneo plano.
   */
  function _docToTournament(snap) {
    var data = snap.data();
    return {
      id:           snap.id,
      tournamentId: data.tournamentId,
      mode:         data.mode,
      status:       data.status,
      startDateKey: data.startDateKey,
      endsAt:       data.endsAt,
      createdAt:    data.createdAt,
      closedAt:     data.closedAt,
      seed:         data.seed,
      gameConfig:   data.gameConfig,
      topPlayers:   data.topPlayers || null
    };
  }

  /* ══════════════════════════════════════════════════════════════════
     RANKING EN VIVO
     ══════════════════════════════════════════════════════════════════ */

  /**
   * Obtiene el ranking en vivo de tournament_scores para un torneo abierto.
   * Marca isMe según el jugador actual.
   *
   * @param {string} tournamentId
   * @param {number} [limit=100]
   * @returns {Promise<Array>}
   */
  function getLiveRanking(tournamentId, limit) {
    if (!_ready) return Promise.resolve([]);
    var myId = _resolveReadPlayerId();

    return _db.collection('tournament_scores')
      .where('tournamentId', '==', tournamentId)
      .orderBy('score', 'desc')
      .limit(limit || 100)
      .get()
      .then(function (snap) {
        return snap.docs.map(function (d, idx) {
          var x = d.data();
          return {
            position:   idx + 1,
            playerId:   x.playerId,
            playerName: x.playerName,
            score:      x.score,
            correct:    x.correct,
            wrong:      x.wrong,
            maxStreak:  x.maxStreak,
            country:    x.country   || null,
            continent:  x.continent || null,
            isMe:       x.playerId === myId
          };
        });
      });
  }

  /**
   * Devuelve el ranking final de un torneo cerrado (ya denormalizado en topPlayers).
   * @param {object} tournamentDoc — objeto con propiedad topPlayers
   * @returns {Array}
   */
  function getClosedRanking(tournamentDoc) {
    var players = tournamentDoc.topPlayers || [];
    var myId    = _resolveReadPlayerId();
    return players.map(function (p, idx) {
      return {
        position:   idx + 1,
        playerId:   p.playerId,
        playerName: p.playerName,
        score:      p.score,
        correct:    p.correct,
        wrong:      p.wrong,
        maxStreak:  p.maxStreak,
        country:    p.country    || null,
        continent:  p.continent  || null,
        isMe:       p.playerId === myId
      };
    });
  }

  /* ══════════════════════════════════════════════════════════════════
     ENVIAR PUNTUACIÓN
     Patrón "mejor score gana": lee primero, no sobrescribe si es peor.
     Requiere PGS sign-in.
     ══════════════════════════════════════════════════════════════════ */

  /**
   * Envía la puntuación de un torneo.
   *
   * @param {object} tournament  — objeto torneo (con id, mode, status)
   * @param {object} result      — { score, correct, wrong, maxStreak }
   * @returns {Promise<boolean>} — true si se registró, false si no
   */
  function submitScore(tournament, result) {
    if (!_ready || !_db) return Promise.resolve(false);

    /* Solo para torneos abiertos */
    if (!tournament || tournament.status !== 'open') return Promise.resolve(false);

    /* Requerir autenticación PGS */
    var pid = _resolvePgsPlayerId();
    if (!pid) {
      console.log('[TournamentService] Score NO enviado: sin autenticación PGS.');
      return Promise.resolve(false);
    }

    var scoreId = tournament.id + '__' + pid;

    return _fetchCountry().then(function (country) {
      return _db.collection('tournament_scores').doc(scoreId).get()
        .then(function (doc) {
          if (doc.exists && doc.data().score >= result.score) {
            console.log('[TournamentService] Score existente igual o mejor — no se actualiza.');
            return true;
          }

          var payload = {
            tournamentId: tournament.id,
            mode:         tournament.mode,
            playerId:     pid,
            playerName:   _getPlayerName(),
            score:        result.score    || 0,
            correct:      result.correct  || 0,
            wrong:        result.wrong    || 0,
            maxStreak:    result.maxStreak || 0,
            submittedAt:  firebase.firestore.FieldValue.serverTimestamp()
          };

          if (country) {
            payload.country = country;
            /* Detectar continente desde country (tabla mínima de regiones) */
            var cont = _countryToContinent(country);
            if (cont) payload.continent = cont;
          }

          return _db.collection('tournament_scores').doc(scoreId).set(payload)
            .then(function () {
              /* Invalidar caché de torneos abiertos para que se refresque */
              _openCache = null;
              console.log('[TournamentService] Score enviado:', scoreId, '| score:', result.score);
              return true;
            });
        });
    });
  }

  /* Tabla mínima país → continente (ISO-3166-alpha2 → código 2 chars) */
  function _countryToContinent(iso2) {
    var EU = ['AD','AL','AT','BA','BE','BG','BY','CH','CY','CZ','DE','DK','EE','ES',
              'FI','FR','GB','GR','HR','HU','IE','IS','IT','LI','LT','LU','LV','MC',
              'MD','ME','MK','MT','NL','NO','PL','PT','RO','RS','RU','SE','SI','SK',
              'SM','TR','UA','VA','XK'];
    var AM = ['AG','AR','BB','BO','BR','BS','BZ','CA','CL','CO','CR','CU','DM','DO',
              'EC','GD','GT','GY','HN','HT','JM','KN','LC','MX','NI','PA','PE','PY',
              'SR','SV','TT','US','UY','VC','VE'];
    var AS = ['AE','AF','AM','AZ','BD','BH','BN','BT','CN','CY','GE','ID','IL','IN',
              'IQ','IR','JO','JP','KG','KH','KP','KR','KW','KZ','LA','LB','LK','MM',
              'MN','MV','MY','NP','OM','PH','PK','PS','QA','SA','SG','SY','TH','TJ',
              'TL','TM','TW','UZ','VN','YE'];
    var AF = ['AO','BF','BI','BJ','BW','CD','CF','CG','CI','CM','CV','DJ','DZ','EG',
              'ER','ET','GA','GH','GM','GN','GQ','GW','KE','KM','LR','LS','LY','MA',
              'MG','ML','MR','MU','MW','MZ','NA','NE','NG','RW','SC','SD','SL','SN',
              'SO','SS','ST','SZ','TD','TG','TN','TZ','UG','ZA','ZM','ZW'];
    var OC = ['AU','FJ','FM','KI','MH','NR','NZ','PG','PW','SB','TO','TV','VU','WS'];
    if (EU.indexOf(iso2) !== -1) return 'EU';
    if (AM.indexOf(iso2) !== -1) return 'AM';
    if (AS.indexOf(iso2) !== -1) return 'AS';
    if (AF.indexOf(iso2) !== -1) return 'AF';
    if (OC.indexOf(iso2) !== -1) return 'OC';
    return null;
  }

  /* ══════════════════════════════════════════════════════════════════
     CONSTRUCCIÓN DE PREGUNTAS
     Delega en DuelService.buildDuelQuestions con seed y gameConfig del torneo.
     ══════════════════════════════════════════════════════════════════ */

  /**
   * Construye las preguntas de un torneo de forma determinista.
   * @param {object} tournament — objeto torneo con seed y gameConfig
   * @returns {Array}
   */
  function buildTournamentQuestions(tournament) {
    if (typeof DuelService === 'undefined') {
      console.error('[TournamentService] DuelService no disponible.');
      return [];
    }
    return DuelService.buildDuelQuestions(tournament.seed, tournament.gameConfig);
  }

  /* ══════════════════════════════════════════════════════════════════
     UTILIDADES
     ══════════════════════════════════════════════════════════════════ */

  /**
   * Calcula el tiempo restante hasta endsAt y lo devuelve formateado.
   * @param {object} tournament — objeto torneo con endsAt (Timestamp de Firestore)
   * @returns {string}
   */
  function formatTimeRemaining(tournament) {
    if (!tournament || !tournament.endsAt) return '';
    var msLeft = tournament.endsAt.toMillis() - Date.now();
    if (msLeft <= 0) return '00:00:00';
    var totalSecs = Math.floor(msLeft / 1000);
    var days  = Math.floor(totalSecs / 86400);
    var hours = Math.floor((totalSecs % 86400) / 3600);
    var mins  = Math.floor((totalSecs % 3600) / 60);
    if (days > 0) return days + 'd ' + hours + 'h ' + mins + 'm';
    return String(hours).padStart(2, '0') + ':' +
           String(mins).padStart(2, '0') + ':' +
           String(totalSecs % 60).padStart(2, '0');
  }

  /**
   * Devuelve el score del jugador actual en un torneo, o null si no ha jugado.
   * @param {string} tournamentId
   * @returns {Promise<object|null>}
   */
  function getMyScore(tournamentId) {
    if (!_ready) return Promise.resolve(null);
    var pid = _resolvePgsPlayerId();
    if (!pid) return Promise.resolve(null);
    var scoreId = tournamentId + '__' + pid;
    return _db.collection('tournament_scores').doc(scoreId).get()
      .then(function (snap) { return snap.exists ? snap.data() : null; });
  }

  /* ══════════════════════════════════════════════════════════════════
     API PÚBLICA
     ══════════════════════════════════════════════════════════════════ */

  return {
    init:                   init,
    isEnabled:              isEnabled,
    getOpenTournaments:     getOpenTournaments,
    getOpenTournamentByMode:getOpenTournamentByMode,
    getClosedTournaments:   getClosedTournaments,
    getTournamentById:      getTournamentById,
    getLiveRanking:         getLiveRanking,
    getClosedRanking:       getClosedRanking,
    submitScore:            submitScore,
    buildTournamentQuestions:buildTournamentQuestions,
    computeTournamentSeed:  computeTournamentSeed,
    formatTimeRemaining:    formatTimeRemaining,
    getMyScore:             getMyScore,
    isReady: function () { return _ready; }
  };

}());
