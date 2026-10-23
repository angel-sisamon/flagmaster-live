/**
 * js/duels.js — FlagMaster · Duelos Asíncronos (Async PvP)
 *
 * DuelService: IIFE global.
 * Depende de: firebase (SDK compat), PlayGamesService, seededRng, seededShuffle,
 *             getCountriesByContinent, getDistractors, COUNTRIES, t, storageLoad, storageSave,
 *             delay (utils.js), LocalNotifications (@capacitor/local-notifications, via NotificationService)
 */
var DuelService = (function () {
  'use strict';

  /* ── Charset sin ambigüedad (sin O, 0, I, 1) ────────────────── */
  var CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

  /* ── Rango de IDs de notificación para duelos ────────────────── */
  var NOTIF_ID_BASE = 2000;

  /* ── Caché en memoria con TTL 60 s ──────────────────────────── */
  var _cache = {};   // { [shareCode]: { data, ts } }
  var CACHE_TTL = 60000;

  /* ── Estado de inicialización ────────────────────────────────── */
  var _ready = false;
  var _db    = null;

  /* ══════════════════════════════════════════════════════════════
     INIT
     ══════════════════════════════════════════════════════════════ */

  /**
   * init() → bool
   * Verifica que Firestore esté disponible y guarda la referencia.
   */
  function init() {
    if (typeof firebase === 'undefined' || !firebase.firestore) {
      console.warn('[DuelService] Firestore no disponible.');
      _ready = false;
      return false;
    }
    try {
      _db    = firebase.firestore();
      _ready = true;
    } catch (e) {
      console.warn('[DuelService] Error al obtener Firestore:', e);
      _ready = false;
    }
    return _ready;
  }

  /* ══════════════════════════════════════════════════════════════
     UTILIDADES PRIVADAS
     ══════════════════════════════════════════════════════════════ */

  /** Genera un shareCode de 6 caracteres del charset sin ambigüedad. */
  function _generateCode() {
    var code = '';
    for (var i = 0; i < 6; i++) {
      code += CHARSET.charAt(Math.floor(Math.random() * CHARSET.length));
    }
    return code;
  }

  /** Genera un seed Park-Miller válido (1 … 2^31 - 2). */
  function generateDuelSeed() {
    return Math.floor(Math.random() * 2147483646) + 1;
  }

  /**
   * Construye el array de preguntas de un duelo de forma determinista.
   * Mismo formato que initGame espera en prebuiltQuestions:
   *   [ { correct, options, correctIndex } ]
   *
   * @param {number} seed
   * @param {{ mode:string, numQuestions:number, continent:string }} config
   * @returns {Array}
   */
  function buildDuelQuestions(seed, config) {
    var rng      = seededRng(seed);
    var pool     = getCountriesByContinent(config.continent || 'all');
    var shuffled = seededShuffle(pool.slice(), rng);
    var selected = shuffled.slice(0, config.numQuestions);

    return selected.map(function (correct) {
      var distractors = getDistractors(correct.code, 3);
      var options     = seededShuffle([correct].concat(distractors), rng);
      var ci = -1;
      for (var i = 0; i < options.length; i++) {
        if (options[i].code === correct.code) { ci = i; break; }
      }
      return { correct: correct, options: options, correctIndex: ci };
    });
  }

  /** Sanitiza la vista del duelo para el espectador (oculta score de A si B no ha jugado). */
  function _buildDuelView(data, viewerId) {
    var view = JSON.parse(JSON.stringify(data));
    // Ocultar score de A si B aún no ha completado y el viewer no es A
    if (data.status === 'waiting' && data.playerA && viewerId !== data.playerA.id) {
      view.playerA = {
        id:   data.playerA.id,
        name: data.playerA.name
      };
    }
    return view;
  }

  /** Invalida la entrada de caché para un código. */
  function _invalidateCache(shareCode) {
    delete _cache[shareCode];
  }

  /* ══════════════════════════════════════════════════════════════
     API PÚBLICA
     ══════════════════════════════════════════════════════════════ */

  /**
   * createDuel(config, seed, result) → Promise<duelView>
   *
   * @param {{ mode, numQuestions, continent }} config
   * @param {number} seed  — entero Park-Miller
   * @param {{ id, name, score, correct, wrong, maxStreak }} result  — de Player A
   * @returns {Promise<object>} duelView con el documento creado
   */
  function createDuel(config, seed, result) {
    if (!_ready) return Promise.reject(new Error('DuelService not ready'));

    var shareCode = _generateCode();
    var now       = firebase.firestore.Timestamp.now();
    var expiresAt = firebase.firestore.Timestamp.fromMillis(
      Date.now() + 7 * 24 * 60 * 60 * 1000
    );

    var doc = {
      shareCode:    shareCode,
      participants: [result.id],
      status:       'waiting',
      createdAt:    now,
      expiresAt:    expiresAt,
      gameConfig:   config,
      seed:         seed,
      playerA: {
        id:          result.id,
        name:        result.name,
        score:       result.score,
        correct:     result.correct,
        wrong:       result.wrong,
        maxStreak:   result.maxStreak,
        completedAt: now
      },
      playerB: null,
      winner:  null
    };

    return _db.collection('duels').doc(shareCode).set(doc)
      .then(function () {
        _scheduleReminderNotifications(shareCode, expiresAt.toDate());
        _cache[shareCode] = { data: doc, ts: Date.now() };
        return _buildDuelView(doc, result.id);
      });
  }

  /**
   * getDuelByCode(shareCode) → Promise<duelView|null>
   * Usa caché de 60 s. Sanitiza score de A si viewer no es A y B no ha jugado.
   *
   * @param {string} shareCode
   * @param {string} [viewerId]  — ID del jugador que consulta (para sanitización)
   * @returns {Promise<object|null>}
   */
  function getDuelByCode(shareCode, viewerId) {
    if (!_ready) return Promise.reject(new Error('DuelService not ready'));

    var code = (shareCode || '').toUpperCase().trim();
    var cached = _cache[code];
    if (cached && (Date.now() - cached.ts) < CACHE_TTL) {
      return Promise.resolve(_buildDuelView(cached.data, viewerId || ''));
    }

    return _db.collection('duels').doc(code).get()
      .then(function (snap) {
        if (!snap.exists) return null;
        var data = snap.data();
        _cache[code] = { data: data, ts: Date.now() };
        return _buildDuelView(data, viewerId || '');
      });
  }

  /**
   * resolveAsDuelB(shareCode, result) → Promise<duelView>
   * Player B completa el duelo: guarda su resultado, determina winner, cierra el duelo.
   *
   * @param {string} shareCode
   * @param {{ id, name, score, correct, wrong, maxStreak }} result  — de Player B
   * @returns {Promise<object>} duelView con resultado final
   */
  function resolveAsDuelB(shareCode, result) {
    if (!_ready) return Promise.reject(new Error('DuelService not ready'));

    var code = (shareCode || '').toUpperCase().trim();
    var now  = firebase.firestore.Timestamp.now();

    return _db.collection('duels').doc(code).get()
      .then(function (snap) {
        if (!snap.exists) throw new Error('not_found');
        var data = snap.data();
        if (data.status !== 'waiting')           throw new Error('already_completed');
        if (data.expiresAt.toDate() < new Date()) throw new Error('expired');
        if (data.playerA && data.playerA.id === result.id) throw new Error('own_duel');

        var winner;
        if (result.score > data.playerA.score)      { winner = result.id; }
        else if (result.score < data.playerA.score) { winner = data.playerA.id; }
        else                                         { winner = 'draw'; }

        var playerB = {
          id:          result.id,
          name:        result.name,
          score:       result.score,
          correct:     result.correct,
          wrong:       result.wrong,
          maxStreak:   result.maxStreak,
          completedAt: now
        };

        var update = {
          participants: firebase.firestore.FieldValue.arrayUnion(result.id),
          status:       'completed',
          playerB:      playerB,
          winner:       winner
        };

        return _db.collection('duels').doc(code).update(update)
          .then(function () {
            _invalidateCache(code);
            var existingParticipants = data.participants || [];
            var mergedParticipants = existingParticipants.indexOf(result.id) === -1
              ? existingParticipants.concat([result.id])
              : existingParticipants.slice();
            var fullData = Object.assign({}, data, update, {
              participants: mergedParticipants
            });
            return _buildDuelView(fullData, result.id);
          });
      });
  }

  /**
   * getMyDuels() → Promise<Array<duelView>>
   * Obtiene los duelos donde participa el jugador actual.
   * Ordena en cliente. Filtra los > 30 días en cliente.
   *
   * @returns {Promise<Array>}
   */
  function getMyDuels() {
    if (!_ready) return Promise.resolve([]);

    var player = PlayGamesService.getPlayerInfo();
    if (!player || !player.playerId) return Promise.resolve([]);

    var myId      = player.playerId;
    var cutoff    = Date.now() - 30 * 24 * 60 * 60 * 1000;

    return _db.collection('duels')
      .where('participants', 'array-contains', myId)
      .limit(30)
      .get()
      .then(function (snapshot) {
        var results = [];
        snapshot.forEach(function (snap) {
          var data = snap.data();
          // Filtrar > 30 días en cliente
          var createdMs = data.createdAt && data.createdAt.toMillis
            ? data.createdAt.toMillis() : 0;
          if (createdMs < cutoff) return;
          results.push(_buildDuelView(data, myId));
        });
        // Ordenar por createdAt desc (más reciente primero)
        results.sort(function (a, b) {
          var ta = a.createdAt && a.createdAt.toMillis ? a.createdAt.toMillis() : 0;
          var tb = b.createdAt && b.createdAt.toMillis ? b.createdAt.toMillis() : 0;
          return tb - ta;
        });
        return results;
      });
  }

  /**
   * buildWhatsAppShare(shareCode) → string
   * Genera la URL wa.me con el texto de invitación.
   *
   * @param {string} shareCode
   * @returns {string}
   */
  function buildWhatsAppShare(shareCode) {
    /* URL del duelo: hoy es la URL de la store (cuando exista Universal
       Link en dominio propio se devolverá una URL https que abra la app
       directamente si está instalada — ver ShareLinks.getShareUrl). */
    var shareUrl = (window.ShareLinks && typeof window.ShareLinks.getShareUrl === 'function')
      ? window.ShareLinks.getShareUrl({ type: 'duel', code: shareCode })
      : 'https://play.google.com/store/apps/details?id=com.sisapicasso.flagmaster';

    var msg = encodeURIComponent(
      t('duel_created_body') + '\n' +
      t('duel_created_code') + ': ' + shareCode + '\n' +
      shareUrl
    );
    return 'https://wa.me/?text=' + msg;
  }

  /* ══════════════════════════════════════════════════════════════
     NOTIFICACIONES DE RECUERDO (IDs 2000–2899)
     ══════════════════════════════════════════════════════════════ */

  function _getNotifIds(shareCode) {
    // Rango disponible: 2000-2899 = 900 IDs.
    // Cada duelo usa 2 IDs consecutivos → 450 pares posibles.
    var PAIRS_IN_RANGE = 450; // (2899 - 2000 + 1) / 2
    var hash = 0;
    for (var i = 0; i < shareCode.length; i++) {
      hash = (hash * 31 + shareCode.charCodeAt(i)) & 0xffff;
    }
    var base = NOTIF_ID_BASE + (hash % PAIRS_IN_RANGE) * 2;
    return [base, base + 1];
  }

  function _scheduleReminderNotifications(shareCode, expiresDate) {
    if (typeof Capacitor === 'undefined') return;
    try {
      var LocalNotifications = Capacitor.Plugins && Capacitor.Plugins.LocalNotifications;
      if (!LocalNotifications) return;

      var ids = _getNotifIds(shareCode);
      var now48  = new Date(Date.now() + 48 * 60 * 60 * 1000);
      var now6d  = new Date(Date.now() + 6  * 24 * 60 * 60 * 1000);

      // Solo programar si el duelo no habrá expirado aún
      var notifs = [];
      if (now48 < expiresDate) {
        notifs.push({
          id:           ids[0],
          title:        '⚔️ FlagMaster',
          body:         t('duel_notif_48h') || 'Tu reto sigue sin respuesta',
          schedule:     { at: now48 },
          sound:        null,
          actionTypeId: '',
          smallIcon:    'ic_stat_flagmaster',
          largeIcon:    'ic_launcher_round',
          iconColor:    '#4CAF50'
        });
      }
      if (now6d < expiresDate) {
        notifs.push({
          id:           ids[1],
          title:        '⚔️ FlagMaster',
          body:         t('duel_notif_6d') || '¡El reto expira mañana!',
          schedule:     { at: now6d },
          sound:        null,
          actionTypeId: '',
          smallIcon:    'ic_stat_flagmaster',
          largeIcon:    'ic_launcher_round',
          iconColor:    '#4CAF50'
        });
      }
      if (notifs.length) {
        LocalNotifications.schedule({ notifications: notifs }).catch(function (e) {
          console.warn('[DuelService] No se pudieron programar notificaciones:', e);
        });
      }
    } catch (e) {
      console.warn('[DuelService] Error en notificaciones:', e);
    }
  }

  function _cancelReminderNotifications(shareCode) {
    if (typeof Capacitor === 'undefined') return;
    try {
      var LocalNotifications = Capacitor.Plugins && Capacitor.Plugins.LocalNotifications;
      if (!LocalNotifications) return;
      var ids = _getNotifIds(shareCode);
      LocalNotifications.cancel({ notifications: ids.map(function (id) { return { id: id }; }) })
        .catch(function (e) { console.warn('[DuelService] Cancel notifs:', e); });
    } catch (e) {
      console.warn('[DuelService] Error al cancelar notificaciones:', e);
    }
  }

  /* ══════════════════════════════════════════════════════════════
     EXPOSICIÓN PÚBLICA
     ══════════════════════════════════════════════════════════════ */

  return {
    init:                 init,
    createDuel:           createDuel,
    getDuelByCode:        getDuelByCode,
    resolveAsDuelB:       resolveAsDuelB,
    getMyDuels:           getMyDuels,
    buildDuelQuestions:   buildDuelQuestions,
    generateDuelSeed:     generateDuelSeed,
    buildWhatsAppShare:   buildWhatsAppShare,
    cancelReminders:      _cancelReminderNotifications
  };
}());
