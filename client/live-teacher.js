/**
 * client/live-teacher.js — La profe: personaje animado (SVG) que presenta el directo en la propia página.
 *
 * Sustituye al avatar de VTube Studio cuando no hay VTuber: no hace falta nada fuera del navegador, así que también
 * sale emitiendo desde el móvil (compartir pantalla). live-mode.js la activa (body.live-teacher) y le dice en qué
 * momento está la partida; cada momento tiene su sitio y las pantallas le dejan ese hueco libre (live-mode.css):
 *
 *   spot      dónde                       bocadillo     pantalla
 *   lobby     abajo a la izquierda        a la derecha  sala de espera
 *   question  abajo a la derecha          a la izquierda  pregunta (y la revelación de la respuesta)
 *   results   abajo a la izquierda        a la derecha  resultados (tarjetas pegadas arriba)
 *   table     abajo a la derecha          encima        tabla de acertantes (columna derecha recortada)
 *   final     abajo a la derecha          encima        final de partida
 *
 * Al cambiar de sitio cruza la pantalla dando saltitos y se gira hacia el contenido.
 *
 * Voz (live-voice.js, por LiveVoice.setObserver): cuando el locutor habla, la profe mueve la boca y el bocadillo
 * muestra la frase, con las palabras iluminándose a medida que se dicen.
 *   - Locuciones grabadas: la boca sigue el volumen real del audio (Web Audio, AnalyserNode) y el texto avanza con
 *     audio.currentTime. Si el AudioContext no está en marcha no se engancha (el audio sonaría mudo): boca simulada.
 *   - speechSynthesis: no da acceso al audio; boca simulada y texto por los eventos 'boundary' (o por tiempo).
 *
 *   LiveTeacher.enable() / disable()   live-mode.js al entrar / salir del modo LIVE (enable dentro del clic: AudioContext)
 *   LiveTeacher.setSpot(spot)          ver tabla de arriba
 *   LiveTeacher.react(mood, ms)        'happy' | 'sad' | 'wow' | 'cheer' | 'point' | 'wave' (vuelve a normal tras ms)
 *
 * Sin SVG o con la clase quitada todo es no-op: el directo sigue igual.
 */
