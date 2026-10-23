/**
 * js/main.js — FlagMaster v5
 *
 * Nombres internos de modo: 'guess-country' | 'guess-flag' | 'timetrial' | 'daily' | 'marathon' | 'review'
 *
 * CAMBIOS v5:
 *  - Integración con NotificationService (3 puntos)
 *  - Icono de calendario SVG dinámico para el modo daily
 *
 * Nota: La configuración de modos (MODE_GROUPS, MODE_SOLO, MODE_I18N)
 * está centralizada en modes.js para facilitar la adición de nuevos modos.
 */

var _selectedModeId    = loadLastMode() || 'guess-country';
var _selectedContinent = storageLoad('last_continent', 'all') || 'all';
var _settings          = loadSettings();
var _timerHandle       = null;
var _globalTimer       = null;
var _globalSecs        = 60;
var _gameActive        = false;
var _autoAdvance       = null;
var _groupExpanded     = { classic: true };
/* Maratón: un fallo termina la partida. El flag fuerza _endGame() en el siguiente avance
   (auto-avance o "Siguiente" pulsado rápido) para que nunca se pinte otra pregunta. */
var _pendingMarathonEnd = false;

/* Timestamp de inicio del splash — para garantizar duración mínima */
var _splashShownAt = Date.now();
var SPLASH_MIN_MS  = 2500; /* duración mínima visible en ms */

/* Watchdog del splash — garantiza que nunca queda visible más de 8 s */
var _splashWatchdog = null;
var _splashHidden   = false;

/* ══════════════════════════════════════════════════════════════
   SPLASH SCREEN — ocultar con duración mínima garantizada
   ══════════════════════════════════════════════════════════════ */

function _hideSplash() {
  /* Idempotente: si ya se ocultó, no hacer nada */
  if (_splashHidden) return;
  _splashHidden = true;

  /* Cancelar watchdog si estaba activo */
  if (_splashWatchdog) { clearTimeout(_splashWatchdog); _splashWatchdog = null; }

  var el = document.getElementById('screen-splash');
  if (!el) return;

  /* Calcular cuánto tiempo ha estado visible el splash */
  var elapsed = Date.now() - _splashShownAt;
  var remaining = Math.max(0, SPLASH_MIN_MS - elapsed);

  setTimeout(function () {
    /* 1. Inicia fade-out (500ms CSS transition) */
    el.classList.add('splash--hidden');
    /* 2. Elimina el nodo del DOM tras la transición para liberar memoria */
    setTimeout(function () {
      el.classList.add('splash--gone');
    }, 520);
  }, remaining);
}

/* ══════════════════════════════════════════════════════════════
   VALIDACIÓN DE DEPENDENCIAS
   ══════════════════════════════════════════════════════════════ */

function _validateStartupDependencies() {
  var requiredGlobals = [
    'initI18N', 'applyDarkMode', 'AudioFX', 'FeedbackManager', 'FirebaseLeaderboard', 'NotificationService',
    'ProfilePill', 'PlayGamesService', 'initSettingsEvents', 'updateDailyCardUI',
    'renderAchievementsScreen', 'showScreen',
    'getModeVisual', 'getModeDisplayName', 'buildQuestion', 'UpdateChecker', 'DailySync',
    'PlayerProfile', 'ProfileUI', 'Marathon', 'MarathonAttempt', 'MarathonLeaderboard', 'MarathonRankUI'
  ];
  var missing = requiredGlobals.filter(function (k) { return typeof window[k] === 'undefined'; });
  if (missing.length) {
    console.error('[FlagMaster] Dependencias globales no encontradas:', missing.join(', '));
  }

  var expectedOrder = [
    'js/config.js', 'js/i18n.js', 'js/modes.js', 'js/storage.js', 'js/utils.js', 'js/audio.js',
    'js/feedback.js', 'js/countries-data.js', 'js/daily.js', 'js/marathon.js', 'js/marathon-attempt.js',
    'js/achievements.js', 'js/firebase-marathon-leaderboard.js', 'js/player-profile.js',
    'js/daily-sync.js', 'js/game.js', 'js/insights.js', 'js/stats-renderer.js',
    'js/ui.js', 'js/settings.js', 'js/profile-ui.js', 'js/main.js'
  ];
  var scriptIndexMap = {};
  for (var i = 0; i < document.scripts.length; i++) {
    var src = document.scripts[i].getAttribute('src') || '';
    var pathStartIndex = src.indexOf('js/');
    if (pathStartIndex !== -1) scriptIndexMap[src.slice(pathStartIndex)] = i;
  }
  var idx = expectedOrder.map(function (path) {
    return typeof scriptIndexMap[path] === 'number' ? scriptIndexMap[path] : -1;
  });
  for (var j = 1; j < idx.length; j++) {
    if (idx[j] !== -1 && idx[j - 1] !== -1 && idx[j] < idx[j - 1]) {
      console.warn('[FlagMaster] Posible orden incorrecto de scripts entre',
        expectedOrder[j - 1], 'y', expectedOrder[j]);
      break;
    }
  }
}

