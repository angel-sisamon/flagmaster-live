/**
 * js/audio.js
 * Motor de sonido — Web Audio API. Sin archivos externos.
 * Genera todos los tonos por código (osciladores + envolventes).
 */
var AudioFX = (function () {
  var _ctx     = null;
  var _enabled = true;

  function _getCtx() {
    if (!_ctx) {
      try { _ctx = new (window.AudioContext || window.webkitAudioContext)(); }
      catch (e) { return null; }
    }
    if (_ctx.state === 'suspended') _ctx.resume().catch(function () {});
    return _ctx;
  }

  function _note(freq, startTime, duration, type, vol) {
    var ctx = _getCtx();
    if (!ctx) return;
    var osc  = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, startTime);
    gain.gain.setValueAtTime(0, startTime);
    gain.gain.linearRampToValueAtTime(vol || 0.25, startTime + 0.012);
    gain.gain.linearRampToValueAtTime((vol || 0.25) * 0.75, startTime + duration * 0.3);
    gain.gain.linearRampToValueAtTime(0, startTime + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(startTime);
    osc.stop(startTime + duration + 0.05);
  }

  // ── Efectos ───────────────────────────────────────

  function correct() {
    if (!_enabled) return;
    var ctx = _getCtx(); if (!ctx) return;
    var t = ctx.currentTime;
    _note(523.25, t,        0.13, 'sine', 0.22);  // C5
    _note(659.25, t + 0.10, 0.13, 'sine', 0.22);  // E5
    _note(783.99, t + 0.20, 0.22, 'sine', 0.28);  // G5
  }

  function wrong() {
    if (!_enabled) return;
    var ctx = _getCtx(); if (!ctx) return;
    var t = ctx.currentTime;
    _note(320, t,        0.10, 'sawtooth', 0.12);
    _note(260, t + 0.10, 0.10, 'sawtooth', 0.10);
    _note(200, t + 0.20, 0.20, 'sawtooth', 0.08);
  }

  function streak() {
    if (!_enabled) return;
    var ctx = _getCtx(); if (!ctx) return;
    var t = ctx.currentTime;
    var notes = [523.25, 587.33, 659.25, 698.46, 783.99];
    for (var i = 0; i < notes.length; i++) {
      _note(notes[i], t + i * 0.065, 0.13, 'sine', 0.18);
    }
  }

  function complete() {
    if (!_enabled) return;
    var ctx = _getCtx(); if (!ctx) return;
    var t = ctx.currentTime;
    _note(523.25, t,        0.10, 'sine', 0.22);
    _note(659.25, t + 0.10, 0.10, 'sine', 0.22);
    _note(783.99, t + 0.20, 0.10, 'sine', 0.22);
    _note(1046.5,  t + 0.30, 0.45, 'sine', 0.28);
  }

  function achievement() {
    if (!_enabled) return;
    var ctx = _getCtx(); if (!ctx) return;
    var t = ctx.currentTime;
    _note(659.25, t,        0.20, 'sine', 0.18);
    _note(830.61, t + 0.08, 0.20, 'sine', 0.18);
    _note(1046.5,  t + 0.16, 0.20, 'sine', 0.18);
    _note(1318.5,  t + 0.26, 0.40, 'sine', 0.22);
  }

  function tick() {
    if (!_enabled) return;
    var ctx = _getCtx(); if (!ctx) return;
    _note(1200, ctx.currentTime, 0.025, 'sine', 0.08);
  }

  function timerWarning() {
    if (!_enabled) return;
    var ctx = _getCtx(); if (!ctx) return;
    var t = ctx.currentTime;
    _note(880, t,        0.07, 'square', 0.06);
    _note(880, t + 0.12, 0.07, 'square', 0.06);
  }

  function timeUp() {
    if (!_enabled) return;
    var ctx = _getCtx(); if (!ctx) return;
    var t = ctx.currentTime;
    _note(440, t,        0.15, 'sawtooth', 0.15);
    _note(330, t + 0.18, 0.15, 'sawtooth', 0.12);
    _note(220, t + 0.36, 0.30, 'sawtooth', 0.10);
  }

  function buttonTap() {
    if (!_enabled) return;
    var ctx = _getCtx(); if (!ctx) return;
    _note(800, ctx.currentTime, 0.03, 'sine', 0.08);
  }

  function newRecord() {
    if (!_enabled) return;
    var ctx = _getCtx(); if (!ctx) return;
    var t = ctx.currentTime;
    _note(523.25, t,        0.12, 'sine', 0.20);
    _note(659.25, t + 0.10, 0.12, 'sine', 0.20);
    _note(783.99, t + 0.20, 0.12, 'sine', 0.22);
    _note(1046.5, t + 0.30, 0.12, 'sine', 0.24);
    _note(1318.5, t + 0.40, 0.12, 'sine', 0.26);
    _note(1568.0, t + 0.50, 0.35, 'sine', 0.28);
  }

  function screenTransition() {
    if (!_enabled) return;
    var ctx = _getCtx(); if (!ctx) return;
    var t = ctx.currentTime;
    var osc  = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(200, t);
    osc.frequency.exponentialRampToValueAtTime(800, t + 0.08);
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.06, t + 0.01);
    gain.gain.linearRampToValueAtTime(0, t + 0.08);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.1);
  }

  function countdownTick() {
    if (!_enabled) return;
    var ctx = _getCtx(); if (!ctx) return;
    _note(600, ctx.currentTime, 0.02, 'sine', 0.06);
  }

  // ── API pública ────────────────────────────────────

  function setEnabled(v) { _enabled = !!v; }
  function resume()      { _getCtx(); }

  return {
    correct:          correct,
    wrong:            wrong,
    streak:           streak,
    complete:         complete,
    achievement:      achievement,
    tick:             tick,
    timerWarning:     timerWarning,
    timeUp:           timeUp,
    buttonTap:        buttonTap,
    newRecord:        newRecord,
    screenTransition: screenTransition,
    countdownTick:    countdownTick,
    setEnabled:       setEnabled,
    resume:           resume,
  };
})();
