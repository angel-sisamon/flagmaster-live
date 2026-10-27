/**
 * js/live-voice.js — Locutor por voz (Text-To-Speech) del modo TikTok LIVE, siempre en inglés.
 *
 * Habla con locuciones pregeneradas (client/voices/en/, servidas en live/voices/en/; índice en index.json,
 * se generan con npm run voices). Si falta el audio de una frase, la dice con window.speechSynthesis.
 * La salida de audio del navegador se puede enviar a VB-Audio Virtual Cable para que TikTok LIVE Studio
 * la reciba como micrófono.
 *
 *   LiveVoice.enable() / disable()        live-mode.js lo activa al entrar en LIVE y lo apaga al salir
 *   LiveVoice.announceAnswer(letter, name, nobody, pct, code) resultados: dice la respuesta (code = ISO del país)
 *   LiveVoice.announceLastRound()          aviso de última pregunta de la partida
 *   LiveVoice.announceWinner(nick, points) pantalla final: anuncia al campeón (o da las gracias si nadie puntuó)
 *   LiveVoice.announceLeaders(ranking)     resultados: a veces dice quién va primero (siempre si cambia el líder)
 *   LiveVoice.setPhase(phase)              'answer' | 'results' | 'idle': los comentarios sueltos solo van al votar
 *   LiveVoice.greet(nickname)              alguien entra al directo (se saluda solo de vez en cuando; si entra
 *                                          mucha gente, a veces un saludo general sin nombre)
 *   LiveVoice.thankLike(nickname)          "Me gusta" (aún menos frecuente que los saludos)
 *
 * Además, cada 45–110 s (al azar) suelta un comentario genérico durante la votación, si la voz está callada.
 * Las frases no se repiten hasta que ha salido buena parte de su lista.
 *
 * Cola con prioridad y anti-solapamiento:
 *   - nunca se lanza una locución mientras otra suena; entre una y otra hay una pausa natural aleatoria,
 *   - la respuesta correcta (prioridad alta) pasa delante de los saludos y los descarta si se acumulan,
 *   - cada mensaje caduca: un saludo que no ha podido decirse a tiempo se tira en lugar de llegar tarde,
 *   - un vigilante desbloquea la cola si el motor de voz no emite 'end' (bug conocido de Chrome).
 *
 * Las locuciones grabadas no llevan nombres de jugadores: saludos, likes y ganador van sin nick y el ranking
 * solo se comenta cuando cambia el líder. Sin audio ni speechSynthesis, todo es no-op y el juego sigue igual.
 */