/* ══════════════════════════════════════════════════════════════
   INICIALIZACIÓN
   ══════════════════════════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', function () {
  _validateStartupDependencies();

  /* Watchdog de seguridad: oculta el splash si tras 8 s no se ha ocultado ya */
  _splashWatchdog = setTimeout(function () {
    console.warn('[FlagMaster] Splash watchdog: forzando ocultación tras 8s.');
    _hideSplash();
  }, 8000);

  /* ★ Cierre de intentos huérfanos del reto diario (force-kill, crash, etc.)
     Debe ejecutarse ANTES de pintar el estado del reto en la home. ★ */
  try {
    if (typeof DailyAttempt !== 'undefined') DailyAttempt.sweepOrphanAttempt();
  } catch (e) { console.warn('[DailyAttempt] sweep failed', e); }

  /* ★ Cierre de intentos huérfanos de la Maratón: aplica el candado del día con la
     racha parcial aunque la app se cerrase a mitad de partida ★ */
  try {
    if (typeof MarathonAttempt !== 'undefined') MarathonAttempt.sweepOrphanAttempt();
  } catch (e) { console.warn('[MarathonAttempt] sweep failed', e); }

  /* Precarga en segundo plano del SVG del mundo (para modo "silueta").
     No es bloqueante: si falla, sólo el modo silueta quedará no disponible. */
  try {
    if (typeof Silhouette !== 'undefined' && Silhouette.preload) {
      Silhouette.preload().catch(function (e) {
        console.warn('[Silhouette] preload failed', e);
      });
    }
  } catch (e) { /* no-op */ }

  /* ★ Cierre de intentos huérfanos de torneos (force-kill, crash, etc.) ★ */
  try {
    if (typeof TournamentAttempt !== 'undefined') TournamentAttempt.sweepOrphanAttempt();
  } catch (e) { console.warn('[TournamentAttempt] sweep failed', e); }

  /* ★ Flush al pasar la app a segundo plano (último aliento) ★ */
  function _flushOnBackground() {
    /* Daily: flush DailySync si hay intento abierto */
    try {
      if (typeof DailySync !== 'undefined' && DailySync.flush &&
          typeof DailyAttempt !== 'undefined' && DailyAttempt.hasOpenAttempt &&
          DailyAttempt.hasOpenAttempt()) {
        DailySync.flush();
      }
    } catch (e) {}

    /* Torneos: si hay intento abierto, intentar enviar score parcial best-effort */
    try {
      if (typeof TournamentAttempt !== 'undefined' &&
          TournamentAttempt.hasOpenAttempt &&
          TournamentAttempt.hasOpenAttempt() &&
          typeof TournamentService !== 'undefined' &&
          typeof PlayGamesService !== 'undefined' &&
          PlayGamesService.isSignedIn()) {
        var snap = TournamentAttempt.load();
        if (snap && snap.tournamentId) {
          TournamentService.getTournamentById(snap.tournamentId).then(function (t) {
            if (!t || t.status !== 'open') return;
            var finalScore = snap.score;
            if (typeof ScoreCalculator !== 'undefined') {
              var total = (t.gameConfig && t.gameConfig.numQuestions) || 15;
              finalScore = ScoreCalculator.calculateFinalScore(
                snap.questionScores || [], snap.correct || 0, total);
            }
            TournamentService.submitScore(t, {
              score:     finalScore,
              correct:   snap.correct   || 0,
              wrong:     snap.wrong     || 0,
              maxStreak: snap.maxStreak || 0
            }).catch(function () {});
          }).catch(function () {});
        }
      }
    } catch (e) {}

    /* Perfil de jugador: subir a Firestore los cambios de progreso pendientes */
    try {
      if (typeof PlayerProfile !== 'undefined') PlayerProfile.flush();
    } catch (e) {}
  }
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) _flushOnBackground();
  });
  window.addEventListener('pagehide', _flushOnBackground);
  try {
    if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App) {
      window.Capacitor.Plugins.App.addListener('pause', _flushOnBackground);
      window.Capacitor.Plugins.App.addListener('appStateChange', function (state) {
        if (state && state.isActive === false) _flushOnBackground();
      });
    }
  } catch (e) {}

  initI18N();
  applyDarkMode(_settings.darkMode);
  FeedbackManager.configure(_settings);
  /* ★ Comprobación de versión — debe completarse antes del resto del init ★ */
  UpdateChecker.check().then(function (result) {
  /* Ocultar splash SIEMPRE, independientemente del resultado */
  _hideSplash();
  if (result && result.blocked) {
    console.warn('[FlagMaster] App bloqueada por UpdateChecker:', result.status);
    return; /* No continuar el init si la app está bloqueada */
  }
  /* ★ Firebase Leaderboard ★ */
  FirebaseLeaderboard.init();

  /* ★ Perfil de jugador (local-first + Firestore) ★
     init() no toca la red salvo la detección de país (cacheada 24 h). La lectura
     única de players/{id} se hace en _syncPlayerProfile() cuando PGS está listo. */
  PlayerProfile.init();
  PlayerProfile.onChange(function () { ProfileUI.refresh(); });

  /* ★ Recovery desde el ranking ★ */
  LeaderboardUI.onRecovery(function () {
    if (typeof AdRewardService === 'undefined') return;
    var check = AdRewardService.canRecoverMissedDay();
    if (!check || !check.eligible) return;

    AdRewardService.requestRecovery().then(function (completed) {
      if (!completed) return;
      /* Lanzar reto diario con preguntas de ayer */
      var yesterdayDate = new Date();
      yesterdayDate.setDate(yesterdayDate.getDate() - 1);
      if (typeof getDailyQuestions === 'function') {
        initGame('daily', DAILY_COUNT, getDailyQuestions(yesterdayDate), 'all');
        _startGameFromState();
      }
    });
  });

  /* ★ Duelos Asíncronos ★ */
  if (typeof DuelService !== 'undefined') DuelService.init();

  /* ★ Torneos ★ */
  if (typeof TournamentService !== 'undefined') TournamentService.init();

  /* ★ Notificaciones locales ★
     init() pide permiso si no lo tiene.
     syncOnAppOpen() cancela+reprograma según el estado actual del reto. */
  NotificationService.init().then(function () {
    NotificationService.syncOnAppOpen();
  });

  /* ★ PGS ★ */
  ProfilePill.init();
  ProfilePill.onSignIn(function () {
    console.log('[FlagMaster] Sign-in manual completado — refrescando home...');
    var pgsBtn = document.getElementById('btn-pgs-achievements');
    if (pgsBtn) pgsBtn.style.display = 'block';
    /* ★ Perfil en Firestore: migración (Caso B) o descarga (Caso C) tras el sign-in ★
       Antes que syncAllLocal(): si es otra cuenta, el progreso local pasa a ella (de forma
       síncrona) y no se envían a Play Games los logros/récord de la cuenta anterior. */
    _syncPlayerProfile();
    PlayGamesService.syncAllLocal();
    _updatePlayButton();
    if (typeof DailySync !== 'undefined') DailySync.retryPending();
    MarathonLeaderboard.submitBest(); /* racha pendiente de subir (p. ej. jugada como invitado) */
    /* ★ Reintento del sweep de torneo por si PGS no estaba listo al arrancar ★ */
    try {
      if (typeof TournamentAttempt !== 'undefined') TournamentAttempt.sweepOrphanAttempt();
    } catch (e) {}
    FirebaseLeaderboard.syncDailyStatusFromFirestore().then(function () {
      updateDailyCardUI();
      _updateDailyStreakUI();
      _updatePlayButton();
    });
  });
 
  PlayGamesService.init().then(function (signedIn) {
    ProfilePill.updateFromPGS(signedIn);
    if (signedIn) {
      console.log('[FlagMaster] PGS conectado, sincronizando...');
      /* ★ Perfil en Firestore: lectura única de la sesión (Casos A / B / C) ★
         Antes que syncAllLocal(): un cambio de cuenta se aplica al progreso local primero. */
      _syncPlayerProfile();
      PlayGamesService.syncAllLocal();
      var pgsBtn = document.getElementById('btn-pgs-achievements');
      if (pgsBtn) pgsBtn.style.display = 'block';
      if (typeof DailySync !== 'undefined') DailySync.retryPending();
      MarathonLeaderboard.submitBest();
    }
    _updatePlayButton();
    /* ★ Restaurar estado del reto del día desde Firestore (útil tras reinstalación) ★ */
    FirebaseLeaderboard.syncDailyStatusFromFirestore().then(function (restored) {
      if (restored) {
        updateDailyCardUI();
        _updateDailyStreakUI();
        _updatePlayButton();
      }
    });
  });

  initSettingsEvents(function (ns) {
    _settings = ns;
    applyDarkMode(ns.darkMode);
    FeedbackManager.configure(ns);
    _renderHomeMenu();
    _refreshBestScore();
    updateDailyCardUI();
    updateMarathonCardUI();
    _updateDailyStreakUI();
    refreshHomeStars();
    /* ★ Re-sincronizar notificación al guardar ajustes ★ */
    NotificationService.syncOnAppOpen();
  });

  _renderHomeMenu();
  _refreshBestScore();
  updateDailyCardUI();
  _updateDailyStreakUI();
  _updatePlayButton();

  /* ── Botón JUGAR ── */
  document.getElementById('btn-play').addEventListener('click', function () {
    AudioFX.resume();
    FeedbackManager.onButtonTap();
    var action = this.dataset.action || 'play';
    if (action === 'leaderboard') {
      LeaderboardUI.open();
    } else if (action === 'marathon-ranking') {
      MarathonRankUI.open('home');
    } else if (action === 'done') {
      alert(t('daily_already'));
    } else {
      _launchSelected();
    }
  });

  document.getElementById('btn-settings-home').addEventListener('click', function () {
    showSettingsModal(_settings);
  });
  /* Duelos ocupa el hueco del antiguo acceso a "Ranking Local" en la barra inferior */
  document.getElementById('btn-duels-home').addEventListener('click', function () {
    FeedbackManager.onButtonTap();
    if (typeof DuelsUI !== 'undefined') DuelsUI.open();
  });
  document.getElementById('btn-achievements-home').addEventListener('click', function () {
    renderAchievementsScreen(); showScreen('achievements');
  });
  document.getElementById('btn-stats-home').addEventListener('click', function () {
    ProfileUI.open('stats');
  });

  document.getElementById('btn-next').addEventListener('click', _handleNext);
  document.getElementById('btn-quit').addEventListener('click', function () {
    var state = getGameState();
    var dailyLike = state && (state.isDailyChallenge || state.useDailyScoring || state.isMarathon);

    if (dailyLike) {
      /* Reto diario, torneos y Maratón: el timer NO se pausa; al confirmar se cierra con puntuación parcial */
      var titleKey = state.isTournament ? 'tournament_quit_title' : state.isMarathon ? 'marathon_quit_title' : 'daily_quit_title';
      var bodyKey  = state.isTournament ? 'tournament_quit_body'  : state.isMarathon ? 'marathon_quit_body'  : 'daily_quit_body';
      showQuitModal(
        function () { if (_gameActive) _endGame(); },
        function () { /* sigue corriendo, no hay nada que reanudar */ },
        { titleKey: titleKey, bodyKey: bodyKey }
      );
    } else {
      _pauseAll();
      showQuitModal(
        function () { _stopAll(); _gameActive = false; _refreshBestScore(); showScreen('home'); },
        _resumeTimers
      );
    }
  });

  document.getElementById('btn-share').addEventListener('click', function () {
    var state = getGameState(); if (!state) return;
    var total = state.isTimeTrial ? state.attempted : getTotalQuestions();
    shareResult(state.score, total, state.isTimeTrial, state.isDailyChallenge, _selectedModeId);
  });
  document.getElementById('btn-retry').addEventListener('click', function () {
    resetGameState(); _startGameFromState();
  });
  document.getElementById('btn-review').addEventListener('click', function () {
    var state = getGameState();
    if (!state || !state.wrongList || !state.wrongList.length) return;
    _launchReview(state.wrongList);
  });
  document.getElementById('btn-home').addEventListener('click', function () {
    _gameActive = false; _stopAll(); _refreshBestScore();
    updateDailyCardUI(); updateMarathonCardUI(); _updateDailyStreakUI(); _updatePlayButton();
    _checkRecoveryBanner();
    showScreen('home');
  });

  document.getElementById('btn-back-achievements').addEventListener('click', function () {
    /* Si los logros se abrieron desde la pestaña Trofeos del perfil, volver allí */
    if (ProfileUI.consumeAchievementsReturn()) ProfileUI.open('trophies');
    else showScreen('home');
  });
  document.getElementById('btn-back-stats').addEventListener('click', function () { showScreen('home'); });
  document.getElementById('btn-back-duels').addEventListener('click', function () { showScreen('home'); });

  /* ★ Botón volver de Torneos — delega a TournamentsUI para navegación contextual ★ */
  var btnBackTournaments = document.getElementById('btn-back-tournaments');
  if (btnBackTournaments) {
    btnBackTournaments.addEventListener('click', function () {
      if (typeof TournamentsUI !== 'undefined' && typeof TournamentsUI.handleBack === 'function') {
        TournamentsUI.handleBack();
      } else {
        showScreen('home');
      }
    });
  }

  /* ★ PGS: Botón logros nativos ★ */
  var pgsBtn = document.getElementById('btn-pgs-achievements');
  if (pgsBtn) { pgsBtn.addEventListener('click', function () { PlayGamesService.showAchievements(); }); }

  /* ★ Botón leaderboard en resultados ★ */
  var lbBtn = document.getElementById('btn-pgs-leaderboard');
  if (lbBtn) {
    lbBtn.addEventListener('click', function () {
      var st = getGameState();
      if (st && st.isMarathon) MarathonRankUI.open('results');
      else LeaderboardUI.open();
    });
  }

  /* ★ Botón recuperar día perdido (home) ★ */
  var btnRecovery = document.getElementById('btn-recovery');
  if (btnRecovery) {
    btnRecovery.addEventListener('click', function () {
      if (typeof AdRewardService === 'undefined') return;

      var result = AdRewardService.canRecoverMissedDay();
      if (!result.eligible) return;

      /* Prevenir doble pulsación: deshabilitar botón mientras dura el flujo */
      btnRecovery.disabled = true;
      btnRecovery.textContent = '⏳';

      AdRewardService.requestRecovery()
        .then(function (completed) {
          if (completed) {
            /* El anuncio fue completado — ocultar el banner.
               La puntuación real se enviará cuando el jugador juegue el
               reto del día de ayer a través del flujo de juego normal. */
            var banner = document.getElementById('recovery-banner');
            if (banner) banner.style.display = 'none';
            console.log('[Recovery] Anuncio completado para el día:', result.missedDate);
          }
        })
        .catch(function (err) {
          console.warn('[Recovery] Error en el flujo de recuperación:', err);
        })
        .then(function () {
          /* Rehabilitar botón siempre al finalizar (éxito o error) */
          btnRecovery.disabled = false;
          btnRecovery.textContent = t('recovery_btn') || 'Recuperar';
        });
    });
  }

  /* Listener de teclado unificado */
  document.addEventListener('keydown', _handleKeyboard);
  /* Botón/gesto atrás del sistema (Android), gesto de borde (iOS) y atrás del navegador (web) */
  BackNav.init();
  /* Estrellas: aún sin sistema de estrellas → 0. El futuro sistema llamará a setHomeStars(n, true) */
  setHomeStars(0);

  showScreen('home');
  _checkRecoveryBanner();
  _initContinentSelector();
  _initOnboarding();

  }).catch(function (err) {
    console.error('[FlagMaster] UpdateChecker error fatal:', err);
    _hideSplash(); /* doble seguro */
  }); // UpdateChecker.check()
});

