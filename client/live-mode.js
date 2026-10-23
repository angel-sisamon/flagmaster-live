/**
 * client/live-mode.js — Modo TikTok LIVE.
 *
 * Sincroniza la pantalla de juego con el servidor de flagmaster-live (server/) por Socket.io.
 * El servidor manda la pregunta y el reloj; el chat del directo vota con A/B/C/D; aquí solo se pinta.
 *
 * No forma parte de la app: server/src/live-page.js lo inyecta en el index.html del juego
 * (junto con live-screens.html, live-i18n.js y live-mode.css). Por eso el botón LIVE de la home y
 * #live-results se crean desde aquí en init(), sin tocar www/index.html.
 *
 * Flujo:  botón LIVE → sala de espera (#screen-live-lobby, "el juego empezará pronto",
 *         saludos a quien entra) → "Empezar" → cuenta atrás 3-2-1 → rondas en #screen-game.
 *         ✕ en partida vuelve a la sala de espera; "Salir" en la sala cierra el modo LIVE.
 *         En la sala se elige la duración (15 min … 3 h o N rondas, o sin límite); arriba se ve
 *         "Ronda x/total". Al acabar la última ronda (o con "Terminar" desde la pausa) llega
 *         game:over y se muestra #screen-live-final (podio, TOP y estadísticas).
 *
 * En partida:
 *   - la pregunta reutiliza renderQuestion() de ui.js con el sub-modo del reto diario que envía el servidor,
 *   - la cuenta atrás usa el anillo #timer-container,
 *   - #live-results (debajo de #options-grid) muestra la llamada a votar y el recuento,
 *   - al cerrar la votación se revela la opción correcta y, tras un instante, se pasa a la
 *     vista intermedia #screen-live-round (aciertos/fallos, acertantes, ranking LIVE de la
 *     sesión y fuegos artificiales de live-fireworks.js) hasta la siguiente pregunta,
 *   - los "Me gusta" del directo se pintan en el widget #live-likes (esquina superior izquierda),
 *   - los sonidos salen de AudioFX (respetan el ajuste de sonido del juego),
 *   - la voz en inglés (respuesta correcta, saludos, gracias por los likes) sale de live-voice.js.
 *
 * Clasificación mensual (server/src/standings.js):
 *   - month:update → TOP 3 del mes en la sala de espera, con la dirección de la web,
 *   - live:rank    → respuesta en pantalla a quien escribe "!yo" en el chat (puesto del mes),
 *   - live:optout  → confirmación a quien escribe "!optout" (deja de salir en la web).
 *
 * El cliente de Socket.io se descarga del propio servidor solo al activar el modo.
 */

/* Windows no tiene emojis de bandera: activa la fuente de banderas de css/live-mode.css */
if (/Windows/.test(navigator.userAgent)) document.documentElement.classList.add('flag-font-fallback');