var LiveTeacher = (function () {
  var SPOTS = {
    lobby:    { side: 'left',  bubble: 'right' },
    question: { side: 'right', bubble: 'left' },
    results:  { side: 'left',  bubble: 'right' },
    table:    { side: 'right', bubble: 'top' },
    final:    { side: 'right', bubble: 'top' }
  };
  var WALK_MS = 950;              // = transición de "left" en live-mode.css
  var BUBBLE_LINGER_MS = 2200;    // el bocadillo se queda un poco después de hablar
  var MOUTH_HOLD_MS = 70;         // mínimo en cada forma de boca (sin parpadeo nervioso)
  var TTS_MS_PER_CHAR = 62;       // estimación de ritmo de speechSynthesis si no llegan 'boundary'
  var WAVE_EVERY_MS = [9000, 16000];

  var SVG =
    '<svg class="lt-figure" viewBox="0 0 200 260" aria-hidden="true">' +
      '<ellipse class="lt-shadow" cx="100" cy="253" rx="60" ry="6"/>' +
      '<g class="lt-body">' +
        '<path d="M42 262 C42 204 60 174 100 170 C140 174 158 204 158 262 Z" fill="#e8505b"/>' +
        '<path d="M80 172 L100 212 L120 172 Z" fill="#ffffff"/>' +
        '<path d="M79 170 L100 190 L90 201 Z M121 170 L100 190 L110 201 Z" fill="#fde7ea"/>' +
        '<circle cx="100" cy="226" r="3.6" fill="#ffd040"/><circle cx="100" cy="244" r="3.6" fill="#ffd040"/>' +
        '<g class="lt-pin"><circle cx="131" cy="204" r="7.5" fill="#4fd1ff" stroke="#1b5f86" stroke-width="2"/>' +
          '<path d="M124 204 H138 M131 197 C127 201 127 207 131 211 C135 207 135 201 131 197" stroke="#1b5f86" stroke-width="1.6" fill="none"/></g>' +
        '<path d="M56 196 C42 220 44 242 60 252" stroke="#c83b48" stroke-width="17" stroke-linecap="round" fill="none"/>' +
        '<circle cx="61" cy="252" r="8" fill="#f6cfae"/>' +
        '<g class="lt-arm">' +
          '<path d="M146 194 C160 212 164 230 154 246" stroke="#c83b48" stroke-width="17" stroke-linecap="round" fill="none"/>' +
          '<line x1="154" y1="247" x2="192" y2="204" stroke="#8b5a2b" stroke-width="4.5" stroke-linecap="round"/>' +
          '<circle cx="192" cy="204" r="4" fill="#ffd040"/>' +
          '<circle cx="154" cy="247" r="8.5" fill="#f6cfae"/>' +
        '</g>' +
      '</g>' +
      '<g class="lt-head">' +
        '<rect x="91" y="146" width="18" height="28" rx="6" fill="#e9b994"/>' +
        '<circle cx="100" cy="36" r="23" fill="#5a3825"/>' +
        '<line x1="84" y1="24" x2="118" y2="44" stroke="#ffd040" stroke-width="4" stroke-linecap="round"/>' +
        '<path d="M115 41 L121 45" stroke="#3b2a1a" stroke-width="4" stroke-linecap="round"/>' +
        '<ellipse cx="100" cy="94" rx="57" ry="60" fill="#5a3825"/>' +
        '<circle cx="46" cy="104" r="9" fill="#efc3a0"/><circle cx="154" cy="104" r="9" fill="#efc3a0"/>' +
        '<ellipse cx="100" cy="102" rx="48" ry="53" fill="#f6cfae"/>' +
        '<path d="M51 92 C54 54 84 40 104 43 C132 46 151 66 150 94 C138 74 120 66 102 69 C84 72 66 80 51 92 Z" fill="#5a3825"/>' +
        '<g class="lt-brows" stroke="#4a2c1c" stroke-width="3.6" stroke-linecap="round" fill="none">' +
          '<path class="lt-brow-l" d="M70 80 Q80 75 90 79"/><path class="lt-brow-r" d="M110 79 Q120 75 130 80"/></g>' +
        '<g class="lt-eyes" fill="#2b1d2f">' +
          '<ellipse cx="80" cy="100" rx="5" ry="6.2"/><ellipse cx="120" cy="100" rx="5" ry="6.2"/>' +
          '<circle cx="82" cy="98" r="1.6" fill="#fff"/><circle cx="122" cy="98" r="1.6" fill="#fff"/></g>' +
        '<g class="lt-glasses" stroke="#3b2a4a" stroke-width="3.4" fill="rgba(255,255,255,.14)">' +
          '<circle cx="80" cy="100" r="15"/><circle cx="120" cy="100" r="15"/>' +
          '<path d="M95 99 Q100 94 105 99" fill="none"/><path d="M65 98 L54 94 M135 98 L146 94" fill="none"/></g>' +
        '<ellipse cx="66" cy="122" rx="8" ry="5" fill="#ff8fa3" opacity=".5"/>' +
        '<ellipse cx="134" cy="122" rx="8" ry="5" fill="#ff8fa3" opacity=".5"/>' +
        '<path d="M100 106 Q95 115 101 116" stroke="#d99d7a" stroke-width="2.6" fill="none" stroke-linecap="round"/>' +
        '<g class="lt-mouth">' +
          '<path class="lt-m0" d="M87 129 Q100 138 113 129" stroke="#7a2e3a" stroke-width="3.6" fill="none" stroke-linecap="round"/>' +
          '<ellipse class="lt-m1" cx="100" cy="131" rx="8" ry="5" fill="#7a2e3a"/>' +
          '<g class="lt-m2"><path d="M85 126 Q100 123 115 126 Q113 146 100 147 Q87 146 85 126 Z" fill="#7a2e3a"/>' +
            '<ellipse cx="100" cy="140" rx="7.5" ry="4" fill="#ff7a8a"/></g>' +
          '<ellipse class="lt-mo" cx="100" cy="133" rx="6" ry="7.5" fill="#7a2e3a"/>' +
        '</g>' +
      '</g>' +
    '</svg>';

  var _root = null, _bubble = null, _text = null;
  var _enabled = false;
  var _spot = null;
  var _walkTimer = null, _moodTimer = null, _hideTimer = null, _waveTimer = null;
  var _ctx = null;
  var _raf = 0;

  // Habla en curso: segmentos (una frase por audio; "respuesta + coletilla" son dos) y estado de la boca
  var _speech = null;   // { words: [{el, end}], segStart, segLen, audio, analyser, data, startedAt, charIdx, text }
  var _talking = false;  // entre start y end del locutor (una locución puede tener varios audios seguidos)
  var _mouth = 0, _mouthSince = 0, _fakeUntil = 0;

  function _el(id) { return document.getElementById(id); }

  function _build() {
    if (_root) return;
    _root = document.createElement('div');
    _root.className = 'lt-root';
    _root.id = 'live-teacher';
    _root.setAttribute('aria-hidden', 'true');
    _root.dataset.mouth = '0';
    _root.innerHTML = '<div class="lt-bubble" hidden><p class="lt-bubble-text"></p></div>' + SVG;
    document.body.appendChild(_root);
    _bubble = _root.querySelector('.lt-bubble');
    _text = _root.querySelector('.lt-bubble-text');
  }

  /* ── Sitio en pantalla ──────────────────────────────── */
  function setSpot(spot) {
    if (!SPOTS[spot]) return;
    _build();
    document.body.dataset.teacherSpot = spot;
    if (spot === _spot) return;
    var prev = _spot && SPOTS[_spot];
    var next = SPOTS[spot];
    _spot = spot;
    _root.dataset.bubble = next.bubble;
    // Mira hacia el centro de la pantalla (el puntero queda del lado del contenido)
    _root.dataset.face = next.side === 'left' ? 'right' : 'left';
    if (prev && prev.side !== next.side && _enabled) {
      // Mientras cruza mira hacia donde va
      _root.dataset.face = next.side;
      _root.classList.add('lt-walking');
      clearTimeout(_walkTimer);
      _walkTimer = setTimeout(function () {
        _root.classList.remove('lt-walking');
        _root.dataset.face = next.side === 'left' ? 'right' : 'left';
      }, WALK_MS);
    }
    _root.dataset.side = next.side;
    _scheduleWave();
  }

  /* ── Gestos y caras ─────────────────────────────────── */
  function react(mood, ms) {
    if (!_root) return;
    _root.dataset.mood = mood || '';
    clearTimeout(_moodTimer);
    if (mood && ms) _moodTimer = setTimeout(function () { if (_root) _root.dataset.mood = ''; }, ms);
  }

  // En la sala de espera saluda con la mano de vez en cuando
  function _scheduleWave() {
    clearTimeout(_waveTimer);
    if (!_enabled || _spot !== 'lobby') return;
    var ms = WAVE_EVERY_MS[0] + Math.random() * (WAVE_EVERY_MS[1] - WAVE_EVERY_MS[0]);
    _waveTimer = setTimeout(function () {
      if (_spot === 'lobby' && !_root.dataset.mood) react('wave', 2400);
      _scheduleWave();
    }, ms);
  }

  /* ── Voz → boca y bocadillo ─────────────────────────── */
  function _audioContext() {
    if (_ctx) return _ctx;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try { _ctx = new AC(); } catch (e) { _ctx = null; }
    return _ctx;
  }

  /* Engancha el audio al analizador solo si el contexto suena: un MediaElementSource con el contexto parado
   * dejaría la locución muda. Cada <audio> solo se puede enganchar una vez. */
  function _analyse(audio) {
    var ctx = _ctx;
    if (!audio || !ctx || ctx.state !== 'running' || audio._ltAnalyser) return audio && audio._ltAnalyser || null;
    try {
      var src = ctx.createMediaElementSource(audio);
      var an = ctx.createAnalyser();
      an.fftSize = 512;
      an.smoothingTimeConstant = 0.35;
      src.connect(an);
      an.connect(ctx.destination);
      audio._ltAnalyser = an;
      return an;
    } catch (e) { return null; }
  }

  function _wordsHtml(text, offset) {
    var parts = String(text).split(/(\s+)/);
    var pos = offset, html = [];
    parts.forEach(function (p) {
      if (!p) return;
      if (/^\s+$/.test(p)) { html.push(' '); pos += p.length; return; }
      pos += p.length;
      var span = document.createElement('span');
      span.className = 'lt-w';
      span.textContent = p;        // textContent: los nicks de la voz del navegador no se interpretan como HTML
      span.dataset.end = pos;
      html.push(span.outerHTML);
    });
    return html.join('');
  }

  /* El locutor empieza una frase. Si ya estaba hablando (respuesta + coletilla) se añade a la misma burbuja */
  function _onStart(text, audio) {
    if (!_enabled || !_root) return;
    text = String(text || '').trim();
    clearTimeout(_hideTimer);
    var continuing = _talking && !!_speech;
    _talking = true;
    if (!continuing) { _text.innerHTML = ''; _speech = { text: '' }; }
    var offset = _speech.text.length + (continuing && text ? 1 : 0);
    if (text) {
      if (continuing) _text.insertAdjacentHTML('beforeend', ' ');
      _text.insertAdjacentHTML('beforeend', _wordsHtml(text, offset));
      _speech.text += (continuing ? ' ' : '') + text;
    }
    _speech.segStart = offset;
    _speech.segLen = text.length;
    _speech.audio = audio || null;
    _speech.analyser = _analyse(audio);
    _speech.data = _speech.analyser ? new Uint8Array(_speech.analyser.fftSize) : null;
    _speech.startedAt = performance.now();
    _speech.charIdx = -1;
    _speech.words = Array.prototype.slice.call(_text.querySelectorAll('.lt-w'));
    if (text) {
      _bubble.hidden = false;
      _bubble.classList.remove('lt-bubble--in'); void _bubble.offsetWidth; _bubble.classList.add('lt-bubble--in');
    }
    _root.classList.add('lt-talking');
    cancelAnimationFrame(_raf);
    _raf = requestAnimationFrame(_tick);
  }

  function _onBoundary(charIndex) {
    if (_speech && typeof charIndex === 'number') { _speech.charIdx = charIndex; _fakeUntil = 0; }
  }

  function _onEnd() {
    _talking = false;
    cancelAnimationFrame(_raf);
    _raf = 0;
    if (!_root) return;
    _root.classList.remove('lt-talking');
    _setMouth(0, true);
    if (_speech && _speech.words) _speech.words.forEach(function (w) { w.classList.add('lt-w--on'); });
    clearTimeout(_hideTimer);
    _hideTimer = setTimeout(function () {
      _speech = null;
      if (_bubble) { _bubble.hidden = true; _text.innerHTML = ''; }
    }, BUBBLE_LINGER_MS);
  }

  function _setMouth(m, force) {
    var now = performance.now();
    if (!force && (m === _mouth || now - _mouthSince < MOUTH_HOLD_MS)) return;
    _mouth = m;
    _mouthSince = now;
    _root.dataset.mouth = String(m);
  }

  function _tick(now) {
    var s = _speech;
    if (!s || !_root) return;
    // Hasta dónde va la frase (en caracteres desde el principio de la burbuja)
    var progress;
    var a = s.audio;
    if (a && a.duration && isFinite(a.duration)) progress = a.currentTime / a.duration;
    else if (s.charIdx >= 0) progress = (s.charIdx + 1) / Math.max(1, s.segLen);
    else progress = (now - s.startedAt) / Math.max(600, s.segLen * TTS_MS_PER_CHAR);
    var upTo = s.segStart + Math.min(1, Math.max(0, progress)) * s.segLen;
    for (var i = 0; i < s.words.length; i++) {
      var w = s.words[i];
      var end = Number(w.dataset.end);
      // La palabra se enciende cuando empieza a decirse (un poco antes de su final)
      if (end - Math.min(4, w.textContent.length) <= upTo) w.classList.add('lt-w--on');
    }

    // Boca: volumen real si hay analizador; si no, simulada (abre y cierra a ritmo de sílaba)
    if (s.analyser) {
      s.analyser.getByteTimeDomainData(s.data);
      var sum = 0;
      for (var j = 0; j < s.data.length; j++) { var v = (s.data[j] - 128) / 128; sum += v * v; }
      var rms = Math.sqrt(sum / s.data.length);
      _setMouth(rms < 0.035 ? 0 : rms < 0.11 ? 1 : 2);
    } else if (a && a.paused) {
      _setMouth(0);
    } else if (now > _fakeUntil) {
      var r = Math.random();
      _setMouth(r < 0.22 ? 0 : r < 0.6 ? 1 : 2, true);
      _fakeUntil = now + 85 + Math.random() * 90;
    }
    _raf = requestAnimationFrame(_tick);
  }

  /* ── Activar / desactivar ───────────────────────────── */
  function enable() {
    _build();
    _enabled = true;
    var ctx = _audioContext();
    if (ctx && ctx.state === 'suspended' && ctx.resume) ctx.resume().catch(function () {});
    if (!_spot) setSpot('lobby');
    _scheduleWave();
  }

  function disable() {
    _enabled = false;
    clearTimeout(_walkTimer); clearTimeout(_moodTimer); clearTimeout(_hideTimer); clearTimeout(_waveTimer);
    cancelAnimationFrame(_raf);
    _speech = null;
    _talking = false;
    _spot = null;
    delete document.body.dataset.teacherSpot;
    if (_root) {
      _root.classList.remove('lt-walking', 'lt-talking');
      _root.dataset.mood = '';
      _root.dataset.mouth = '0';
      _bubble.hidden = true;
      _text.innerHTML = '';
    }
  }

  var observer = { start: _onStart, boundary: _onBoundary, end: _onEnd };
  if (typeof LiveVoice !== 'undefined' && LiveVoice.setObserver) LiveVoice.setObserver(observer);

  return { enable: enable, disable: disable, setSpot: setSpot, react: react, voiceObserver: observer };
})();