/* ══════════════════════════════════════════════════════════════
   BOTÓN JUGAR
   ══════════════════════════════════════════════════════════════ */

function _updatePlayButton() {
  var btn = document.getElementById('btn-play'); if (!btn) return;

  var isDaily = _selectedModeId === 'daily';
  var done    = isDaily && isDailyCompleted();
  var hasLb   = FirebaseLeaderboard.isReady() || PlayGamesService.isSignedIn();

  /* Maratón ya jugada hoy → el botón abre el ranking de rachas (tiene fallback local) */
  if (_selectedModeId === 'marathon' && isMarathonCompletedToday()) {
    btn.textContent    = t('marathon_ranking_title');
    btn.dataset.action = 'marathon-ranking';
    btn.classList.add('btn-play-main--leaderboard');
    return;
  }

  if (done && hasLb) {
    btn.textContent    = '🏆 ' + t('leaderboard_daily');
    btn.dataset.action = 'leaderboard';
    btn.classList.add('btn-play-main--leaderboard');
  } else if (done) {
    btn.textContent    = '📅 ' + t('home_daily_done');
    btn.dataset.action = 'done';
    btn.classList.remove('btn-play-main--leaderboard');
  } else {
    btn.textContent    = t('home_play');
    btn.dataset.action = 'play';
    btn.classList.remove('btn-play-main--leaderboard');
  }
}

