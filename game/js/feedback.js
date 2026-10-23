/**
 * js/feedback.js — FeedbackManager
 * Orquesta AudioFX + vibrateDevice desde un único punto.
 * Se carga después de audio.js y utils.js.
 */
var FeedbackManager = (function () {
  'use strict';

  var _soundEnabled     = true;
  var _vibrationEnabled = true;

  function _vibrate(pattern) {
    vibrateDevice(pattern, _vibrationEnabled);
  }

  function configure(settings) {
    _soundEnabled     = !!settings.soundEnabled;
    _vibrationEnabled = !!settings.vibration;
    AudioFX.setEnabled(_soundEnabled);
  }

  return {
    configure: configure,

    onCorrectAnswer: function () {
      AudioFX.correct();
      _vibrate([40]);
    },
    onWrongAnswer: function () {
      AudioFX.wrong();
      _vibrate([70, 30, 70]);
    },
    onStreak: function () {
      AudioFX.streak();
      _vibrate([20, 10, 20, 10, 20]);
    },
    onGameComplete: function () {
      AudioFX.complete();
      _vibrate([50, 30, 100]);
    },
    onTimeUp: function () {
      AudioFX.timeUp();
      _vibrate([100]);
    },
    onAchievement: function () {
      AudioFX.achievement();
      _vibrate([40, 30, 40]);
    },
    onNewRecord: function () {
      AudioFX.newRecord();
      _vibrate([30, 20, 30, 20, 30, 20, 80]);
    },
    onTimerWarning: function () {
      AudioFX.timerWarning();
      _vibrate([15]);
    },
    onButtonTap: function () {
      AudioFX.buttonTap();
      _vibrate([12]);
    },
    onScreenTransition: function () {
      AudioFX.screenTransition();
    },
    onModeSelect: function () {
      _vibrate([18]);
    },
    onGroupToggle: function () {
      _vibrate([12]);
    },
    onCountdownTick: function () {
      AudioFX.countdownTick();
    }
  };
})();