var LiveMode = (function () {
  // La página la sirve el propio servidor LIVE: por defecto se conecta a quien la sirve
  var DEFAULT_SERVER = /^https?:$/.test(location.protocol) ? location.origin : 'http://localhost:3000';
  var SERVER_KEY = 'fm_live_server';   // localStorage: permite apuntar a la IP del PC desde el móvil
  var MAX_WINNERS_SHOWN = 12;
  var MAX_GREETINGS = 4;
  var GREETING_MS = 4500;
  var LOBBY_FLAGS = 18;
  var REVEAL_MS = 1600;        // tiempo viendo la opción correcta antes de pasar a la vista de resultados
  var RANKING_SHOWN = 10;
  var LOBBY_RANKING_SHOWN = 3;
  var MAX_LIKE_HEARTS = 14;
  var MEDALS = ['🥇', '🥈', '🥉'];
  var ROUNDS_KEY = 'fm_live_rounds';           // localStorage: última duración elegida en la sala
  var DURATION_MINUTES = [15, 30, 60, 120, 180, 0];   // botones de la sala (0 = sin límite)
  var DEFAULT_ROUNDS = 120;
  var MAX_ROUNDS = 2000;
  var FINAL_REST_SHOWN = 7;                    // pantalla final: podio + puestos 4..10
  // Banner junto al reloj invitando a descargar la app. Cambia de lado y de texto en cada pregunta
  // para que no sea siempre el mismo elemento fijo en pantalla.
  var PROMO_LINES = [
    ['Download on', 'Play Store!'],
    ['Play anytime', 'on Play Store'],
    ['FlagMaster', 'free on Google Play'],
    ['Train for the LIVE', 'get it on Play Store'],
    ['Get the app', 'Play Store ▸']
  ];
  var PROMO_DELAY_MS = 900;                    // aparece después de la bandera, no a la vez

  var _socket = null;
  var _active = false;
  var _state = 'off';         // 'off' | 'lobby' | 'countdown' | 'game' | 'final'
  var _connected = false;
  var _duration = 20;
  var _countdownTimer = null;
  var _revealTimer = null;
  var _onRoundScreen = false;  // dentro de 'game': true mientras se ve #screen-live-round
  var _promoRound = -1;        // ronda en la que se colocó el banner por última vez
  var _promoCount = 0;
  var _promoTimer = null;
  var _lastQuestion = null;
  var _ranking = [];          // TOP acumulado de la sesión, ya ordenado por el servidor
  var _month = null;          // { month, top: [{nickname, points}], players } del evento month:update
  var _siteUrl = '';          // web de clasificaciones (live:status.siteUrl)
  var _players = 0;
  var _likesTotal = 0;
  var _totalRounds = 0;       // rondas de la partida en curso (0 = sin límite)
  var _selectedRounds = _loadRounds();
  // Estado de la partida según el servidor (live:status): para "Reanudar" y la duración de cada ronda
  var _server = { paused: false, round: 0, totalRounds: 0, roundSecs: 30 };

  function _loadRounds() {
    try {
      var v = parseInt(localStorage.getItem(ROUNDS_KEY), 10);
      return isNaN(v) ? DEFAULT_ROUNDS : Math.max(0, Math.min(MAX_ROUNDS, v));
    } catch (e) { return DEFAULT_ROUNDS; }
  }

  function _saveRounds(n) {
    try { localStorage.setItem(ROUNDS_KEY, String(n)); } catch (e) {}
  }

  /* "5/120" con límite de rondas; "5" sin límite */
  function _roundNum(n, total) { return total ? n + '/' + total : String(n); }

  function _formatDuration(secs) {
    var m = Math.round(secs / 60), h = Math.floor(m / 60);
    m = m % 60;
    return h ? h + ' h' + (m ? ' ' + m + ' min' : '') : m + ' min';
  }

  function _serverUrl() {
    try { return localStorage.getItem(SERVER_KEY) || DEFAULT_SERVER; } catch (e) { return DEFAULT_SERVER; }
  }

  function _el(id) { return document.getElementById(id); }

  function _esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function _sfx(name) {
    if (typeof AudioFX !== 'undefined' && AudioFX[name]) AudioFX[name]();
  }

  /* Locutor TTS en inglés (live-voice.js); no-op si el script no está cargado */
  function _voice(method) {
    if (typeof LiveVoice !== 'undefined') LiveVoice[method].apply(null, Array.prototype.slice.call(arguments, 1));
  }

  function _randomFlag() {
    return COUNTRIES[Math.floor(Math.random() * COUNTRIES.length)].flag;
  }

  /* ── Carga perezosa del cliente Socket.io ─────────── */
  function _loadSocketIo(url, cb) {
    if (typeof io !== 'undefined') return cb(null);
    var s = document.createElement('script');
    s.src = url + '/socket.io/socket.io.js';
    s.onload = function () { cb(null); };
    s.onerror = function () { s.remove(); cb(new Error('No se pudo contactar con ' + url)); };
    document.head.appendChild(s);
  }

  /* ── Estado del botón LIVE y línea de estado de la sala ── */
  function _setStatus(state, text) {
    var btn = _el('btn-live-mode');
    if (btn) {
      btn.dataset.state = state;
      btn.title = text || '';
      btn.setAttribute('aria-pressed', _active ? 'true' : 'false');
    }
    var lobbyDot = _el('lobby-status-dot');
    if (lobbyDot) lobbyDot.dataset.state = state;
    if (text != null) {
      var line = _el('lobby-status');
      if (line) line.textContent = text;
    }
    var startBtn = _el('btn-lobby-start');
    if (startBtn) startBtn.disabled = !_connected;
  }

  /* ── Sala de espera ───────────────────────────────── */
  function _buildLobbyFlags() {
    var box = _el('lobby-flags');
    if (!box || box.childElementCount) return;
    for (var i = 0; i < LOBBY_FLAGS; i++) {
      var f = document.createElement('span');
      f.className = 'lobby-flag';
      f.textContent = _randomFlag();
      f.style.left = (Math.random() * 96) + '%';
      f.style.fontSize = (1.6 + Math.random() * 2.2) + 'rem';
      f.style.animationDuration = (10 + Math.random() * 10) + 's';
      f.style.animationDelay = (-Math.random() * 20) + 's';
      box.appendChild(f);
    }
  }

  function _leaveRoundScreen() {
    clearTimeout(_revealTimer);
    _onRoundScreen = false;
    if (typeof LiveFireworks !== 'undefined') LiveFireworks.stop();
  }

  function _showLobby() {
    clearInterval(_countdownTimer);
    _leaveRoundScreen();
    _state = 'lobby';
    _promoRound = -1;
    _voice('setPhase', 'idle');
    document.body.classList.remove('live-in-game');
    var cd = _el('lobby-countdown');
    if (cd) cd.hidden = true;
    var host = _el('lobby-host');
    if (host) host.hidden = false;
    var cont = _el('timer-container');
    if (cont) cont.style.display = 'none';
    _buildLobbyFlags();
    _renderLobbyRanking();
    _renderLobbyMonth();
    _renderLobbyControls();
    showScreen('live-lobby');
    _setStatus(_connected ? 'live' : 'connecting');
  }

  /* ── Duración de la partida y botones de la sala ──── */
  function _buildDurations() {
    var box = _el('lobby-durations');
    if (!box) return;
    box.dataset.roundSecs = _server.roundSecs;
    box.innerHTML = DURATION_MINUTES.map(function (min) {
      var rounds = min ? Math.round(min * 60 / _server.roundSecs) : 0;
      return '<button type="button" class="lobby-dur" role="radio" data-rounds="' + rounds + '">' +
        (min ? _formatDuration(min * 60) : '∞') + '</button>';
    }).join('');
  }

  function _renderLobbyControls() {
    var paused = _server.paused;
    var box = _el('lobby-durations');
    if (box && box.dataset.roundSecs !== String(_server.roundSecs)) _buildDurations();
    var setup = _el('lobby-setup');
    if (setup) setup.hidden = paused;
    var pausedLine = _el('lobby-paused');
    if (pausedLine) {
      pausedLine.hidden = !paused;
      pausedLine.textContent = t('lobby_paused', { n: _roundNum(_server.round, _server.totalRounds) });
    }
    var startBtn = _el('btn-lobby-start');
    if (startBtn) startBtn.textContent = paused ? t('lobby_resume') : t('lobby_start');
    ['btn-lobby-new', 'btn-lobby-end'].forEach(function (id) { var b = _el(id); if (b) b.hidden = !paused; });

    document.querySelectorAll('#lobby-durations .lobby-dur').forEach(function (b) {
      var on = Number(b.dataset.rounds) === _selectedRounds;
      b.classList.toggle('active', on);
      b.setAttribute('aria-checked', on ? 'true' : 'false');
    });
    var input = _el('lobby-rounds');
    if (input && document.activeElement !== input) input.value = _selectedRounds || '';
    var est = _el('lobby-estimate');
    if (est) {
      est.textContent = _selectedRounds
        ? t('lobby_rounds', { n: _selectedRounds }) + ' · ≈ ' + _formatDuration(_selectedRounds * _server.roundSecs)
        : t('lobby_unlimited');
    }
  }

  function _setSelectedRounds(n) {
    _selectedRounds = Math.max(0, Math.min(MAX_ROUNDS, n));
    _saveRounds(_selectedRounds);
    _renderLobbyControls();
  }

  /* Cuenta atrás 3-2-1 en la sala; al terminar pide al servidor que arranque las rondas.
   * mode 'new' descarta la partida en pausa; si no, se reanuda la pausada o empieza una nueva
   * con la duración elegida. */
  function _startCountdown(mode) {
    if (_state !== 'lobby' || !_connected) return;
    var opts = mode === 'new' ? { fresh: true, totalRounds: _selectedRounds }
      : _server.paused ? {} : { totalRounds: _selectedRounds };
    _state = 'countdown';
    var host = _el('lobby-host');
    var cd = _el('lobby-countdown');
    if (host) host.hidden = true;
    var steps = ['3', '2', '1', t('lobby_go')];
    var i = 0;
    function step() {
      if (_state !== 'countdown') return;
      if (i === steps.length) {
        clearInterval(_countdownTimer);
        _socket.emit('game:start', opts);
        return;
      }
      cd.hidden = false;
      cd.textContent = steps[i];
      cd.classList.remove('lobby-countdown--pop'); void cd.offsetWidth; cd.classList.add('lobby-countdown--pop');
      _sfx(i === steps.length - 1 ? 'newRecord' : 'timerWarning');
      i++;
    }
    step();
    _countdownTimer = setInterval(step, 1000);
  }

  /* ── Saludos a quien entra al directo ─────────────── */
  function _onJoin(j) {
    if (!_active) return;
    var count = _el('lobby-joined');
    if (count) { count.textContent = j.total; addTempClass(count, 'pop', 400); }
    _voice('greet', j.nickname);

    var box = _el('live-greetings');
    if (!box) return;
    var g = document.createElement('div');
    g.className = 'live-greet';
    g.innerHTML = '<span class="live-greet-flag">' + _randomFlag() + '</span>' +
      '<span class="live-greet-text">' +
      // Reemplazo con función: un nick con "$&" o "$'" no debe interpretarse como patrón de replace()
      t('live_hello').replace('{name}', function () { return '<b>' + _esc(j.nickname) + '</b>'; }) + '</span>';
    box.appendChild(g);
    while (box.childElementCount > MAX_GREETINGS) box.firstElementChild.remove();
    setTimeout(function () { g.classList.add('live-greet--out'); }, GREETING_MS - 400);
    setTimeout(function () { g.remove(); }, GREETING_MS);
    // En partida, sin sonido: no pisar los pitidos del reloj ni la fanfarria
    if (_state !== 'game') _sfx('buttonTap');
  }

  /* ── Temporizador (anillo existente de la pantalla de juego) ── */
  function _setTimer(remaining, total, phase) {
    var cont = _el('timer-container');
    var txt = _el('timer-text');
    var circle = _el('timer-circle');
    var urgent = phase === 'answer' && remaining <= 5;
    if (cont) { cont.style.display = 'flex'; cont.classList.toggle('live-urgent', urgent); }
    if (txt) txt.textContent = remaining;
    if (circle) {
      circle.style.strokeDasharray = _CIRC;
      circle.style.strokeDashoffset = _CIRC - (remaining / total) * _CIRC;
      circle.classList.toggle('urgent', urgent);
      circle.classList.toggle('live-results-phase', phase === 'results');
    }
  }

  /* ── Banner "Download on Play Store" junto al reloj ── */
  var _PLAY_ICON = '<svg class="live-promo-icon" viewBox="0 0 24 24" aria-hidden="true">' +
    '<path d="M4 2.5 14.2 12 4 21.5c-.4-.2-.6-.6-.6-1.1V3.6c0-.5.2-.9.6-1.1Z" fill="#00d4ff"/>' +
    '<path d="M17.6 8.8 14.2 12 4 2.5l.3-.1c.4 0 .7.1 1 .3l12.3 6.1Z" fill="#00f076"/>' +
    '<path d="M17.6 15.2 5.3 21.3c-.3.2-.6.3-1 .3l-.3-.1L14.2 12l3.4 3.2Z" fill="#ff3a44"/>' +
    '<path d="m17.6 8.8 3.1 1.6c.6.3.9.9.9 1.6s-.3 1.3-.9 1.6l-3.1 1.6-3.4-3.2 3.4-3.2Z" fill="#ffd040"/></svg>';

  function _placePromo(round) {
    var cont = _el('timer-container');
    if (!cont || round === _promoRound) return;   // reconexión: misma pregunta, mismo sitio
    _promoRound = round;
    var p = _el('live-promo');
    if (!p) {
      p = document.createElement('div');
      p.id = 'live-promo';
      p.className = 'live-promo';
      p.setAttribute('aria-hidden', 'true');
      cont.appendChild(p);
    }
    // Una de cada tres veces, en vez de la Play Store, la web de clasificaciones
    var lines = _siteUrl && _promoCount % 3 === 2 ? ['Your rank is on', _siteUrl]
      : PROMO_LINES[_promoCount % PROMO_LINES.length];
    var side = _promoCount % 2 ? 'right' : 'left';
    _promoCount++;
    p.classList.remove('live-promo--in');
    clearTimeout(_promoTimer);
    _promoTimer = setTimeout(function () {
      p.className = 'live-promo live-promo--' + side;
      p.innerHTML = _PLAY_ICON + '<span class="live-promo-text"><small>' + _esc(lines[0]) + '</small><b>' + _esc(lines[1]) + '</b></span>';
      void p.offsetWidth;
      p.classList.add('live-promo--in');
    }, PROMO_DELAY_MS);
  }

  /* ── Pregunta ─────────────────────────────────────── */
  function _onQuestion(q) {
    if (!_active) return;
    clearInterval(_countdownTimer);
    _duration = q.duration;
    _lastQuestion = q;
    if (_state !== 'game' || _onRoundScreen) {
      _leaveRoundScreen();
      _state = 'game';
      document.body.classList.add('live-in-game');
      showScreen('game');
    }
    // Mismos sub-modos que el reto diario: el servidor elige cuál toca en cada ronda
    renderQuestion({ correct: q.correct, options: q.options }, q.mode, true, function () {});
    // En LIVE responde el chat, no quien está delante de la pantalla
    document.querySelectorAll('#options-grid .option-btn').forEach(function (b) { b.disabled = true; });
    _sfx('screenTransition');

    // "Ronda x/total" arriba y barra de progreso de la partida (oculta si no hay límite de rondas)
    _totalRounds = q.totalRounds || 0;
    var isLast = !!_totalRounds && q.round >= _totalRounds;
    var hud = _el('hud-progress-text');
    if (hud) hud.textContent = '🔴 LIVE · ' + t('live_round', { n: _roundNum(q.round, _totalRounds) }) +
      (isLast ? ' · ' + t('live_last') : '');
    document.body.classList.toggle('live-limited', !!_totalRounds);
    var bar = _el('progress-bar');
    if (bar && _totalRounds) bar.style.width = (q.round / _totalRounds * 100) + '%';
    if (isLast && q.remaining >= q.duration) _voice('announceLastRound');
    _voice('setPhase', 'answer');
    _setTimer(q.remaining, q.duration, 'answer');
    _placePromo(q.round);
    _renderVoting(0);
  }

  function _renderVoting(total) {
    var box = _el('live-results');
    if (!box) return;
    box.hidden = false;
    box.className = 'live-results live-results--voting';
    box.innerHTML =
      '<p class="live-cta">' + t('live_cta') + ' <b>A</b> <b>B</b> <b>C</b> <b>D</b></p>' +
      '<p class="live-votes">🗳️ <span id="live-votes-total">' + total + '</span> ' + t('live_votes') + '</p>';
  }

  function _onVotes(v) {
    var n = _el('live-votes-total');
    if (n && n.textContent !== String(v.total)) { n.textContent = v.total; addTempClass(n, 'pop', 300); }
  }

  function _onTick(tk) {
    if (!_active || _state !== 'game') return;
    _setTimer(tk.remaining, tk.phase === 'answer' ? _duration : 10, tk.phase);
    if (tk.phase !== 'answer') { _setRoundCountdown(tk.remaining, 10); return; }
    if (tk.remaining <= 5) _sfx('timerWarning');      // pitido doble: se acaba el tiempo
    else if (tk.remaining <= 10) _sfx('tick');
  }

  /* ── Ranking acumulado de la sesión ───────────────── */
  /* offset: posición del primer elemento de list en el ranking (la pantalla final empieza en el 4º) */
  function _rankingHtml(list, limit, offset) {
    if (!list.length) return '<p class="lr-empty">' + t('lr_ranking_empty') + '</p>';
    return '<ol class="lr-rank">' + list.slice(0, limit).map(function (p, i) {
      var pos = i + (offset || 0);
      var cls = 'lr-row' + (pos < 3 ? ' lr-row--top lr-row--' + (pos + 1) : '') + (p.gained ? ' lr-row--up' : '');
      return '<li class="' + cls + '" style="animation-delay:' + (0.15 + i * 0.07) + 's">' +
        '<span class="lr-pos">' + (pos < 3 ? MEDALS[pos] : pos + 1) + '</span>' +
        '<span class="lr-name">' + _esc(p.nickname) + '</span>' +
        (p.gained ? '<span class="lr-plus">+' + (p.gained === true ? 1 : p.gained) + '</span>' : '') +
        '<span class="lr-pts">' + p.points + ' <small>' + t('lr_points') + '</small></span></li>';
    }).join('') + '</ol>';
  }

  function _renderLobbyRanking() {
    var box = _el('lobby-ranking');
    if (!box) return;
    box.hidden = !_ranking.length;
    if (_ranking.length) box.innerHTML = '<h2 class="lr-title">🏆 ' + t('lr_ranking') + '</h2>' + _rankingHtml(_ranking, LOBBY_RANKING_SHOWN);
  }

  function _onRanking(d) {
    if (!_active) return;
    _ranking = d.ranking || [];
    _players = d.players || 0;
    if (_state === 'lobby') _renderLobbyRanking();
  }

  /* ── Clasificación mensual ────────────────────────── */
  function _siteHtml() {
    return _siteUrl ? t('final_site') + ' <b>' + _esc(_siteUrl) + '</b>' : '';
  }

  function _renderLobbyMonth() {
    var box = _el('lobby-month');
    if (!box) return;
    box.hidden = !_month;
    if (!_month) return;
    var top = _month.top || [];
    box.innerHTML = '<h2 class="lr-title">📅 ' + t('lobby_month') + '</h2>' +
      (top.length ? _rankingHtml(top, LOBBY_RANKING_SHOWN) : '<p class="lr-empty">' + t('lobby_month_empty') + '</p>') +
      (_siteUrl ? '<p class="lobby-site">' + _siteHtml() + '</p>' : '');
  }

  function _onMonth(m) {
    _month = m;
    if (_active && _state === 'lobby') _renderLobbyMonth();
  }

  /* Globo junto a los saludos: respuesta a "!yo" o confirmación de "!optout" */
  function _toast(nickname, text) {
    var box = _el('live-greetings');
    if (!box) return;
    var g = document.createElement('div');
    g.className = 'live-greet live-greet--rank';
    g.innerHTML = '<span class="live-greet-flag">🏆</span><span class="live-greet-text"><b>' + _esc(nickname) + '</b> · ' + _esc(text) + '</span>';
    box.appendChild(g);
    while (box.childElementCount > MAX_GREETINGS) box.firstElementChild.remove();
    setTimeout(function () { g.classList.add('live-greet--out'); }, GREETING_MS + 1100);
    setTimeout(function () { g.remove(); }, GREETING_MS + 1500);
  }

  function _onRank(r) {
    if (!_active) return;
    _toast(r.nickname, r.position ? t('live_rank_me', { pos: r.position, pts: r.points }) : t('live_rank_none'));
  }

  function _onOptout(o) {
    if (_active) _toast(o.nickname, t('live_optout'));
  }

  /* ── Vista intermedia de resultados (#screen-live-round) ── */
  function _setRoundCountdown(remaining, total) {
    var sec = _el('lr-seconds');
    if (sec) sec.textContent = Math.max(0, remaining);
    var bar = _el('lr-progress');
    // remaining - 1: la transición de 1 s deja la barra a 0 justo cuando llega la siguiente pregunta
    if (bar) bar.style.width = (Math.max(0, remaining - 1) / total * 100) + '%';
  }

  function _renderRound(r) {
    var q = _lastQuestion && _lastQuestion.round === r.round ? _lastQuestion : null;
    _el('lr-round').textContent = t('lr_round', { n: _roundNum(r.round, r.totalRounds || _totalRounds) });

    _el('lr-answer').innerHTML =
      (q ? '<span class="lr-flag">' + q.correct.flag + '</span>' : '') +
      '<div class="lr-answer-text"><p class="lr-label">' + t('lr_answer') + '</p>' +
      '<p class="lr-answer-name"><b class="lr-letter">' + r.correctLetter + '</b>' + (q ? _esc(cn(q.correct)) : '') + '</p></div>';

    // Las barras salen a 0 y _showRoundScreen las anima hasta data-w
    _el('lr-stats').innerHTML =
      '<div class="lr-pcts">' +
        '<div class="lr-pct lr-pct--ok"><span class="lr-pct-num">' + r.correctPct + '%</span><span class="lr-label">✅ ' + t('live_correct') + '</span></div>' +
        '<div class="lr-pct lr-pct--ko"><span class="lr-pct-num">' + r.wrongPct + '%</span><span class="lr-label">❌ ' + t('live_wrong') + '</span></div>' +
      '</div>' +
      '<div class="lr-bar" role="img" aria-label="' + r.correctPct + '% / ' + r.wrongPct + '%">' +
        '<span class="lr-bar-ok" data-w="' + (r.totalVotes ? r.correctPct : 0) + '"></span>' +
        '<span class="lr-bar-ko" data-w="' + (r.totalVotes ? r.wrongPct : 0) + '"></span>' +
      '</div>' +
      '<p class="lr-summary">' + t('live_summary', { ok: r.correctCount, total: r.totalVotes, letter: r.correctLetter }) + '</p>';

    var winners = r.winners.slice(0, MAX_WINNERS_SHOWN);
    var extra = r.correctCount - winners.length;
    var chips = winners.map(function (w, i) {
      return '<li class="live-winner' + (i === 0 ? ' live-winner--first' : '') + '" style="animation-delay:' + (0.25 + i * 0.06) + 's">' +
        (i === 0 ? '⚡ ' : '') + _esc(w.nickname) +
        (w.points ? ' <span class="live-winner-pts">+' + w.points + '</span>' : '') + '</li>';
    }).join('');
    if (extra > 0) chips += '<li class="live-winner live-winner--more">+' + extra + '</li>';
    _el('lr-winners').innerHTML = winners.length ? '<ul class="live-winners">' + chips + '</ul>'
      : '<p class="lr-empty">' + t('live_no_winners') + '</p>';

    _el('lr-ranking').innerHTML = _rankingHtml(_ranking, RANKING_SHOWN) +
      (_players > RANKING_SHOWN ? '<p class="lr-players">' + t('lr_players', { n: _players }) + '</p>' : '');
    _setRoundCountdown(r.remaining, r.duration);
  }

  function _showRoundScreen(r) {
    if (!_active || _state !== 'game') return;
    _onRoundScreen = true;
    showScreen('live-round');
    requestAnimationFrame(function () {
      document.querySelectorAll('#lr-stats [data-w]').forEach(function (b) { b.style.width = b.dataset.w + '%'; });
    });
    // Más aciertos → más cohetes; si nadie acierta, solo alguno suelto para que la pantalla no se quede quieta
    if (typeof LiveFireworks !== 'undefined') {
      LiveFireworks.start(_el('live-fx'), r.correctCount ? 0.3 + 0.7 * r.correctPct / 100 : 0.05);
    }
  }

  /* ── Resultados: revelación breve en la pantalla de juego y luego la vista intermedia ── */
  function _onResults(r) {
    if (!_active || _state !== 'game') return;
    document.querySelectorAll('#options-grid .option-btn').forEach(function (btn, i) {
      btn.classList.add(i === r.correctIndex ? 'correct' : 'dimmed');
      var pct = r.totalVotes ? Math.round((r.counts[i] / r.totalVotes) * 100) : 0;
      var tag = document.createElement('span');
      tag.className = 'live-opt-pct';
      tag.textContent = pct + '%';
      btn.appendChild(tag);
    });
    _setTimer(r.remaining, r.duration, 'results');
    var box = _el('live-results');
    if (box) box.hidden = true;

    // Fanfarria si alguien acierta (y redoble extra si acierta la mayoría); "fallo" si nadie
    if (r.correctCount > 0) {
      _sfx('complete');
      if (r.correctPct >= 50) setTimeout(function () { _sfx('streak'); }, 550);
    } else {
      _sfx('wrong');
    }

    if (r.ranking) { _ranking = r.ranking; _players = r.players || 0; }

    // Locución en inglés de la respuesta (y a veces de quién va primero); no a quien se conecta a mitad
    _voice('setPhase', 'results');
    if (r.remaining >= r.duration) {
      var q = _lastQuestion && _lastQuestion.round === r.round ? _lastQuestion : null;
      _voice('announceAnswer', r.correctLetter, q && q.correct.names ? q.correct.names.en : '', r.correctCount === 0, r.correctPct);
      if (r.ranking) _voice('announceLeaders', r.ranking);
    }
    _renderRound(r);
    clearTimeout(_revealTimer);
    // Quien se conecta a mitad de la fase de resultados pasa directo a la vista intermedia
    _revealTimer = setTimeout(function () { _showRoundScreen(r); }, r.remaining < r.duration ? 0 : REVEAL_MS);
  }

  /* ── Widget de "Me gusta" (esquina superior izquierda) ── */
  function _formatCount(n) {
    if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
    if (n >= 1e4) return Math.round(n / 1e3) + 'K';
    if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
    return String(n);
  }

  function _setLikesTotal(n) {
    _likesTotal = n;
    var el = _el('live-likes-total');
    if (el) el.textContent = _formatCount(n);
    var w = _el('live-likes');
    if (w) w.classList.toggle('live-likes--on', n > 0);
  }

  function _onLike(l) {
    if (!_active) return;
    _setLikesTotal(Math.max(_likesTotal, l.total || 0));
    var badge = document.querySelector('#live-likes .live-likes-badge');
    if (badge) addTempClass(badge, 'live-likes--beat', 600);
    if (l.nickname) _voice('thankLike', l.nickname);
    var fx = _el('live-likes-fx');
    if (!fx) return;
    var hearts = Math.min(3, l.count || 1);
    for (var i = 0; i < hearts && fx.childElementCount < MAX_LIKE_HEARTS; i++) {
      var h = document.createElement('span');
      h.className = 'live-heart';
      h.textContent = ['❤️', '💖', '💗'][i];
      h.style.left = (0.6 + Math.random() * 1.8) + 'rem';
      h.style.animationDelay = (i * 0.14) + 's';
      fx.appendChild(h);
      setTimeout(h.remove.bind(h), 1900 + i * 140);
    }
    if (l.nickname) {
      var old = fx.querySelector('.live-like-name');
      if (old) old.remove();
      var n = document.createElement('span');
      n.className = 'live-like-name';
      n.innerHTML = '<b>' + _esc(l.nickname) + '</b> ❤️';
      fx.appendChild(n);
      setTimeout(function () { n.remove(); }, 2200);
    }
  }

  /* ── Pantalla final de la partida (#screen-live-final) ── */
  function _statTile(icon, value, label) {
    return '<div class="lf-stat"><span class="lf-stat-icon">' + icon + '</span><b class="lf-stat-num">' + value + '</b>' +
      '<span class="lr-label">' + label + '</span></div>';
  }

  function _renderFinal(d) {
    _el('lf-sub').textContent = t('final_sub', { n: d.rounds });

    var top = d.ranking.slice(0, 3);
    var podium = _el('lf-podium');
    if (!top.length) {
      podium.innerHTML = '<p class="lr-empty">' + t('final_nobody') + '</p>';
    } else {
      // Orden visual 2º · 1º · 3º; el 1º aparece el último para crear expectación
      podium.innerHTML = [1, 0, 2].filter(function (i) { return top[i]; }).map(function (i) {
        var p = top[i];
        return '<div class="lf-place lf-place--' + (i + 1) + '" style="animation-delay:' + [0.9, 0.3, 1.4][i] + 's">' +
          (i === 0 ? '<span class="lf-crown">👑</span>' : '') +
          '<span class="lf-medal">' + MEDALS[i] + '</span>' +
          '<span class="lf-name">' + _esc(p.nickname) + '</span>' +
          '<span class="lf-pts">' + p.points + ' <small>' + t('lr_points') + '</small></span>' +
          '<div class="lf-block">' + (i + 1) + '</div></div>';
      }).join('');
    }

    var rest = d.ranking.slice(3, 3 + FINAL_REST_SHOWN);
    var restBox = _el('lf-rest');
    restBox.hidden = !rest.length;
    restBox.innerHTML = '<h2 class="lr-title">🏆 ' + t('final_rest') + '</h2>' + _rankingHtml(rest, FINAL_REST_SHOWN, 3) +
      (d.players > 3 + FINAL_REST_SHOWN ? '<p class="lr-players">' + t('lr_players', { n: d.players }) + '</p>' : '');

    var h = d.hardest;
    _el('lf-stats').innerHTML =
      _statTile('🎯', d.rounds, t('final_rounds')) +
      _statTile('👥', d.participants, t('final_players')) +
      _statTile('💬', d.answers, t('final_answers')) +
      _statTile('✅', d.accuracy + '%', t('final_accuracy')) +
      (h ? '<div class="lf-stat lf-stat--wide"><span class="lf-hard-flag">' + h.flag + '</span>' +
        '<div><span class="lr-label">' + t('final_hardest') + '</span>' +
        '<b class="lf-hard-name">' + _esc(cn(h)) + ' · ' + h.pct + '%</b></div></div>' : '');

    var site = _el('lf-site');
    if (site) { site.hidden = !_siteUrl; site.innerHTML = _siteHtml(); }
  }

  function _onGameOver(d) {
    if (!_active) return;
    clearInterval(_countdownTimer);
    _leaveRoundScreen();
    _state = 'final';
    _voice('setPhase', 'idle');
    document.body.classList.remove('live-in-game');
    _ranking = d.ranking || [];
    _players = d.players || 0;
    _renderFinal(d);
    showScreen('live-final');
    _sfx('newRecord');
    if (typeof LiveFireworks !== 'undefined') LiveFireworks.start(_el('live-final-fx'), 1);
    var champ = _ranking[0];
    _voice('announceWinner', champ ? champ.nickname : '', champ ? champ.points : 0);
  }

  function _onStatus(s) {
    if (!_active) return;
    _server.paused = !!s.paused;
    _server.round = s.round || 0;
    _server.totalRounds = s.totalRounds || 0;
    if (s.answerSeconds && s.resultsSeconds) _server.roundSecs = s.answerSeconds + s.resultsSeconds;
    if (s.siteUrl != null && s.siteUrl !== _siteUrl) { _siteUrl = s.siteUrl; if (_state === 'lobby') _renderLobbyMonth(); }
    if (_state === 'lobby') _renderLobbyControls();
    var count = _el('lobby-joined');
    if (count && s.audience != null) count.textContent = s.audience;
    if (s.likes != null) _setLikesTotal(Math.max(_likesTotal, s.likes));
    var msg = s.tiktok === 'disabled' ? t('live_test_mode') : s.message;
    _setStatus(s.tiktok === 'connected' ? 'live' : 'warn', msg);
    // Si la partida se detiene desde otro sitio, volver a la sala de espera
    if (!s.running && _state === 'game') _showLobby();
  }

  /* ── Activar / pausar / desactivar ────────────────── */
  function start() {
    if (_active) return;
    _active = true;
    _connected = false;
    document.body.classList.add('live-mode');
    _voice('enable');
    _el('hud-progress-text').textContent = '🔴 LIVE';
    _showLobby();
    _setStatus('connecting', t('live_connecting'));

    var url = _serverUrl();
    _loadSocketIo(url, function (err) {
      if (!_active) return;
      if (err) { _setStatus('error', t('live_server_down', { url: url })); return; }
      _socket = io(url, { transports: ['websocket', 'polling'] });
      _socket.on('connect', function () { _connected = true; _setStatus('live'); });
      _socket.on('disconnect', function () { _connected = false; _setStatus('error', t('live_server_down', { url: url })); });
      _socket.on('connect_error', function () { _connected = false; _setStatus('error', t('live_server_down', { url: url })); });
      _socket.on('live:status', _onStatus);
      _socket.on('live:join', _onJoin);
      _socket.on('round:question', _onQuestion);
      _socket.on('round:votes', _onVotes);
      _socket.on('round:tick', _onTick);
      _socket.on('round:results', _onResults);
      _socket.on('ranking:update', _onRanking);
      _socket.on('live:like', _onLike);
      _socket.on('game:over', _onGameOver);
      _socket.on('month:update', _onMonth);
      _socket.on('live:rank', _onRank);
      _socket.on('live:optout', _onOptout);
    });
  }

  /* ✕ durante la partida: para las rondas pero sigue conectado y vuelve a la sala */
  function pause() {
    if (!_active) return;
    if (_socket) _socket.emit('game:stop');
    _showLobby();
  }

  function stop() {
    if (!_active) return;
    _active = false;
    _state = 'off';
    _connected = false;
    clearInterval(_countdownTimer);
    _leaveRoundScreen();
    _voice('disable');
    _ranking = []; _players = 0; _month = null;
    if (_socket) { _socket.emit('game:stop'); _socket.disconnect(); _socket = null; }
    document.body.classList.remove('live-mode', 'live-in-game', 'live-limited');
    var box = _el('live-results');
    if (box) { box.hidden = true; box.innerHTML = ''; }
    var greets = _el('live-greetings');
    if (greets) greets.innerHTML = '';
    var likesFx = _el('live-likes-fx');
    if (likesFx) likesFx.innerHTML = '';
    _setLikesTotal(0);
    var cont = _el('timer-container');
    if (cont) cont.style.display = 'none';
    _setStatus('off', '');
    showScreen('home');
  }

  /* El juego no sabe nada del modo LIVE: el botón de la home y la caja de votos se crean aquí */
  function _injectGameUi() {
    var actions = document.querySelector('.home-topbar-actions');
    if (actions && !_el('btn-live-mode')) {
      actions.insertAdjacentHTML('afterbegin', '<button class="live-toggle" id="btn-live-mode" data-state="off" aria-pressed="false" ' +
        'aria-label="Modo TikTok LIVE"><span class="live-toggle-dot"></span>LIVE</button>');
    }
    var grid = _el('options-grid');
    if (grid && !_el('live-results')) {
      grid.insertAdjacentHTML('afterend', '<div class="live-results" id="live-results" hidden aria-live="polite"></div>');
    }
    if (!actions || !grid) console.warn('[LiveMode] El index.html del juego ha cambiado: no se encuentra .home-topbar-actions o #options-grid');
  }

  function init() {
    _injectGameUi();
    var btn = _el('btn-live-mode');
    if (btn) btn.addEventListener('click', function () { _active ? stop() : start(); });
    var startBtn = _el('btn-lobby-start');
    if (startBtn) startBtn.addEventListener('click', function () { _startCountdown('auto'); });
    var newBtn = _el('btn-lobby-new');
    if (newBtn) newBtn.addEventListener('click', function () { _startCountdown('new'); });
    var endBtn = _el('btn-lobby-end');
    if (endBtn) endBtn.addEventListener('click', function () { if (_socket && _connected) _socket.emit('game:end'); });
    var exitBtn = _el('btn-lobby-exit');
    if (exitBtn) exitBtn.addEventListener('click', stop);
    var finalBtn = _el('btn-final-lobby');
    if (finalBtn) finalBtn.addEventListener('click', _showLobby);

    // Duración de la partida: botones rápidos (15 min … ∞) o número de rondas a mano
    var durations = _el('lobby-durations');
    if (durations) durations.addEventListener('click', function (e) {
      var b = e.target.closest('.lobby-dur');
      if (b) _setSelectedRounds(Number(b.dataset.rounds));
    });
    var roundsInput = _el('lobby-rounds');
    if (roundsInput) roundsInput.addEventListener('input', function () {
      var n = parseInt(roundsInput.value, 10);
      if (n > 0) _setSelectedRounds(n);
    });
    // En LIVE, ✕ vuelve a la sala sin pasar por el diálogo "abandonar partida" del juego normal
    document.addEventListener('click', function (e) {
      if (!_active || !e.target.closest('#btn-quit, .lr-quit')) return;
      e.stopPropagation();
      pause();
    }, true);
    // Atajo para quien emite: Enter en la sala empieza la partida sin tener que ir al botón
    document.addEventListener('keydown', function (e) {
      if (_active && _state === 'lobby' && e.key === 'Enter' && !e.target.closest('input, textarea')) _startCountdown('auto');
    });
  }

  document.addEventListener('DOMContentLoaded', init);

  return { start: start, pause: pause, stop: stop, isActive: function () { return _active; } };
})();