/* ══════════════════════════════════════════════════════════════
   HOME MENU
   ══════════════════════════════════════════════════════════════ */

function _renderHomeMenu() {
  var container = document.getElementById('mode-list'); if (!container) return;
  container.innerHTML = '';
  container.appendChild(_buildSoloCard(MODE_SOLO));
  /* Maratón justo debajo del Reto Diario */
  container.appendChild(Marathon.buildHomeCard(_selectedModeId === 'marathon', _selectMode,
    function () { MarathonRankUI.open('home'); }));

  /* Tarjeta Torneos — solo visible si está habilitada (feature flag) */
  if (typeof TournamentService !== 'undefined' && typeof TournamentsUI !== 'undefined') {
    TournamentService.isEnabled().then(function (enabled) {
      if (!enabled) return;
      var existing = document.getElementById('btn-tournaments-entry');
      if (existing) return; /* ya insertada */
      var marathonCard = document.getElementById('btn-marathon-entry');
      if (marathonCard && marathonCard.parentNode) {
        var tourCard = TournamentsUI.renderTournamentsHomeCard();
        marathonCard.parentNode.insertBefore(tourCard, marathonCard.nextSibling);
      }
    });
  }

  MODE_GROUPS.forEach(function (group) { container.appendChild(_buildGroupBlock(group)); });
  _updateHeroVisual(_selectedModeId);
  _updatePlayButton();
}

function _buildSoloCard(mode) {
  var card = document.createElement('button');
  card.className = 'mode-card mode-card--solo' +
    (mode.id === _selectedModeId ? ' mode-card--selected' : '') +
    (!mode.active ? ' mode-card--locked' : '');
  card.dataset.mode = mode.id;
  var keys = MODE_I18N[mode.id] || { name: mode.id, desc: '' };

  var iconContent = (mode.id === 'daily' && typeof getDailyCalendarIcon === 'function')
    ? getDailyCalendarIcon(30)
    : mode.visualBig;

  card.innerHTML =
    '<span class="mode-card-icon" id="daily-icon">' + iconContent + '</span>' +
    '<div class="mode-card-text">' +
      '<span class="mode-card-name">' + t(keys.name) + '</span>' +
      '<span class="mode-card-desc" id="daily-status">' + t(keys.desc) + '</span>' +
    '</div>' +
    (mode.id === _selectedModeId ? '<span class="mode-card-check">✓</span>' : '');
  if (mode.active) { card.addEventListener('click', function () { _selectMode(mode.id); }); }
  return card;
}

function _buildGroupBlock(group) {
  var isOpen = !!_groupExpanded[group.id];
  var wrap = document.createElement('div'); wrap.className = 'mode-group'; wrap.dataset.group = group.id;
  var header = document.createElement('button');
  header.className = 'mode-group-header' + (isOpen ? ' mode-group-header--open' : '');
  header.innerHTML =
    '<span class="mode-group-icon">' + group.icon + '</span>' +
    '<span class="mode-group-name">' + t(group.nameKey) + '</span>' +
    '<span class="mode-group-arrow">' + (isOpen ? '▾' : '▸') + '</span>';
  var children = document.createElement('div');
  children.className = 'mode-group-children' + (isOpen ? ' mode-group-children--open' : '');
  group.modes.forEach(function (mode) {
    var card = document.createElement('button');
    card.className = 'mode-card mode-card--child' +
      (mode.id === _selectedModeId ? ' mode-card--selected' : '') +
      (!mode.active ? ' mode-card--locked' : '');
    card.dataset.mode = mode.id;
    var keys = MODE_I18N[mode.id] || { name: mode.id, desc: '' };
    card.innerHTML =
      '<span class="mode-card-icon">' + mode.visualBig + '</span>' +
      '<div class="mode-card-text">' +
        '<span class="mode-card-name">' + t(keys.name) + '</span>' +
        '<span class="mode-card-desc">' + t(keys.desc) + '</span>' +
      '</div>' +
      (mode.id === _selectedModeId ? '<span class="mode-card-check">✓</span>' : '');
    if (mode.active) { card.addEventListener('click', function () { _selectMode(mode.id); }); }
    children.appendChild(card);
  });

  header.addEventListener('click', function () {
    _groupExpanded[group.id] = !_groupExpanded[group.id];
    var open = _groupExpanded[group.id];
    header.classList.toggle('mode-group-header--open', open);
    children.classList.toggle('mode-group-children--open', open);
    header.querySelector('.mode-group-arrow').textContent = open ? '▾' : '▸';
    FeedbackManager.onGroupToggle();
  });

  wrap.appendChild(header); wrap.appendChild(children); return wrap;
}

