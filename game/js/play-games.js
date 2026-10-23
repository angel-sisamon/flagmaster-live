/**
 * js/play-games.js — Integración con Google Play Games Services
 *
 * Puente entre achievements.js (logros locales) y PGS (logros de Google).
 * Incluye soporte para LEADERBOARDS (Reto del Día).
 * Usa plugin personalizado PlayGamesPlugin (sin dependencia npm externa).
 * Solo funciona dentro de Capacitor (Android nativo).
 * En navegador web, todas las funciones son no-op (no hacen nada).
 *
 * ORDEN DE CARGA: después de achievements.js, antes de profile-pill.js y main.js
 *
 * ★ FIX: Si getCurrentPlayer() falla o devuelve datos incompletos,
 *   _isSignedIn se pone a false y se propaga correctamente hacia la UI
 *   y hacia Firestore. Antes, init()/signIn() devolvían siempre true
 *   aunque el player info fuera null, causando que la pill mostrase
 *   "Player" y que se escribiesen documentos pgs_fallback_ en Firestore.
 */

var PlayGamesService = (function () {

  /* ── Estado interno ───────────────────────────────── */
  var _isAvailable = false;
  var _isSignedIn  = false;
  var _playerInfo  = null; /* { displayName, avatarUrl, playerId } */

  /* ──────────────────────────────────────────────────────────────
   * MAPEO: ID interno de FlagMaster → ID de Google Play Games
   * ────────────────────────────────────────────────────────────── */
  var _cfg = (window.AppConfig && window.AppConfig.playGames) || {};

  var ACHIEVEMENT_MAP = _cfg.achievementMap || {
    'first_correct':   'CgkIx-P40Z4ZEAIQAQ',
    'streak_3':        'CgkIx-P40Z4ZEAIQAg',
    'streak_5':        'CgkIx-P40Z4ZEAIQAw',
    'streak_10':       'CgkIx-P40Z4ZEAIQBA',
    'perfect_game':    'CgkIx-P40Z4ZEAIQBQ',
    'no_mistakes':     'CgkIx-P40Z4ZEAIQBg',
    'daily_first':     'CgkIx-P40Z4ZEAIQBw',
    'daily_3':         'CgkIx-P40Z4ZEAIQCA',
    'time_attack_10':  'CgkIx-P40Z4ZEAIQCQ',
    'time_attack_20':  'CgkIx-P40Z4ZEAIQCg',
    'play_5_games':    'CgkIx-P40Z4ZEAIQCw',
    'play_all_modes':  'CgkIx-P40Z4ZEAIQDA',
    'score_50':        'CgkIx-P40Z4ZEAIQDQ',
    'score_100':       'CgkIx-P40Z4ZEAIQDg'
  };

  /* ──────────────────────────────────────────────────────────────
   * LEADERBOARDS: ID interno → ID de Google Play Games
   * ────────────────────────────────────────────────────────────── */
  var LEADERBOARD_MAP = _cfg.leaderboardMap || {
    'daily_challenge': 'CgkIx-P40Z4ZEAIQDw'
  };

  /* ── Logros incrementales ──────────────────────────── */
  var INCREMENTAL_ACHIEVEMENTS = {
    'daily_3':      true,
    'play_5_games': true,
    'score_50':     true,
    'score_100':    true
  };

  /* ── Referencia al plugin personalizado ────────────── */
  var _plugin = null;

  function _getPlugin() {
    if (_plugin) return _plugin;
    try {
      if (window.Capacitor && window.Capacitor.Plugins) {
        _plugin = window.Capacitor.Plugins.PlayGamesPlugin;
      }
    } catch (e) {
      console.warn('[PlayGames] Plugin no disponible:', e);
    }
    return _plugin;
  }

  /* ── Obtener info del jugador tras sign-in ─────────── */

  /**
   * Llama a getCurrentPlayer() en el plugin nativo y rellena _playerInfo.
   *
   * ★ FIX: Si el plugin devuelve null, un objeto vacío, o le faltan los
   *   campos esenciales (displayName y playerId), marcamos _isSignedIn = false
   *   para que init()/signIn() propaguen el fallo correctamente hacia la UI
   *   y hacia Firestore. Antes, cualquier fallo aquí era silenciado y el
   *   resto del sistema seguía creyendo que el usuario estaba autenticado.
   *
   * @param {object} plugin
   * @returns {Promise<object|null>} _playerInfo o null
   */
  function _fetchPlayerInfo(plugin) {
    if (!plugin || !plugin.getCurrentPlayer) {
      console.warn('[PlayGames] getCurrentPlayer no disponible en el plugin');
      _isSignedIn = false;
      return Promise.resolve(null);
    }

    return plugin.getCurrentPlayer()
      .then(function (player) {
        /* Vuelca el objeto completo para diagnóstico en logcat */
        console.log('[PlayGames] ★ Raw player object:', JSON.stringify(player));

        if (!player) {
          console.warn('[PlayGames] getCurrentPlayer devolvió null/undefined');
          _isSignedIn = false;
          _playerInfo = null;
          return null;
        }

        var displayName = player.displayName || player.name || null;
        /* gamePlayerId es el ID recomendado en PGS v2: estable por
           cuenta+juego en todos los dispositivos. getPlayerId() está
           deprecado y ya no se expone desde el plugin Java. */
        var playerId    = player.playerId || null;

        /* ★ FIX: Si faltan los campos esenciales, sign-in no es válido */
        if (!displayName || !playerId) {
          console.warn(
            '[PlayGames] getCurrentPlayer devolvió datos incompletos.' +
            ' displayName:', displayName,
            '| playerId:', playerId,
            '| Raw:', JSON.stringify(player)
          );
          console.warn(
            '[PlayGames] Tratando sesión como no autenticada para proteger Firestore.' +
            ' Revisa qué campos devuelve PlayGamesPlugin.java → getCurrentPlayer().'
          );
          _isSignedIn = false;
          _playerInfo = null;
          return null;
        }

        _playerInfo = {
          displayName: displayName,
          avatarUrl:   player.avatarImageUrl || player.iconImageUrl || player.avatarUrl || null,
          playerId:    playerId
        };
        console.log('[PlayGames] ✓ Jugador:', _playerInfo.displayName, '| ID:', _playerInfo.playerId);
        return _playerInfo;
      })
      .catch(function (err) {
        console.warn('[PlayGames] Error en getCurrentPlayer():', err);
        /* ★ FIX: Error nativo → sesión no válida */
        _isSignedIn = false;
        _playerInfo = null;
        return null;
      });
  }

  /* ── Inicialización ────────────────────────────────── */

  function init() {
    var plugin = _getPlugin();
    if (!plugin) {
      console.log('[PlayGames] No estamos en Capacitor, PGS desactivado');
      _isAvailable = false;
      return Promise.resolve(false);
    }

    _isAvailable = true;
    console.log('[PlayGames] Plugin detectado, intentando sign-in...');

    return plugin.signIn()
      .then(function (result) {
        _isSignedIn = !!(result && result.isSignedIn);
        console.log('[PlayGames] Sign-in resultado:', _isSignedIn);

        if (_isSignedIn) {
          return _fetchPlayerInfo(plugin).then(function () {
            /* ★ FIX: devolver el estado REAL tras fetchPlayerInfo,
               que puede haber puesto _isSignedIn = false si los datos
               del jugador eran inválidos. Antes se devolvía true siempre. */
            return _isSignedIn;
          });
        }
        return false;
      })
      .catch(function (err) {
        _isSignedIn = false;
        console.warn('[PlayGames] Sign-in falló:', err);
        return false;
      });
  }

  /* ── Sign-in manual (para reconexión desde UI) ─────── */

  function signIn() {
    var plugin = _getPlugin();
    if (!plugin) return Promise.resolve(false);

    _isAvailable = true;
    return plugin.signIn()
      .then(function (result) {
        _isSignedIn = !!(result && result.isSignedIn);
        if (_isSignedIn) {
          return _fetchPlayerInfo(plugin).then(function () {
            /* ★ FIX: igual que en init(), devolver estado real */
            return _isSignedIn;
          });
        }
        return false;
      })
      .catch(function (err) {
        _isSignedIn = false;
        console.warn('[PlayGames] Sign-in manual falló:', err);
        return false;
      });
  }

  /* ── Desbloquear logro estándar ────────────────────── */

  function unlockAchievement(localId) {
    if (!_isAvailable || !_isSignedIn) return Promise.resolve();

    var googleId = ACHIEVEMENT_MAP[localId];
    if (!googleId || googleId.indexOf('REEMPLAZA') !== -1) return Promise.resolve();
    if (INCREMENTAL_ACHIEVEMENTS[localId]) return Promise.resolve();

    var plugin = _getPlugin();
    if (!plugin) return Promise.resolve();

    console.log('[PlayGames] Desbloqueando:', localId);
    return plugin.unlockAchievement({ id: googleId })
      .then(function () { console.log('[PlayGames] ✓', localId); })
      .catch(function (err) { console.warn('[PlayGames] ✗', localId, err); });
  }

  /* ── Incrementar logro incremental ─────────────────── */

  function incrementAchievement(localId, steps) {
    if (!_isAvailable || !_isSignedIn) return Promise.resolve();

    var googleId = ACHIEVEMENT_MAP[localId];
    if (!googleId || googleId.indexOf('REEMPLAZA') !== -1) return Promise.resolve();

    var plugin = _getPlugin();
    if (!plugin) return Promise.resolve();

    steps = steps || 1;

    console.log('[PlayGames] Incrementando:', localId, '+' + steps);
    return plugin.incrementAchievement({ id: googleId, count: steps })
      .then(function () { console.log('[PlayGames] ✓', localId); })
      .catch(function (err) { console.warn('[PlayGames] ✗', localId, err); });
  }

  /* ── Mostrar pantalla nativa de logros ─────────────── */

  function showAchievements() {
    if (!_isAvailable || !_isSignedIn) return Promise.resolve();
    var plugin = _getPlugin();
    if (!plugin) return Promise.resolve();
    return plugin.showAchievements()
      .catch(function (err) { console.warn('[PlayGames] Error UI logros:', err); });
  }

  /* ══════════════════════════════════════════════════════
   * LEADERBOARDS
   * ══════════════════════════════════════════════════════ */

  function submitScore(boardId, score) {
    if (!_isAvailable || !_isSignedIn) return Promise.resolve();

    var googleId = LEADERBOARD_MAP[boardId];
    if (!googleId || googleId.indexOf('REEMPLAZA') !== -1) {
      console.warn('[PlayGames] Leaderboard ID no configurado:', boardId);
      return Promise.resolve();
    }

    var plugin = _getPlugin();
    if (!plugin || !plugin.submitScore) {
      console.warn('[PlayGames] submitScore no disponible en el plugin');
      return Promise.resolve();
    }

    console.log('[PlayGames] Enviando score:', boardId, '=', score);
    return plugin.submitScore({ leaderboardId: googleId, score: score })
      .then(function () { console.log('[PlayGames] ✓ Score enviado:', boardId, score); })
      .catch(function (err) { console.warn('[PlayGames] ✗ Error enviando score:', boardId, err); });
  }

  function showLeaderboard(boardId) {
    if (!_isAvailable || !_isSignedIn) return Promise.resolve();

    var googleId = LEADERBOARD_MAP[boardId];
    if (!googleId || googleId.indexOf('REEMPLAZA') !== -1) {
      console.warn('[PlayGames] Leaderboard ID no configurado:', boardId);
      return Promise.resolve();
    }

    var plugin = _getPlugin();
    if (!plugin || !plugin.showLeaderboard) {
      console.warn('[PlayGames] showLeaderboard no disponible en el plugin');
      return Promise.resolve();
    }

    console.log('[PlayGames] Abriendo leaderboard:', boardId);
    return plugin.showLeaderboard({ leaderboardId: googleId })
      .catch(function (err) { console.warn('[PlayGames] Error UI leaderboard:', boardId, err); });
  }

  function showAllLeaderboards() {
    if (!_isAvailable || !_isSignedIn) return Promise.resolve();

    var plugin = _getPlugin();
    if (!plugin || !plugin.showAllLeaderboards) {
      return showLeaderboard('daily_challenge');
    }

    return plugin.showAllLeaderboards()
      .catch(function (err) { console.warn('[PlayGames] Error UI all leaderboards:', err); });
  }

  /* ── Sincronizar logros locales existentes con PGS ─── */

  function syncAllLocal() {
    if (!_isAvailable || !_isSignedIn) return Promise.resolve();

    var data     = loadAchievements();
    var unlocked = data.unlocked;
    var stats    = data.stats;
    var promises = [];

    unlocked.forEach(function (localId) {
      if (INCREMENTAL_ACHIEVEMENTS[localId]) {
        var totalSteps = 0;
        if (localId === 'daily_3')      totalSteps = stats.daily_completed || 0;
        if (localId === 'play_5_games') totalSteps = stats.total_games || 0;
        if (localId === 'score_50')     totalSteps = Math.min(stats.total_correct || 0, 50);
        if (localId === 'score_100')    totalSteps = Math.min(stats.total_correct || 0, 100);
        if (totalSteps > 0) promises.push(incrementAchievement(localId, totalSteps));
      } else {
        promises.push(unlockAchievement(localId));
      }
    });

    var dailyBest = loadBestScore ? loadBestScore('daily') : 0;
    if (dailyBest > 0) {
      promises.push(submitScore('daily_challenge', dailyBest));
    }

    return Promise.all(promises).then(function () {
      console.log('[PlayGames] Sync completado:', unlocked.length, 'logros + leaderboard');
    });
  }

  /* ── Procesar logros nuevos de una partida ─────────── */

  function processNewAchievements(newIds, result) {
    if (!_isAvailable || !_isSignedIn) return Promise.resolve();

    var promises = [];

    if (newIds && newIds.length) {
      newIds.forEach(function (id) {
        if (!INCREMENTAL_ACHIEVEMENTS[id]) {
          promises.push(unlockAchievement(id));
        }
      });
    }

    promises.push(_updateIncrementals(result));
    return Promise.all(promises);
  }

  function _updateIncrementals(result) {
    if (!result) return Promise.resolve();
    var promises = [];

    if (result.correct && result.correct > 0) {
      promises.push(incrementAchievement('score_50', result.correct));
      promises.push(incrementAchievement('score_100', result.correct));
    }
    promises.push(incrementAchievement('play_5_games', 1));
    if (result.isDaily) {
      promises.push(incrementAchievement('daily_3', 1));
    }

    return Promise.all(promises);
  }

  /* ── API pública ───────────────────────────────────── */
  return {
    init:                   init,
    signIn:                 signIn,
    unlockAchievement:      unlockAchievement,
    incrementAchievement:   incrementAchievement,
    showAchievements:       showAchievements,
    syncAllLocal:           syncAllLocal,
    processNewAchievements: processNewAchievements,
    submitScore:            submitScore,
    showLeaderboard:        showLeaderboard,
    showAllLeaderboards:    showAllLeaderboards,
    isAvailable:    function () { return _isAvailable; },
    isSignedIn:     function () { return _isSignedIn; },
    getPlayerInfo:  function () { return _playerInfo; }
  };

})();
