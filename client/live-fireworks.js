/**
 * js/live-fireworks.js — Fuegos artificiales en <canvas> para la vista de resultados del modo LIVE.
 *
 * Implementación propia (~100 líneas) en lugar de fireworks-js por CDN: así la app empaquetada
 * con Capacitor no depende de red ni añade librerías.
 *
 *   LiveFireworks.start(canvas, intensity)   intensity 0..1 → cohetes por segundo
 *   LiveFireworks.stop()
 *
 * El lienzo es transparente (las estelas se borran con destination-out), así se ve el fondo animado.
 */
var LiveFireworks = (function () {
  var COLORS = ['#ffd040', '#ff9f00', '#ff4fa3', '#4fd1ff', '#22c55e', '#b18cff', '#ffffff'];
  var GRAVITY = 0.045;          // partículas (px/frame²)
  var ROCKET_GRAVITY = 0.22;    // cohetes: suben rápido (~1 s) y frenan antes de explotar
  var MAX_PARTICLES = 700;

  var _canvas = null, _ctx = null, _raf = 0, _running = false;
  var _rockets = [], _particles = [];
  var _rate = 1.2, _nextLaunch = 0, _last = 0, _dpr = 1;

  function _resize() {
    if (!_canvas) return;
    _dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = _canvas.clientWidth, h = _canvas.clientHeight;
    _canvas.width = Math.round(w * _dpr);
    _canvas.height = Math.round(h * _dpr);
    _ctx.setTransform(_dpr, 0, 0, _dpr, 0, 0);
  }

  function _rand(a, b) { return a + Math.random() * (b - a); }

  function _launch() {
    var w = _canvas.clientWidth, h = _canvas.clientHeight;
    // Velocidad justa para frenar (y explotar) a una altura aleatoria del 12-50 % de la pantalla
    var rise = h + 10 - _rand(h * 0.12, h * 0.5);
    _rockets.push({
      x: _rand(w * 0.15, w * 0.85), y: h + 10,
      vx: _rand(-0.8, 0.8), vy: -Math.sqrt(2 * ROCKET_GRAVITY * rise),
      color: COLORS[Math.floor(Math.random() * COLORS.length)]
    });
  }

  function _explode(r) {
    var n = Math.round(_rand(40, 70));
    var speed = _rand(2.2, 3.6);
    for (var i = 0; i < n && _particles.length < MAX_PARTICLES; i++) {
      var a = (Math.PI * 2 * i) / n + _rand(-0.08, 0.08);
      var s = speed * _rand(0.55, 1);
      _particles.push({
        x: r.x, y: r.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: 1, decay: _rand(0.011, 0.018),
        color: Math.random() < 0.2 ? '#ffffff' : r.color
      });
    }
  }

  function _frame(now) {
    if (!_running) return;
    _raf = requestAnimationFrame(_frame);
    var w = _canvas.clientWidth, h = _canvas.clientHeight;
    // Frame a ~60 fps: dt normaliza la física si el navegador va más lento
    var dt = Math.min((now - (_last || now)) / 16.67, 3);
    _last = now;

    if (now >= _nextLaunch) {
      _launch();
      _nextLaunch = now + (1000 / _rate) * _rand(0.6, 1.4);
    }

    // Estelas: se borra un poco de lo pintado en lugar de rellenar con un color de fondo
    _ctx.globalCompositeOperation = 'destination-out';
    _ctx.fillStyle = 'rgba(0,0,0,0.28)';
    _ctx.fillRect(0, 0, w, h);
    _ctx.globalCompositeOperation = 'lighter';

    for (var i = _rockets.length - 1; i >= 0; i--) {
      var r = _rockets[i];
      var px = r.x, py = r.y;
      r.x += r.vx * dt; r.y += r.vy * dt; r.vy += ROCKET_GRAVITY * dt;
      _ctx.strokeStyle = r.color;
      _ctx.lineWidth = 2.5;
      _ctx.beginPath(); _ctx.moveTo(px, py); _ctx.lineTo(r.x, r.y); _ctx.stroke();
      if (r.vy >= -0.5) { _explode(r); _rockets.splice(i, 1); }
    }
    for (var j = _particles.length - 1; j >= 0; j--) {
      var p = _particles[j];
      p.vx *= 0.985; p.vy = p.vy * 0.985 + GRAVITY * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.life -= p.decay * dt;
      if (p.life <= 0) { _particles.splice(j, 1); continue; }
      _ctx.globalAlpha = p.life;
      _ctx.fillStyle = p.color;
      _ctx.beginPath();
      _ctx.arc(p.x, p.y, 2.6 * p.life + 0.8, 0, Math.PI * 2);
      _ctx.fill();
    }
    _ctx.globalAlpha = 1;
  }

  function start(canvas, intensity) {
    if (!canvas || !canvas.getContext) return;
    var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    _rate = (reduced ? 0.4 : 1) * (0.8 + 2.4 * Math.max(0, Math.min(1, intensity == null ? 0.5 : intensity)));
    if (_running && canvas === _canvas) return;
    stop();
    _canvas = canvas;
    _ctx = canvas.getContext('2d');
    _resize();
    _running = true;
    _last = 0;
    _nextLaunch = 0;
    window.addEventListener('resize', _resize);
    _raf = requestAnimationFrame(_frame);
  }

  function stop() {
    _running = false;
    cancelAnimationFrame(_raf);
    window.removeEventListener('resize', _resize);
    _rockets = []; _particles = [];
    if (_ctx && _canvas) _ctx.clearRect(0, 0, _canvas.width, _canvas.height);
  }

  return { start: start, stop: stop };
})();