function _selectMode(id) {
  _selectedModeId = id; saveLastMode(id); _refreshBestScore();
  document.querySelectorAll('.mode-card').forEach(function (c) {
    var sel = c.dataset.mode === id;
    c.classList.toggle('mode-card--selected', sel);
    var check = c.querySelector('.mode-card-check');
    if (sel && !check) {
      check = document.createElement('span'); check.className = 'mode-card-check';
      check.textContent = '✓'; c.appendChild(check);
    } else if (!sel && check) { check.remove(); }
  });
  _updateHeroVisual(id);
  _updatePlayButton();
  FeedbackManager.onModeSelect();
}

function _updateHeroVisual(id) {
  var heroEl = document.getElementById('hero-visual'); if (!heroEl) return;
  heroEl.classList.remove('hero-anim'); void heroEl.offsetWidth; heroEl.classList.add('hero-anim');
  if (id === 'daily' && typeof getDailyCalendarIcon === 'function') {
    heroEl.innerHTML = getDailyCalendarIcon(58);
  } else {
    heroEl.textContent = getModeVisual(id);
  }
}

/* ══════════════════════════════════════════════════════════════
   ARRANQUE DE PARTIDA
   ══════════════════════════════════════════════════════════════ */

function _launchSelected() {
  _settings = loadSettings(); FeedbackManager.configure(_settings);
  var hero = document.getElementById('hero-visual');
  if (hero) {
    hero.classList.add('hero-launch');
    setTimeout(function () { hero.classList.remove('hero-launch'); }, 400);
  }

  if (_selectedModeId === 'daily') {
    if (isDailyCompleted()) { alert(t('daily_already')); return; }
    var _doLaunchDaily = function () {
      var questions = getDailyQuestions();
      /* ★ Resetear DailySync para no arrastrar _lastSentScore de la sesión anterior ★ */
      if (typeof DailySync !== 'undefined') DailySync.reset();
      /* ★ Marcar el intento como iniciado ANTES de pintar la primera pregunta.
         A partir de aquí el reto se considera "jugado": si la app se cierra
         inesperadamente, sweepOrphanAttempt() lo registrará con la puntuación parcial. ★ */
      if (typeof DailyAttempt !== 'undefined') DailyAttempt.begin(questions);
      initGame('daily', DAILY_COUNT, questions, 'all');
      _startGameFromState();
    };
    if (storageLoad('daily_info_suppressed', false)) {
      _doLaunchDaily();
    } else {
      showDailyInfoModal(_doLaunchDaily);
    }
    return;
  } else if (_selectedModeId === 'marathon') {
    if (isMarathonCompletedToday()) { alert(t('marathon_already')); _updatePlayButton(); return; }
    Marathon.showInfoModal(_launchMarathon);
    return;
  } else {
    initGame(_selectedModeId, _settings.numQuestions, null, _selectedContinent);
  }
  _startGameFromState();
}

function _launchMarathon() {
  if (isMarathonCompletedToday()) { alert(t('marathon_already')); _updatePlayButton(); return; }
  var questions = getMarathonQuestions();
  _pendingMarathonEnd = false;
  /* ★ Iniciar = comprometerse: SÍNCRONO y ANTES de pintar la primera pregunta. Marca el día
     como jugado (local → players/{id}); si la app muere a mitad, el sweep cierra la partida. ★ */
  MarathonAttempt.begin(questions);
  PlayerProfile.flush(); /* el candado del día viaja a la nube cuanto antes (anti-reinstalación) */
  initGame('marathon', questions.length, questions, 'all');
  _startGameFromState();
}

function _launchReview(wrongCodes) {
  var reviewMode = _displayMode();
  var pool = wrongCodes.map(function (code) {
    return COUNTRIES.filter(function (c) { return c.code === code; })[0];
  }).filter(Boolean);
  if (reviewMode === 'guess-silhouette' && typeof Silhouette !== 'undefined') {
    pool = pool.filter(function (c) { return Silhouette.hasSilhouetteFor(c.code); });
  }
  if (!pool.length) return;
  initGame('review', pool.length, pool.map(buildQuestion), 'all');
  _startGameFromState();
}

function _displayMode() {
  var state = getGameState(); if (!state) return 'guess-country';
  if (state.mode === 'review') {
    if (['guess-flag', 'guess-capital', 'guess-country-from-capital', 'guess-silhouette'].indexOf(_selectedModeId) !== -1) {
      return _selectedModeId;
    }
    return 'guess-country';
  }
  if (state.mode === 'timetrial') return 'guess-country';
  if (state.mode === 'daily' || state.mode === 'marathon') {
    var q = getCurrentQuestion();
    return (q && q.questionMode) ? q.questionMode : 'guess-country';
  }
  return state.mode;
}

function _startGameFromState() {
  _gameActive = true;
  var state = getGameState();
  var isTA    = state && state.isTimeTrial;
  var isDaily = state && state.isDailyChallenge;
  var useEnhancedScoring = state && (state.isDailyChallenge || state.useDailyScoring);
  var isMarathon = state && state.isMarathon;
  showScreen('game');
  setTimerVisible(!isTA && (_settings.timerEnabled || useEnhancedScoring || isMarathon));
  setTimeAttackHUD(isTA);
  if (isTA) _startGlobalTimer(60);
  delay(100).then(function () { _renderCurrentQuestion(true); });
}

function _renderCurrentQuestion(animate) {
  if (!_gameActive) return;
  var state = getGameState();
  var isTA    = state && state.isTimeTrial;
  var isDaily = state && state.isDailyChallenge;
  var useEnhancedScoring = state && (state.isDailyChallenge || state.useDailyScoring);
  if (isTA) { updateHUDScoreOnly(state.score, state.streak); }
  else      { updateHUD(state.score, state.streak, state.currentIndex, getTotalQuestions()); }
  renderQuestion(getCurrentQuestion(), _displayMode(), animate, _handleAnswer);
  if (useEnhancedScoring) {
    /* Reto diario y torneos: temporizador fijo de 10 s + registra inicio para scoring */
    _startDailyTimer();
  } else if (state && state.isMarathon) {
    /* Maratón: 10 s fijos por pregunta para todos (ranking justo); agotarlos = fallo */
    _startPerQuestionTimer(ScoreCalculator.MAX_QUESTION_TIME);
  } else if (!isTA && _settings.timerEnabled) {
    _startPerQuestionTimer(_settings.timerDuration);
  }
}

/* ══════════════════════════════════════════════════════════════
   LÓGICA DE RESPUESTA Y AVANCE
   ══════════════════════════════════════════════════════════════ */