var LiveVoice = (function () {
  var TTS = typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
  var SUPPORTED = TTS || typeof Audio !== 'undefined';
  var CLIPS_BASE = 'live/voices/en/';

  var GAP_MIN_MS = 700;               // pausa natural entre locuciones
  var GAP_MAX_MS = 1400;
  var GREET_EVERY = 5;                // de media se saluda a 1 de cada 5 personas que entran...
  var GREET_MIN_INTERVAL_MS = 22000;  // ...y nunca más de un saludo cada 22 s
  var LIKE_MIN_INTERVAL_MS = 60000;   // agradecer likes como mucho una vez por minuto
  var LIKE_CHANCE = 0.35;
  var MAX_LOW_QUEUED = 1;             // saludos/likes en espera: si hay más, el nuevo se descarta
  var GREET_TTL_MS = 15000;
  var ANSWER_DELAY_MS = 900;          // deja sonar primero la fanfarria de resultados
  var ANSWER_TTL_MS = 8000;           // la fase de resultados dura 10 s
  var WINNER_TTL_MS = 20000;          // la pantalla final no tiene prisa
  var GROUP_JOINS = 3;                // con 3+ entradas en la última ventana, a veces saludo general
  var GROUP_WINDOW_MS = 30000;
  var GROUP_CHANCE = 0.3;
  var AMBIENT_MIN_MS = 45000;         // comentario suelto cada 45–110 s (al azar)...
  var AMBIENT_MAX_MS = 110000;
  var AMBIENT_QUIET_MS = 12000;       // ...solo si la voz lleva un rato callada
  var AMBIENT_TTL_MS = 6000;
  var ANSWER_TAIL_CHANCE = 0.3;
  var LEADER_CHANCE = 0.3;            // 30 % de las rondas se dice quién va primero...
  var LEADER_MIN_INTERVAL_MS = 70000; // ...y como mucho una vez cada 70 s
  var LEADER_TTL_MS = 6500;           // tiene que caber en los 10 s de resultados
  var CLIP_GAP_MS = 250;              // entre la respuesta y su coletilla

  // Voces preferidas: las "Natural"/"Online" de Edge y las de Google suenan mucho menos robóticas
  var PREFERRED_VOICES = [/natural/i, /online/i, /google us english/i, /google uk english/i,
    /aria|jenny|guy|davis|emma|brian|andrew|ava/i, /samantha|alex|daniel|karen|moira/i];

  var ANSWER_PHRASES = [
    'The correct answer was option {L}, {N}!',
    'Ah, it was {N} this time! Option {L}.',
    "Let's see... Yes, option {L} was correct! {N}.",
    'And the answer is... {L}! {N}!',
    'It was {N}! Option {L}, well done if you got it.',
    'Option {L}, {N}! Did you get it right?',
    'There it is: {N}, option {L}.',
    "Nice! The right answer was {L}, that's {N}.",
    'Okay, that was {N}. Option {L}!',
    "{N}! Option {L}. Who called it?",
    'Yep, {L} it is. {N}!',
    "That flag belongs to {N}. Option {L}!",
    "Drumroll... it's {N}! Letter {L}.",
    'The answer: {L}, {N}. Points for everyone who got it!',
    'Alright, {N} was the one. Option {L}.',
    "If you said {L}, you nailed it! It's {N}.",
    'Boom, {N}! Option {L}.',
    "And it's... {N}! That was option {L}."
  ];
  var ANSWER_PHRASES_NOBODY = [
    'Ooh, tough one! It was option {L}, {N}.',
    'Nobody got that one! The answer was {L}, {N}.',
    'Tricky! It was {N}, option {L}.',
    'Wow, that one got everybody! It was {N}, option {L}.',
    "Nobody? Really? It was {N}! Option {L}.",
    "Okay, that one was hard. The answer was {L}, {N}.",
    "Oof! It was {N}. Option {L}. Next one's yours!",
    "Not a single correct answer! It was {L}, {N}."
  ];
  // Coletillas opcionales según cuánta gente acertó (se añaden de vez en cuando)
  var ANSWER_TAIL_EASY = [
    'Most of you got that one!', 'Too easy for you, huh?', 'Great job, chat!', 'Lots of points this round!'
  ];
  var ANSWER_TAIL_HARD = [
    'Only a few of you got it.', 'That one was sneaky.', 'Respect if you got that right!', 'Not many got that one!'
  ];
  var GREET_PHRASES = [
    'Welcome to the stream, {U}!',
    'Hey {U}, glad to have you here. Ready for the next flag?',
    "What's up {U}, let's see if you can guess this one.",
    'Hi {U}! Type A, B, C or D in the chat to play.',
    'Oh, {U} just joined! Welcome!',
    "Hello {U}! Grab a seat, we're guessing flags.",
    'Welcome {U}! Answer fast, the quickest ones get the most points.',
    'Hey {U}! Jump in, the next flag is coming.',
    '{U}, welcome! Think you can make the top ten?',
    'Good to see you, {U}!',
    "Hi {U}! Just type the letter in the chat, that's it.",
    'Welcome in, {U}! How good are you with flags?',
    "{U} is here! Let's go!",
    'Hey there {U}, make yourself at home.',
    "Oh hi {U}! You're just in time.",
    "Welcome {U}! Let's see what you've got."
  ];
  // Saludo general cuando entra mucha gente a la vez (en vez de nombrar a una sola persona)
  var GREET_GROUP_PHRASES = [
    "Welcome to everyone who's joining right now!",
    'Hey everyone, welcome! Lots of new people coming in.',
    'Hi to all the new faces! Type A, B, C or D to play.',
    'Welcome, welcome, everybody! Grab a seat.',
    "If you just joined, hi! It's a flag quiz, answer in the chat.",
    'So many people joining! Welcome all of you.'
  ];
  // Comentarios sueltos en momentos aleatorios mientras se vota
  var AMBIENT_PHRASES = [
    "Welcome to everyone who's just arriving!",
    'If you just joined: type A, B, C or D in the chat to answer.',
    "Hi everyone! Hope you're having fun.",
    'The faster you answer, the more points you get. Can you make the top ten?',
    'First correct answer gets ten points! Be quick.',
    "What do you think, chat? Write your answer!",
    "Hmm, I like this flag.",
    "Don't be shy, just type your guess!",
    'Thanks for hanging out with us today.',
    "This one shouldn't be too hard... I think.",
    "Come on, let's see those answers in the chat!",
    "Hello to everyone watching! Let's keep it going.",
    "If you're enjoying the game, a follow helps a lot!",
    'Tap the screen if you like the game!',
    "Who's going to take first place today?",
    "I'm loving the energy in the chat today."
  ];
  // Quién va primero, dicho de vez en cuando durante los resultados
  var LEADER_PHRASES = [
    '{A} is leading right now with {P}!',
    '{A} is still on top with {P}.',
    'Right now {A} is number one!',
    'Keep an eye on {A}, first place with {P}!',
    "{A} is in first place. Who's going to catch them?"
  ];
  var LEADER_TOP3_PHRASES = [
    'The top three right now: {A}, {B} and {C}!',
    '{A} is leading, then {B} and {C}.',
    'Quick look at the ranking: {A} first, {B} second, {C} third!',
    "{A}, {B} and {C} are on the podium so far. Can anyone catch them?"
  ];
  var LEADER_TOP2_PHRASES = [
    '{A} is first, but {B} is right behind!',
    "It's close between {A} and {B}!",
    '{A} on top, {B} chasing!'
  ];
  var NEW_LEADER_PHRASES = [
    'New leader! {A} takes first place!',
    "Whoa, {A} just jumped to number one!",
    '{A} is the new leader with {P}!',
    'Change at the top! {A} is now first.'
  ];
  var LAST_ROUND_PHRASES = [
    'Last flag of the game! Make it count.',
    'Here comes the final question!',
    'This is the last one, good luck everyone!',
    "Final flag! Let's see who wins this.",
    "Okay everyone, last question. Don't miss it!",
    'One more and we are done! Last flag!'
  ];
  var WINNER_PHRASES = [
    "And that's the game! The champion is {U} with {P}! Congratulations!",
    'Game over! Huge congrats to {U}, our winner with {P}!',
    'What a game! {U} takes the crown with {P}!',
    'We have a winner! {U}, with {P}. Amazing!',
    "That's it! {U} wins with {P}. Well played!",
    'Congratulations {U}! First place with {P}!'
  ];
  var GAME_OVER_PHRASES = [
    "And that's the game! Thanks so much for playing!",
    'Game over! Thank you all for playing, see you next time!',
    "That's a wrap! Thanks for hanging out, everyone.",
    'And we are done! Thank you so much for playing with us.',
    'Game finished! Thanks everybody, that was fun.'
  ];
  var LIKE_PHRASES = [
    'Thanks for the likes, {U}!',
    'Ooh, love the likes! Thank you {U}.',
    '{U}, thanks for the support!',
    'I see those likes, {U}! Thank you!',
    'Thank you {U}, keep them coming!',
    'Wow, {U}, thanks for all the likes!',
    'Appreciate it, {U}!',
    'Thanks for tapping, {U}!'
  ];

  var _enabled = false;
  var _voice = null;
  var _queue = [];            // { speech: { clips, text }, priority: 'high'|'low', notBefore, expiresAt }
  var _clipPools = null;      // 'grupo' o 'grupo/ISO' -> [ruta del audio], de index.json
  var _audio = null;          // locución grabada sonando
  var _speaking = false;
  var _nextAllowedAt = 0;     // fin de la pausa tras la última locución
  var _pumpTimer = null;
  var _watchdog = null;
  var _lastGreetAt = 0;
  var _lastLikeAt = 0;
  var _recentPhrases = {};    // pool -> últimos índices usados (no repetir frase hasta que pasen varias)
  var _joinTimes = [];        // marcas de tiempo de entradas recientes (para el saludo general)
  var _phase = 'idle';        // 'answer' | 'results' | 'idle', lo marca live-mode.js
  var _ambientTimer = null;
  var _lastSpokeAt = 0;       // fin de la última locución
  var _lastLeaderAt = 0;
  var _lastLeader = null;     // uniqueId/nick del primero la última vez que se miró

  function _rand(a, b) { return a + Math.random() * (b - a); }

  /* Frase al azar evitando las últimas usadas de ese pool (≈ la mitad del pool) */
  function _pick(pool, key) {
    var recent = _recentPhrases[key] || (_recentPhrases[key] = []);
    var memory = Math.min(recent.length, Math.floor(pool.length / 2));
    var avoid = recent.slice(recent.length - memory);
    var i;
    do { i = Math.floor(Math.random() * pool.length); } while (avoid.indexOf(i) >= 0);
    recent.push(i);
    if (recent.length > pool.length) recent.shift();
    return pool[i];
  }

  function _fill(text, map) {
    return text.replace(/\{(\w)\}/g, function (m, k) { return k in map ? map[k] : m; });
  }

  function _pointsText(p) { return p + (p === 1 ? ' point' : ' points'); }

  /* Nick legible en voz alta: sin emojis ni símbolos, "_" y "." como espacios, sin cola de números */
  function _speakableName(nick) {
    var s = String(nick || '')
      .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, '')
      .replace(/[_.\-]+/g, ' ')
      .replace(/[^\p{L}\p{N} ']/gu, '')
      .replace(/\s*\d{3,}$/, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (s.length > 22) s = s.slice(0, 22).replace(/\s+\S*$/, '') || s.slice(0, 22);
    return s;
  }

  /* ── Locuciones grabadas ──────────────────────────── */
  function _loadClips() {
    if (_clipPools || typeof fetch !== 'function') return;
    fetch(CLIPS_BASE + 'index.json').then(function (r) { return r.ok ? r.json() : null; }).then(function (index) {
      if (!index || !index.clips) return;
      var pools = {};
      Object.keys(index.clips).forEach(function (id) {
        var c = index.clips[id];
        var key = c.country ? c.group + '/' + c.country : c.group;
        (pools[key] || (pools[key] = [])).push(CLIPS_BASE + c.file);
      });
      _clipPools = pools;
    }).catch(function () { /* sin índice: se habla con speechSynthesis */ });
  }

  /* Audio al azar de un grupo ('ambient', 'answer/JP'...), o null si no hay */
  function _clip(key) {
    var pool = _clipPools && _clipPools[key];
    return pool && pool.length ? _pick(pool, 'clip:' + key) : null;
  }

  /* ── Elección de voz inglesa ──────────────────────── */
  function _chooseVoice() {
    if (!TTS) return;
    var voices = window.speechSynthesis.getVoices().filter(function (v) { return /^en([-_]|$)/i.test(v.lang); });
    if (!voices.length) return;
    var best = null, bestScore = -1;
    voices.forEach(function (v) {
      var score = 0;
      PREFERRED_VOICES.forEach(function (re, i) { if (re.test(v.name)) score += (PREFERRED_VOICES.length - i) * 10; });
      if (/en[-_]US/i.test(v.lang)) score += 3;
      else if (/en[-_]GB/i.test(v.lang)) score += 2;
      if (!v.localService) score += 1;   // las voces en red suelen ser las neuronales
      if (score > bestScore) { best = v; bestScore = score; }
    });
    _voice = best;
  }

  /* ── Cola ─────────────────────────────────────────── */
  /* speech: texto para speechSynthesis, o { clips: [rutas], text } (si los audios fallan se dice el texto) */
  function _enqueue(speech, priority, delayMs, ttlMs) {
    if (typeof speech === 'string') speech = { clips: [], text: speech };
    if (!_enabled || !speech || !(speech.clips.length || speech.text)) return false;
    var now = Date.now();
    if (priority === 'high') {
      // La respuesta manda: fuera los saludos pendientes para que se oiga dentro de los 10 s
      _queue = _queue.filter(function (m) { return m.priority === 'high'; });
      _queue.push({ speech: speech, priority: priority, notBefore: now + (delayMs || 0), expiresAt: now + ttlMs });
    } else {
      var low = _queue.filter(function (m) { return m.priority === 'low'; }).length;
      if (low >= MAX_LOW_QUEUED) return false;
      _queue.push({ speech: speech, priority: priority, notBefore: now + (delayMs || 0), expiresAt: now + ttlMs });
    }
    _pump();
    return true;
  }

  function _schedule(ms) {
    clearTimeout(_pumpTimer);
    _pumpTimer = setTimeout(_pump, Math.max(0, ms));
  }

  function _pump() {
    if (!_enabled || _speaking) return;
    var now = Date.now();
    _queue = _queue.filter(function (m) { return m.expiresAt > now; });
    if (!_queue.length) return;
    if (now < _nextAllowedAt) return _schedule(_nextAllowedAt - now);

    // Primero la prioridad alta; dentro de cada prioridad, por orden de llegada
    var idx = -1;
    for (var i = 0; i < _queue.length; i++) {
      if (_queue[i].priority === 'high') { idx = i; break; }
    }
    if (idx < 0) idx = 0;
    var msg = _queue[idx];
    if (now < msg.notBefore) return _schedule(msg.notBefore - now);
    _queue.splice(idx, 1);
    _speak(msg.speech);
  }

  function _finish() {
    if (!_speaking) return;
    _speaking = false;
    clearTimeout(_watchdog);
    _lastSpokeAt = Date.now();
    _nextAllowedAt = Date.now() + _rand(GAP_MIN_MS, GAP_MAX_MS);
    _schedule(_nextAllowedAt - Date.now());
  }

  function _speak(speech) {
    _speaking = true;
    if (speech.clips.length) return _playClips(speech.clips.slice(), speech.text);
    _speakText(speech.text);
  }

  /* Reproduce los audios uno tras otro; si uno no se puede reproducir, se dice el texto con la voz del navegador */
  function _playClips(list, fallbackText) {
    var a = new Audio(list.shift());
    _audio = a;
    var done = false;
    function next(failed) {
      if (done || _audio !== a) return;
      done = true;
      clearTimeout(_watchdog);
      _audio = null;
      if (failed && fallbackText && TTS) return _speakText(fallbackText);
      if (!failed && list.length) return setTimeout(function () { if (_speaking) _playClips(list); }, CLIP_GAP_MS);
      _finish();
    }
    a.onended = function () { next(false); };
    a.onerror = function () { next(true); };
    clearTimeout(_watchdog);
    _watchdog = setTimeout(function () { a.pause(); next(false); }, 20000);
    var p = a.play();
    if (p && p.catch) p.catch(function () { next(true); });
  }

  function _speakText(text) {
    if (!TTS || !text) return _finish();
    if (!_voice) _chooseVoice();
    var u = new SpeechSynthesisUtterance(text);
    u.lang = (_voice && _voice.lang) || 'en-US';
    if (_voice) u.voice = _voice;
    // Pequeñas variaciones de ritmo y tono para que no suene siempre idéntico
    u.rate = _rand(0.96, 1.06);
    u.pitch = _rand(0.95, 1.08);
    u.volume = 1;
    u.onend = _finish;
    u.onerror = _finish;
    // Vigilante: ~80 ms por carácter + margen; si 'end' no llega, la cola sigue igualmente
    clearTimeout(_watchdog);
    _watchdog = setTimeout(function () { window.speechSynthesis.cancel(); _finish(); }, 2500 + text.length * 80);
    window.speechSynthesis.speak(u);
  }

  /* ── API pública ──────────────────────────────────── */
  function enable() {
    if (!SUPPORTED || _enabled) return;
    _enabled = true;
    _loadClips();
    if (TTS) {
      _chooseVoice();
      // Chrome carga las voces de forma asíncrona
      window.speechSynthesis.addEventListener('voiceschanged', _chooseVoice);
    }
    _scheduleAmbient(_rand(AMBIENT_MIN_MS, AMBIENT_MAX_MS));
  }

  function disable() {
    if (!SUPPORTED) return;
    _enabled = false;
    _queue = [];
    clearTimeout(_pumpTimer);
    clearTimeout(_watchdog);
    clearTimeout(_ambientTimer);
    _speaking = false;
    _phase = 'idle';
    _lastLeader = null;
    _joinTimes = [];
    if (_audio) { _audio.pause(); _audio = null; }
    if (TTS) {
      window.speechSynthesis.cancel();
      window.speechSynthesis.removeEventListener('voiceschanged', _chooseVoice);
    }
  }

  /* live-mode.js indica en qué fase está la ronda: los comentarios sueltos solo van durante la votación */
  function setPhase(phase) {
    _phase = phase;
    if (phase === 'idle') _lastLeader = null;
  }

  /* ── Comentarios sueltos en momentos aleatorios ───── */
  function _scheduleAmbient(ms) {
    clearTimeout(_ambientTimer);
    _ambientTimer = setTimeout(_ambientTick, ms);
  }

  function _ambientTick() {
    if (!_enabled) return;
    var now = Date.now();
    // Si no es buen momento (no se vota, la voz está ocupada o acaba de hablar), se reintenta en unos segundos
    if (_phase !== 'answer' || _speaking || _queue.length || now - _lastSpokeAt < AMBIENT_QUIET_MS) {
      return _scheduleAmbient(_rand(4000, 9000));
    }
    var recentJoins = _joinTimes.filter(function (t) { return now - t < GROUP_WINDOW_MS; }).length;
    var group = recentJoins >= GROUP_JOINS && Math.random() < 0.5;
    var clip = _clip(group ? 'greet_group' : 'ambient');
    _enqueue(clip ? { clips: [clip] } : _pick(group ? GREET_GROUP_PHRASES : AMBIENT_PHRASES, group ? 'group' : 'ambient'),
      'low', _rand(1500, 4000), AMBIENT_TTL_MS);
    _scheduleAmbient(_rand(AMBIENT_MIN_MS, AMBIENT_MAX_MS));
  }

  function announceAnswer(letter, countryName, nobodyGotIt, correctPct, countryCode) {
    // De vez en cuando, una coletilla según lo fácil o difícil que fue
    var tail = !nobodyGotIt && typeof correctPct === 'number' && Math.random() < ANSWER_TAIL_CHANCE
      ? (correctPct >= 70 ? 'easy' : correctPct <= 25 ? 'hard' : null) : null;
    var clip = countryCode && _clip((nobodyGotIt ? 'nobody/' : 'answer/') + String(countryCode).toUpperCase());
    if (clip) {
      var tailClip = tail && _clip('tail_' + tail);
      _enqueue({ clips: tailClip ? [clip, tailClip] : [clip] }, 'high', ANSWER_DELAY_MS, ANSWER_TTL_MS);
      return;
    }
    var pool = nobodyGotIt ? ANSWER_PHRASES_NOBODY : ANSWER_PHRASES;
    var text = _pick(pool, nobodyGotIt ? 'nobody' : 'answer').replace(/\{L\}/g, letter);
    text = countryName ? text.replace(/\{N\}/g, countryName)
                       : text.replace(/,?\s*\{N\}([.!]?)/g, '$1').replace(/\s+([.!])/g, '$1');
    if (tail) text += ' ' + _pick(tail === 'easy' ? ANSWER_TAIL_EASY : ANSWER_TAIL_HARD, tail);
    _enqueue(text, 'high', ANSWER_DELAY_MS, ANSWER_TTL_MS);
  }

  /* Fase de resultados: a veces se nombra a quien va primero (siempre si hay nuevo líder) */
  function announceLeaders(ranking) {
    var list = (ranking || []).filter(function (p) { return p.points > 0; });
    if (!list.length) return;
    var leader = list[0].nickname;
    var changed = _lastLeader !== null && leader !== _lastLeader;
    _lastLeader = leader;
    var now = Date.now();
    if (now - _lastLeaderAt < LEADER_MIN_INTERVAL_MS) return;
    if (!changed && Math.random() >= LEADER_CHANCE) return;
    // Con locuciones grabadas no se dicen nombres: solo se celebra el cambio de líder
    if (_clipPools) {
      var lc = changed && _clip('new_leader');
      if (lc && _enqueue({ clips: [lc] }, 'low', ANSWER_DELAY_MS, LEADER_TTL_MS)) _lastLeaderAt = now;
      return;
    }

    var names = list.slice(0, 3).map(function (p) { return _speakableName(p.nickname); });
    if (!names[0]) return;
    var pool, key;
    if (changed && Math.random() < 0.7) { pool = NEW_LEADER_PHRASES; key = 'newLeader'; }
    else if (names.length >= 3 && names[1] && names[2] && Math.random() < 0.5) { pool = LEADER_TOP3_PHRASES; key = 'top3'; }
    else if (names.length >= 2 && names[1] && list[0].points - list[1].points <= 1 && Math.random() < 0.6) { pool = LEADER_TOP2_PHRASES; key = 'top2'; }
    else { pool = LEADER_PHRASES; key = 'leader'; }
    var text = _fill(_pick(pool, key), { A: names[0], B: names[1] || '', C: names[2] || '', P: _pointsText(list[0].points) });
    if (_enqueue(text, 'low', ANSWER_DELAY_MS, LEADER_TTL_MS)) _lastLeaderAt = now;
  }

  function announceLastRound() {
    var clip = _clip('last_round');
    _enqueue(clip ? { clips: [clip] } : _pick(LAST_ROUND_PHRASES, 'last'), 'high', 600, ANSWER_TTL_MS);
  }

  function announceWinner(nickname, points) {
    var name = _speakableName(nickname);
    var clip = _clip(name ? 'winner' : 'game_over');
    if (clip) return _enqueue({ clips: [clip] }, 'high', ANSWER_DELAY_MS, WINNER_TTL_MS);
    var text = name
      ? _fill(_pick(WINNER_PHRASES, 'winner'), { U: name, P: _pointsText(points) })
      : _pick(GAME_OVER_PHRASES, 'over');
    _enqueue(text, 'high', ANSWER_DELAY_MS, WINNER_TTL_MS);
  }

  function greet(nickname) {
    var now = Date.now();
    _joinTimes.push(now);
    _joinTimes = _joinTimes.filter(function (t) { return now - t < GROUP_WINDOW_MS; });
    if (now - _lastGreetAt < GREET_MIN_INTERVAL_MS) return;
    // Mucha gente entrando a la vez: a veces un saludo general en lugar de un nombre
    if (_joinTimes.length >= GROUP_JOINS && Math.random() < GROUP_CHANCE) {
      var gc = _clip('greet_group');
      if (_enqueue(gc ? { clips: [gc] } : _pick(GREET_GROUP_PHRASES, 'group'), 'low', 0, GREET_TTL_MS)) { _lastGreetAt = now; _joinTimes = []; }
      return;
    }
    if (Math.random() >= 1 / GREET_EVERY) return;
    var clip = _clip('greet');
    if (clip) { if (_enqueue({ clips: [clip] }, 'low', 0, GREET_TTL_MS)) _lastGreetAt = now; return; }
    var name = _speakableName(nickname);
    if (!name) return;
    if (_enqueue(_pick(GREET_PHRASES, 'greet').replace(/\{U\}/g, name), 'low', 0, GREET_TTL_MS)) _lastGreetAt = now;
  }

  function thankLike(nickname) {
    var now = Date.now();
    if (now - _lastLikeAt < LIKE_MIN_INTERVAL_MS || Math.random() >= LIKE_CHANCE) return;
    var clip = _clip('like');
    if (clip) { if (_enqueue({ clips: [clip] }, 'low', 0, GREET_TTL_MS)) _lastLikeAt = now; return; }
    var name = _speakableName(nickname);
    if (!name) return;
    if (_enqueue(_pick(LIKE_PHRASES, 'like').replace(/\{U\}/g, name), 'low', 0, GREET_TTL_MS)) _lastLikeAt = now;
  }

  return {
    enable: enable,
    disable: disable,
    announceAnswer: announceAnswer,
    announceLastRound: announceLastRound,
    announceWinner: announceWinner,
    announceLeaders: announceLeaders,
    setPhase: setPhase,
    greet: greet,
    thankLike: thankLike,
    isSupported: function () { return SUPPORTED; },
    // Para pruebas desde la consola: LiveVoice._say('Hello there') o LiveVoice._sayClip('answer/JP')
    _say: function (text) { _enqueue(text, 'high', 0, ANSWER_TTL_MS); },
    _sayClip: function (key) { var c = _clip(key); return !!c && _enqueue({ clips: [c] }, 'high', 0, ANSWER_TTL_MS); }
  };
})();
