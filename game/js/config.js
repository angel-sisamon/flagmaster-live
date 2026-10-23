/**
 * js/config.js — Configuración centralizada de integraciones externas
 *
 * ORDEN DE CARGA:
 *  - Debe cargarse antes de cualquier script que consuma AppConfig
 *    (firebase init inline, play-games.js, notifications.js, etc.)
 */
(function (global) {
  global.AppConfig = global.AppConfig || {};

  if (!global.AppConfig.firebase) {
    global.AppConfig.firebase = {
      apiKey: "AIzaSyC7AWLRBIzYfy681OleacIBf117BSRi208",
      authDomain: "flagmaster-14d61.firebaseapp.com",
      projectId: "flagmaster-14d61",
      storageBucket: "flagmaster-14d61.firebasestorage.app",
      messagingSenderId: "101776765614",
      appId: "1:101776765614:web:db52567dde733b3b2a333f",
      measurementId: "G-D84KC5P9ME"
    };
  }

  if (!global.AppConfig.playGames) {
    global.AppConfig.playGames = {
      achievementMap: {
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
      },
      leaderboardMap: {
        'daily_challenge': 'CgkIx-P40Z4ZEAIQDw'
      }
    };
  }

  if (!global.AppConfig.notifications) {
    global.AppConfig.notifications = {
      id: 1001,
      hour: 20,
      minute: 0
    };
  }

  if (!global.AppConfig.version) {
    global.AppConfig.version = "2.1.0";
  }
})(window);