function _handleAnswer(optionIndex) {
  if (!_gameActive) return;
  _stopPerQuestionTimer();
  if (_autoAdvance) { clearTimeout(_autoAdvance); _autoAdvance = null; }
  var result = answerQuestion(optionIndex); if (!result) return;
  if (result.isCorrect) {
    FeedbackManager.onCorrectAnswer();
    if (result.state.streak >= 3) { FeedbackManager.onStreak(); }
  } else {
    FeedbackManager.onWrongAnswer();
    if (result.state.isMarathon) _pendingMarathonEnd = true; /* fallo = fin inmediato */
  }
  showAnswerFeedback(result.isCorrect, optionIndex, result.correctIndex,
    getCurrentQuestion().correct, _displayMode());
  var state = getGameState();
  var wrongExtra = result.isCorrect ? 0 : 500;
  if (state.isTimeTrial) {
    updateHUDScoreOnly(state.score, state.streak);
    _autoAdvance = setTimeout(function () { _autoAdvance = null; _handleNext(); }, 1400 + wrongExtra);
  } else {
    updateHUD(state.score, state.streak, state.currentIndex, getTotalQuestions());
    _autoAdvance = setTimeout(function () { _autoAdvance = null; _handleNext(); }, 1500 + wrongExtra);
  }
}

function _handleNext() {
  if (!_gameActive) return;
  if (_autoAdvance) { clearTimeout(_autoAdvance); _autoAdvance = null; }
  if (_pendingMarathonEnd) {
    _pendingMarathonEnd = false;
    forceFinishGame();
    _endGame();
    return;
  }
  var res = advanceQuestion();
  if (res.finished) { _endGame(); }
  else { delay(100).then(function () { _renderCurrentQuestion(true); }); }
}

/* ══════════════════════════════════════════════════════════════
   FIN DE PARTIDA
   ══════════════════════════════════════════════════════════════ */

function _endGame() {
  _gameActive = false; _stopAll();
  _pendingMarathonEnd = false;

  var state    = getGameState();
  var isTA     = state.isTimeTrial;
  var isDaily  = state.isDailyChallenge;
  var isReview = state.isReview;
  var isMarathon = state.isMarathon;
  var mode     = isReview ? 'review' : isMarathon ? 'marathon' : _selectedModeId;
  /* Maratón: preguntas respondidas (la serie completa son 195, casi nunca se agota) */
  var total    = (isTA || isMarathon) ? state.attempted : getTotalQuestions();

  /* Para el reto diario y torneos, aplicar bonus de puntuación perfecta */
  var finalScore = state.score;
  if ((isDaily || state.useDailyScoring) && typeof ScoreCalculator !== 'undefined') {
    finalScore = ScoreCalculator.calculateFinalScore(state.questionScores, state.correct, total);
    applyFinalScore(finalScore);
  }

  if (state.wrongList && state.wrongList.length) {
    state.wrongList.forEach(function (code) { recordWrongCountryV2(code, mode); });
  }

  var isNewRecord = false;
  var marathonState = null;
  if (isMarathon) {
    /* Racha = aciertos (el primer fallo termina la partida). Candado + espejo players/{id}
       + histórico local + ranking global (marathon_scores) en un único punto. */
    var prevBest = getMarathonBestStreak();
    marathonState = Marathon.commitRun({ streak: state.correct, correct: state.correct, wrong: state.wrong });
    isNewRecord = state.correct > prevBest;
    MarathonAttempt.finalize();
  } else {
    isNewRecord = !isReview && saveBestScore(mode, finalScore);
    if (!isReview) {
      addRankingEntry({ mode: mode, score: finalScore, total: total,
        maxStreak: state.maxStreak, ts: Date.now() });
    }
  }

  if (isDaily) {
    /* ★ Flush cualquier score parcial pendiente antes de la submisión final ★ */
    if (typeof DailySync !== 'undefined') DailySync.flush();
    markDailyCompleted(finalScore);
    /* ★ Borrar el snapshot del intento en curso — fin normal de partida ★ */
    if (typeof DailyAttempt !== 'undefined') DailyAttempt.finalize();
    /* ★ Cancelar la notif de hoy y programar la de mañana ★ */
    NotificationService.onDailyCompleted();
  }

  if (state.isTournament) {
    /* ★ Borrar el snapshot del intento de torneo en curso — fin normal de partida ★ */
    if (typeof TournamentAttempt !== 'undefined') TournamentAttempt.finalize();
  }

  /* ★ Firebase + PGS: Enviar puntuación ★ */
  if (isDaily) {
    FirebaseLeaderboard.submitDailyScore(finalScore);
    PlayGamesService.submitScore('daily_challenge', finalScore);
  }

  var newAchs = checkAchievements({
    mode: mode, score: finalScore, total: total,
    correct: state.correct, wrong: state.wrong,
    maxStreak: state.maxStreak, isDaily: isDaily
  });

  PlayGamesService.processNewAchievements(newAchs, {
    correct: state.correct, wrong: state.wrong, score: finalScore,
    total: total, mode: mode, isDaily: isDaily, maxStreak: state.maxStreak
  });

  /* ★ Perfil en Firestore: el progreso ya está guardado en local (y marcado como
     pendiente); aquí se programa el envío agrupado (debounce) ★ */
  PlayerProfile.onGameFinished();

  if (isTA) { FeedbackManager.onTimeUp(); } else { FeedbackManager.onGameComplete(); }

  delay(200).then(function () {
    renderResults(finalScore, total, state.correct, state.wrong,
      state.maxStreak, isNewRecord, isDaily, mode);
    if (isMarathon) {
      Marathon.renderResults(state.correct, marathonState.bestStreak, isNewRecord,
        state.correct === getTotalQuestions());
    }
    renderResultsAchievements(newAchs);
    ProfilePill.renderResultsPlayerName();

    if (isNewRecord) { FeedbackManager.onNewRecord(); }

    var revBtn = document.getElementById('btn-review');
    if (revBtn) {
      revBtn.style.display = (state.wrongList && state.wrongList.length && !isReview && !isDaily && !isMarathon)
        ? 'flex' : 'none';
    }

    /* ★ Botón ranking en resultados ★ */
    var lbBtn = document.getElementById('btn-pgs-leaderboard');
    if (lbBtn) {
      var showLb = isMarathon || (isDaily && (FirebaseLeaderboard.isReady() || PlayGamesService.isSignedIn()));
      lbBtn.style.display = showLb ? 'flex' : 'none';
    }

    showScreen('results');

    /* ★ Mostrar resumen semanal tras completar el reto diario ★ */
    if (isDaily && FirebaseLeaderboard.isReady()) {
      _showWeeklySummary();
    }

    if (typeof DuelsUI !== 'undefined') {
      DuelsUI.onGameEnd({ score: finalScore, correct: state.correct,
                          wrong: state.wrong, maxStreak: state.maxStreak });
    }

    if (typeof TournamentsUI !== 'undefined') {
      TournamentsUI.onGameEnd({ score: finalScore, correct: state.correct,
                                wrong: state.wrong, maxStreak: state.maxStreak });
    }

    /* ── App Review ── */
    AppReview.recordSession();
    AppReview.maybeShow();

    var passRate = (isDaily || state.useDailyScoring) ? state.correct / Math.max(total, 1) : finalScore / Math.max(total, 1);
    if (isMarathon) passRate = (isNewRecord && state.correct > 0) || state.correct >= 10 ? 1 : 0;
    if (passRate >= 0.7) {
      delay(400).then(function () {
        launchConfetti(document.getElementById('confetti-canvas'));
      });
    }
    if (newAchs.length) {
      delay(800).then(function () { showNewAchievements(newAchs); });
    }
  });
}

/* ══════════════════════════════════════════════════════════════
   RANKING 2.0 — RESUMEN SEMANAL Y BANNER DE RECUPERACIÓN
   ══════════════════════════════════════════════════════════════ */

/**
 * Muestra la tarjeta de resumen semanal en la pantalla de resultados.
 * Se invoca tras completar el reto diario si Firebase está listo.
 */
function _showWeeklySummary() {
  var container = document.getElementById('results-weekly-summary');
  if (!container) return;

  var weekId = (typeof WeekUtils !== 'undefined') ? WeekUtils.getWeekId() : null;
  if (!weekId) return;

  /* Actualizar etiquetas i18n */
  var titleEl = document.getElementById('weekly-summary-title');
  var scoreLabelEl = document.getElementById('weekly-stat-score-label');
  var daysLabelEl  = document.getElementById('weekly-stat-days-label');
  var rankLabelEl  = document.getElementById('weekly-stat-rank-label');
  if (titleEl)      titleEl.textContent      = t('results_weekly_title');
  if (scoreLabelEl) scoreLabelEl.textContent = t('results_weekly_score');
  if (daysLabelEl)  daysLabelEl.textContent  = t('results_weekly_days');
  if (rankLabelEl)  rankLabelEl.textContent  = t('results_weekly_rank');

  /* Consultar ranking semanal para obtener posición del jugador */
  FirebaseLeaderboard.getFilteredRanking({
    period: 'weekly',
    dateKey: weekId,
    limit: 200
  }).then(function (entries) {
    var myEntry = null;
    for (var i = 0; i < entries.length; i++) {
      if (entries[i].isMe) { myEntry = entries[i]; break; }
    }
    if (myEntry) {
      var scoreEl = document.getElementById('weekly-stat-score');
      var daysEl  = document.getElementById('weekly-stat-days');
      var rankEl  = document.getElementById('weekly-stat-rank');
      if (scoreEl) scoreEl.textContent = myEntry.score;
      if (daysEl)  daysEl.textContent  = (myEntry.daysPlayed || 1) + '/7';
      if (rankEl)  rankEl.textContent  = '#' + myEntry.position;
      container.style.display = 'block';
    }
  }).catch(function () {
    /* Silencioso — no mostrar si falla */
  });
}

/**
 * Comprueba si debe mostrarse el banner de recuperación de día en la home.
 * Usa AdRewardService.canRecoverMissedDay() de Fase 1.
 */
function _checkRecoveryBanner() {
  var banner = document.getElementById('recovery-banner');
  if (!banner) return;

  if (typeof AdRewardService === 'undefined') { banner.style.display = 'none'; return; }

  var result = AdRewardService.canRecoverMissedDay();

  if (!result.eligible) {
    banner.style.display = 'none';
    return;
  }

  /* Mostrar banner con textos i18n */
  banner.style.display = 'block';
  var titleEl = document.getElementById('recovery-banner-title');
  var subEl   = document.getElementById('recovery-banner-sub');
  if (titleEl) titleEl.textContent = t('recovery_banner_title');
  if (subEl)   subEl.textContent   = t('recovery_banner_remaining', { n: result.recoveriesRemaining });
}

/* ══════════════════════════════════════════════════════════════
   TIMERS
   ══════════════════════════════════════════════════════════════ */

function _startPerQuestionTimer(secs) {
  _stopPerQuestionTimer();
  var startTs = Date.now();
  var totalMs = secs * 1000;
  var warnedAt = null;
  updateTimerUI(secs, secs);
  _timerHandle = setInterval(function () {
    var elapsed = Date.now() - startTs;
    var rem = Math.max(0, Math.ceil((totalMs - elapsed) / 1000));
    updateTimerUI(rem, secs);
    if (rem <= 3 && rem > 0 && rem !== warnedAt) {
      warnedAt = rem;
      FeedbackManager.onTimerWarning();
    }
    if (elapsed >= totalMs) { _stopPerQuestionTimer(); _handleAnswer(-1); }
  }, 250);
}
function _stopPerQuestionTimer() {
  if (_timerHandle) { clearInterval(_timerHandle); _timerHandle = null; }
}
function _startGlobalTimer(secs) {
  _stopGlobalTimer(); _globalSecs = secs; updateGlobalTimer(_globalSecs);
  _globalTimer = setInterval(function () {
    _globalSecs--; updateGlobalTimer(_globalSecs);
    if (_globalSecs <= 0) { _stopGlobalTimer(); forceFinishGame(); _endGame(); }
  }, 1000);
}
function _stopGlobalTimer() {
  if (_globalTimer) { clearInterval(_globalTimer); _globalTimer = null; }
}
function _stopAll()  {
  _stopPerQuestionTimer(); _stopGlobalTimer();
  if (_autoAdvance) { clearTimeout(_autoAdvance); _autoAdvance = null; }
}
function _pauseAll() { _stopAll(); }
function _startDailyTimer() {
  setQuestionStartTime();
  _startPerQuestionTimer(ScoreCalculator.MAX_QUESTION_TIME);
}
function _resumeTimers() {
  var state = getGameState(); if (!state) return;
  if (state.isTimeTrial && _globalSecs > 0) { _startGlobalTimer(_globalSecs); }
  else if ((state.isDailyChallenge || state.useDailyScoring) && !state.answered) { _startDailyTimer(); }
  else if (state.isMarathon && !state.answered) { _startPerQuestionTimer(ScoreCalculator.MAX_QUESTION_TIME); }
  else if (!state.isTimeTrial && _settings.timerEnabled && !state.answered) {
    _startPerQuestionTimer(_settings.timerDuration);
  }
}

function _refreshBestScore() { renderHomeBestScore(loadBestScore(_selectedModeId)); }

/** Arranca la partida de duelo desde DuelsUI (tras llamar a initGame()). */
function launchDuelGame() {
  _settings = loadSettings();
  AudioFX.resume();
  _startGameFromState();
}

/* ══════════════════════════════════════════════════════════════
   PERFIL DE JUGADOR (Firestore)
   ══════════════════════════════════════════════════════════════ */

/*
 * Sincronización inicial del perfil: UNA lectura de players/{id} por sesión
 * (Casos A / B / C en js/player-profile.js). Si se descargó o fusionó progreso
 * remoto, se repintan los elementos de la home que dependen de él.
 */
function _syncPlayerProfile() {
  PlayerProfile.bootstrap().then(function (res) {
    if (!res || !res.localChanged) return;
    _refreshBestScore();
    updateDailyCardUI();
    updateMarathonCardUI();
    _updateDailyStreakUI();
    _updatePlayButton();
    ProfileUI.refresh({ data: true });
  });
}

/* ══════════════════════════════════════════════════════════════
   TECLADO / BACK BUTTON
   ══════════════════════════════════════════════════════════════ */

/*
 * Gestiona dos responsabilidades:
 *   1. Atajos de juego (teclas 1-4, Enter/Espacio para avanzar).
 *   2. Escape — un paso atrás (BackNav). El botón/gesto atrás de Android e iOS
 *      lo gestiona BackNav directamente (back-nav.js).
 */
function _handleKeyboard(e) {
  if (e.key === 'Escape') {
    BackNav.back();
    return;
  }
  if (!_gameActive) return;
  var state = getGameState(); if (!state) return;
  if (['1','2','3','4'].indexOf(e.key) !== -1 && !state.answered) {
    var b = document.querySelectorAll('.option-btn')[parseInt(e.key, 10) - 1];
    if (b) b.click(); return;
  }
  if ((e.key === 'Enter' || e.key === ' ') && state.answered) {
    e.preventDefault();
    var nb = document.getElementById('btn-next');
    if (nb && nb.style.display !== 'none') nb.click();
  }
}

/* ══════════════════════════════════════════════════════════════
   ONBOARDING
   ══════════════════════════════════════════════════════════════ */

function _initOnboarding() {
  if (storageLoad('onboarding_suppress') === true) return;
  var overlay  = document.getElementById('onboarding-overlay');
  var track    = document.getElementById('ob-swipe-track');
  var dots     = overlay.querySelectorAll('.ob-dot');
  var btnClose = document.getElementById('ob-close');
  var btnStart = document.getElementById('ob-start');
  var cbDontShow = document.getElementById('ob-dont-show');
  var current  = 0;
  var TOTAL    = 3;

  /* ── i18n ── */
  overlay.querySelectorAll('[data-i18n]').forEach(function (el) {
    el.textContent = t(el.getAttribute('data-i18n'));
  });
  btnClose.setAttribute('aria-label', t('ob_close_label'));

  /* ── Slide 1: pills dinámicas desde modes.js ── */
  var pillsContainer = document.getElementById('ob-mode-pills');
  var allModes = MODE_GROUPS.reduce(function (acc, g) { return acc.concat(g.modes); }, []).concat([MODE_SOLO, MODE_MARATHON]);
  allModes.forEach(function (m) {
    var pill = document.createElement('div');
    pill.className = 'ob-mode-pill';
    pill.textContent = m.visualBig + ' ' + getModeDisplayName(m.id);
    pillsContainer.appendChild(pill);
  });

  /* ── Renderizador de feature rows ── */
  function _renderFeatures(container, features) {
    features.forEach(function (f) {
      var row  = document.createElement('div');
      row.className = 'ob-feature-row';
      var icon = document.createElement('span');
      icon.className = 'ob-feature-icon';
      icon.textContent = f.icon;
      var text = document.createElement('span');
      text.textContent = t(f.key);
      row.appendChild(icon);
      row.appendChild(text);
      container.appendChild(row);
    });
  }

  /* ── Slide 2: features de competición ── */
  _renderFeatures(document.getElementById('ob-features-2'), [
    { icon: '📅', key: 'ob_feat_daily' },
    { icon: '🏆', key: 'ob_feat_ranking' },
    { icon: '⚔️', key: 'ob_feat_duels' },
    { icon: '🔥', key: 'ob_feat_streak' }
  ]);

  /* ── Slide 3: features de progresión ── */
  _renderFeatures(document.getElementById('ob-features-3'), [
    { icon: '🏅', key: 'ob_feat_achievements' },
    { icon: '📊', key: 'ob_feat_stats' },
    { icon: '⚙️', key: 'ob_feat_customize' }
  ]);

  /* ── Navegación ── */
  function _goTo(idx) {
    current = Math.max(0, Math.min(TOTAL - 1, idx));
    track.style.transform = 'translateX(-' + current * 100 + '%)';
    dots.forEach(function (d, i) { d.classList.toggle('active', i === current); });
  }

  /* ── Swipe con Touch API ── */
  var startX = 0;
  var dragging = false;
  track.addEventListener('touchstart', function (e) {
    startX = e.touches[0].clientX;
    dragging = true;
    track.style.transition = 'none';
  }, { passive: true });
  track.addEventListener('touchmove', function (e) {
    if (!dragging) return;
    var delta = e.touches[0].clientX - startX;
    var base  = -current * 100;
    var pct   = base + (delta / track.parentElement.offsetWidth) * 100;
    track.style.transform = 'translateX(' + pct + '%)';
  }, { passive: true });
  track.addEventListener('touchend', function (e) {
    if (!dragging) return;
    dragging = false;
    track.style.transition = '';
    var delta = e.changedTouches[0].clientX - startX;
    if (delta < -50 && current < TOTAL - 1) { _goTo(current + 1); }
    else if (delta > 50 && current > 0)     { _goTo(current - 1); }
    else                                    { _goTo(current); }
  }, { passive: true });

  /* ── Dots clicables ── */
  dots.forEach(function (d) {
    d.addEventListener('click', function () { _goTo(parseInt(d.dataset.slide, 10)); });
  });

  /* ── Cerrar ── */
  function _close() {
    if (cbDontShow.checked) { storageSave('onboarding_suppress', true); }
    overlay.style.display = 'none';
  }
  btnClose.addEventListener('click', _close);
  btnStart.addEventListener('click', _close);

  overlay.style.display = 'flex';
  _goTo(0);
}

/* ══════════════════════════════════════════════════════════════
   RACHA DIARIA
   ══════════════════════════════════════════════════════════════ */

function _updateDailyStreakUI() {
  var el = document.getElementById('daily-streak-label'); if (!el) return;
  var s = getDailyStreak();
  if (s === 0)      el.textContent = t('daily_streak_0');
  else if (s === 1) el.textContent = t('daily_streak_1');
  else              el.textContent = t('daily_streak_n', { n: s });
  el.style.display = s > 0 ? 'block' : 'none';
}

/* ══════════════════════════════════════════════════════════════
   SELECTOR DE CONTINENTE
   ══════════════════════════════════════════════════════════════ */

function _initContinentSelector() {
  var sel = document.getElementById('continent-select'); if (!sel) return;
  sel.value = _selectedContinent;
  sel.addEventListener('change', function () {
    _selectedContinent = sel.value;
    storageSave('last_continent', _selectedContinent);
  });
}
