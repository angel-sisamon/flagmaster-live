/**
 * server/index.js — FlagMaster TikTok LIVE
 *
 *   1. Se conecta al chat de un directo de TikTok (src/tiktok.js).
 *   2. Ejecuta las partidas: el chat vota con A/B/C/D (src/game.js).
 *   3. Graba cada directo en data/sessions/ (src/recorder.js) y, al terminar, lo sube al repo
 *      para que GitHub Actions regenere la web de clasificaciones (src/publisher.js).
 *   4. Lleva la clasificación del mes en directo: TOP en la sala y "!yo" en el chat (src/standings.js).
 *   5. (Opcional, CHATBOT=1) Propone mensajes para el chat en http://localhost:3000/bot: saludos, recordar que se
 *      vota con la letra y frases sueltas (src/chatbot/). Quien emite los copia y los pega.
 *   6. (Opcional, VTUBER=1) Mueve un avatar de VTube Studio según el juego, el chat y los regalos (src/vtuber/).
 *   7. Sirve el juego (www de flag-master) con la capa LIVE de client/ (src/live-page.js) y lo emite
 *      todo por Socket.io.
 *
 * Arranque:  npm start -- <usuario_tiktok>      (o TIKTOK_USERNAME en .env; sin usuario = modo prueba)
 */

'use strict';

const http = require('http');
const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const { Server } = require('socket.io');

const config = require('./src/config');
const { loadGameData, createQuestionFactory } = require('./src/questions');
const { createGame } = require('./src/game');
const { createRecorder } = require('./src/recorder');
const { createModerationStore } = require('./src/moderation');
const { createStandings } = require('./src/standings');
const { createTikTok } = require('./src/tiktok');
const { publishData } = require('./src/publisher');
const { composeLivePage } = require('./src/live-page');
const { fromTikTokUser } = require('./src/identity');
const { createChatBot } = require('./src/chatbot');
const { createSender } = require('./src/chatbot/senders');
const { createStudioPaster, DEFAULT_SETTINGS: DEFAULT_STUDIO_SETTINGS } = require('./src/chatbot/studio');
const { createAutopilot } = require('./src/chatbot/autopilot');
const { createVTuber } = require('./src/vtuber');
const { load: loadWin32 } = require('./src/chatbot/win32');
const { spawn } = require('child_process');

const JOIN_BROADCAST_MS = 900;    // un saludo en pantalla cada ~1 s como mucho
const MAX_JOIN_QUEUE = 6;         // si entra mucha gente de golpe, solo se saluda a los últimos
const LIKE_BROADCAST_MS = 700;    // los likes llegan en ráfagas: se agrupan
const COMMAND_COOLDOWN_MS = 30000;
const RANK_COMMANDS = /^\s*!(yo|me|rank|ranking|top|puesto)\s*$/i;
const OPTOUT_COMMANDS = /^\s*!(optout|opt-out|privacy|privacidad)\s*$/i;

/* ── Datos del juego (reutiliza los ficheros de www/js) ────── */
const GAME_DATA = loadGameData(config.GAME_DIR);
console.log(`🌍 ${GAME_DATA.countries.length} países cargados desde ${config.GAME_DIR}`);
console.log(`🎲 Modos del reto diario: ${GAME_DATA.modes.map((m, i) => `${m}×${GAME_DATA.modeCounts[i]}`).join(', ')}`);

/* ── Express + Socket.io ───────────────────────────────────── */
// Solo orígenes locales: navegador en localhost, WebView de Capacitor y file:// ("null").
const LOCAL_ORIGIN = /^(https?|capacitor|ionic):\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
function corsOrigin(origin, cb) {
  if (!origin || origin === 'null' || LOCAL_ORIGIN.test(origin)) return cb(null, true);
  cb(new Error(`Origen no permitido por CORS: ${origin}`));
}

const app = express();
app.use(cors({ origin: corsOrigin }));
app.get(['/', '/index.html'], (req, res, next) => {
  try { res.type('html').send(composeLivePage(config.GAME_DIR, config.CLIENT_DIR)); } catch (err) { next(err); }
});
app.get('/bot', (req, res) => res.sendFile(path.join(config.CLIENT_DIR, 'bot-panel.html')));
app.use('/live', express.static(config.CLIENT_DIR));
app.use(express.static(config.GAME_DIR, { index: false }));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: corsOrigin, methods: ['GET', 'POST'] } });
// El avatar (si está activo) ve lo mismo que la pantalla del directo
let vtuber = null;
const emit = (event, payload) => {
  io.emit(event, payload);
  if (vtuber) vtuber.onEmit(event, payload);
};

/* ── Piezas ────────────────────────────────────────────────── */
if (config.VTUBER) {
  vtuber = createVTuber({
    url: config.VTUBER_URL,
    tokenFile: path.join(__dirname, '.vtuber-token'),
    mapFile: path.join(__dirname, '.vtuber-map.json'),
  });
  vtuber.start();
}
const recorder = createRecorder({
  enabled: config.RECORD,
  dataDir: config.DATA_DIR,
  stateDir: config.STATE_DIR,
  timeZone: config.TIME_ZONE,
  host: config.TIKTOK_USERNAME || 'test',
  resumeWindowMs: config.RESUME_WINDOW_MS,
});
const moderation = createModerationStore(config.DATA_DIR);
const standings = createStandings({ dataDir: config.DATA_DIR, timeZone: config.TIME_ZONE, recorder, moderation });
const game = createGame({
  emit,
  buildQuestion: createQuestionFactory(GAME_DATA),
  answerSeconds: config.ANSWER_SECONDS,
  resultsSeconds: config.RESULTS_SECONDS,
});

// Panel de sugerencias del bot (/bot): espacio de nombres propio para no contar como pantalla del juego
const botPanel = io.of('/bot');
const chatbot = config.CHATBOT ? createChatBot({
  sender: createSender(config.CHATBOT_SENDER, {
    emit(event, payload) {
      botPanel.emit(event, payload);
      if (event === 'bot:suggestion') botPanel.emit('bot:status', botStatus());
    },
  }),
  lang: config.CHATBOT_LANG,
  account: config.CHATBOT_ACCOUNT,
  countries: GAME_DATA.countries,
  idleSeconds: config.CHATBOT_IDLE_SECONDS,
  getPhase: () => game.phase(),
  isHidden: p => moderation.isHidden(p),
  // Lo pega una persona: sin tiempo de "pensar", pero sin agobiar con sugerencias
  queueOptions: { minGapMs: 3000, maxGapMs: 6000, thinkMs: [0, 0], maxPerMinute: 6 },
}) : null;

game.events.on('gameStart', e => {
  recorder.onGameStart(e);
  if (chatbot) chatbot.onGameStart(e);
});
game.events.on('roundEnd', e => {
  recorder.onRoundEnd(e);
  if (chatbot) chatbot.onRoundEnd(e);
  standings.refresh();
  emit('month:update', standings.payload());
});
game.events.on('gameEnd', e => {
  recorder.onGameEnd(e);
  if (chatbot) chatbot.onGameEnd(e);
});
game.events.on('status', broadcastStatus);

/* ── Publicación: al cerrar un directo se sube data/ al repo ── */
let publishing = Promise.resolve();
function publish(reason) {
  if (!config.AUTOPUBLISH) return publishing;
  publishing = publishing.then(() => publishData(config.ROOT, reason))
    .then(r => { if (r !== 'nothing') console.log(`🚀 Datos ${r === 'published' ? 'publicados en GitHub (la web se actualiza en 1-2 min)' : 'guardados en git'}`); })
    .catch(err => console.error(`⚠️  No se pudo publicar (se reintentará en el próximo arranque o con "npm run publish"): ${err.message}`));
  return publishing;
}

function finishSession(reason) {
  const info = recorder.info();
  const file = recorder.finish(reason);
  standings.reload();
  emit('month:update', standings.payload());
  return file ? publish(`directo ${info.id}`) : Promise.resolve();
}

/* ── Saludos a quien entra al directo ──────────────────────── */
const audience = { greeted: new Set(), queue: [] };

function handleJoin(user) {
  if (!user) return;
  recorder.onJoin(user);
  if (audience.greeted.has(user.pid)) return;   // cada persona se saluda una vez
  audience.greeted.add(user.pid);
  audience.queue.push(user.nickname);
  if (audience.queue.length > MAX_JOIN_QUEUE) audience.queue.shift();
}

setInterval(() => {
  const nickname = audience.queue.shift();
  if (nickname) emit('live:join', { nickname, total: audience.greeted.size });
}, JOIN_BROADCAST_MS);

/* ── Likes del directo ─────────────────────────────────────── */
const likes = { total: 0, pending: 0, nickname: '' };

function handleLike(user, count, roomTotal) {
  const n = Math.max(1, Number(count) || 1);
  recorder.onLike(user, n);
  likes.pending += n;
  likes.total = Math.max(likes.total + n, Number(roomTotal) || 0);   // TikTok a veces manda el total de la sala
  if (user) likes.nickname = user.nickname;
}

setInterval(() => {
  if (!likes.pending) return;
  emit('live:like', { nickname: likes.nickname, count: likes.pending, total: likes.total });
  likes.pending = 0;
  likes.nickname = '';
}, LIKE_BROADCAST_MS);

/* ── Chat: votos y comandos ────────────────────────────────── */
const lastCommand = new Map();   // pid -> ms del último comando (anti-spam)

function handleCommand(user, text) {
  const isRank = RANK_COMMANDS.test(text);
  const isOptout = !isRank && OPTOUT_COMMANDS.test(text);
  if (!isRank && !isOptout) return;
  const now = Date.now();
  if (now - (lastCommand.get(user.pid) || 0) < COMMAND_COOLDOWN_MS) return;
  lastCommand.set(user.pid, now);
  if (isOptout) {
    if (moderation.optOut(user)) {
      console.log(`🙈 ${user.nickname} (@${user.handle}) pide no salir en el ranking público`);
      standings.refresh();
      emit('month:update', standings.payload());
    }
    emit('live:optout', { nickname: user.nickname });
    return;
  }
  const hidden = moderation.isHidden({ id: user.pid, u: user.handle });
  const r = hidden ? { position: 0, points: 0 } : standings.positionOf(user.pid);
  emit('live:rank', { nickname: user.nickname, position: r.position, points: r.points });
}

function handleChat(user, text) {
  if (!user) return;
  if (chatbot && chatbot.isOwnMessage(user, text)) return;   // lo que escribe el bot no cuenta como mensaje
  recorder.onChat(user);
  if (game.vote(user, text)) return;
  handleCommand(user, String(text || ''));
  if (chatbot) chatbot.onChat(user, String(text || ''));
  if (vtuber) vtuber.onChat(user, String(text || ''));
}

/* ── Conexión con TikTok LIVE ──────────────────────────────── */
const tiktokState = { state: 'disconnected', message: '' };

const tiktok = createTikTok({
  username: config.TIKTOK_USERNAME,
  signApiKey: config.EULER_API_KEY,
  reconnectMs: config.RECONNECT_MS,
  handlers: {
    chat: handleChat,
    join: handleJoin,
    like: handleLike,
    gift: (user, diamonds) => {
      recorder.onGift(user, diamonds);
      if (vtuber) vtuber.onGift(user, diamonds);
    },
    follow: user => {
      recorder.onFollow(user);
      if (vtuber) vtuber.onFollow(user);
    },
    share: user => recorder.onShare(user),
    viewers: n => recorder.onViewers(n),
    connected: roomId => recorder.setRoom(roomId),
    streamEnd: () => {
      game.stop();
      finishSession('fin del directo en TikTok');
    },
    state: (state, message) => {
      tiktokState.state = state;
      tiktokState.message = message || '';
      if (state === 'connected') console.log(`✅ ${message}`);
      broadcastStatus();
    },
  },
});

/* ── Eventos Socket.io ─────────────────────────────────────── */
function statusPayload() {
  return {
    tiktok: tiktokState.state,
    username: config.TIKTOK_USERNAME,
    message: tiktokState.message,
    ...game.status(),
    audience: audience.greeted.size,
    likes: likes.total,
    siteUrl: config.SITE_URL,
    recording: recorder.enabled,
    avatar: !!vtuber,   // la página deja libre la esquina inferior derecha para el avatar
  };
}

function broadcastStatus() {
  emit('live:status', statusPayload());
}

io.on('connection', socket => {
  console.log(`🔌 Cliente conectado (${io.of('/').sockets.size})`);
  socket.emit('live:status', statusPayload());
  socket.emit('month:update', standings.payload());
  game.syncSocket(socket);

  socket.on('game:start', opts => game.start(opts));
  socket.on('game:stop', () => game.stop());
  socket.on('game:end', () => game.end());

  socket.on('disconnect', () => {
    console.log(`🔌 Cliente desconectado (${io.of('/').sockets.size})`);
    if (io.of('/').sockets.size === 0) game.stop();   // nadie mirando: no gastar rondas
  });
});

// Ajustes de escritura del panel ("Ajustes de escritura"): se guardan en local y pisan a CHAT_INPUT_METHOD
const STUDIO_SETTINGS_FILE = path.join(__dirname, '.chatbot-studio.json');
function readStudioSettings() {
  try { return JSON.parse(fs.readFileSync(STUDIO_SETTINGS_FILE, 'utf8')); } catch { return {}; }
}
const studio = chatbot && config.CHATBOT_STUDIO ? createStudioPaster({
  x: config.CHAT_X, y: config.CHAT_Y, settings: { method: config.CHAT_INPUT_METHOD, ...readStudioSettings() },
}) : null;
const winApi = loadWin32();

/* Escribe una sugerencia en Studio (botón del panel o automático) y se lo cuenta a todos los paneles */
async function sendToStudio(s, auto) {
  botPanel.emit('bot:studio-sending', { id: s.id, auto });
  try {
    await studio.sendChatMessage(s.text);
    s.studioSent = true;
    botPanel.emit('bot:studio-result', { id: s.id, ok: true, auto });
  } catch (err) {
    console.error(`⚠️  Studio (${err.stage || 'error'}): ${err.message}`);
    botPanel.emit('bot:studio-result', { id: s.id, ok: false, error: err.message, auto });
    throw err;
  }
}

const autopilot = studio ? createAutopilot({
  send: s => sendToStudio(s, true),
  pending: () => chatbot.history(),
  onChange: () => botPanel.emit('bot:status', botStatus()),
  userIdleMs: () => (winApi ? winApi.msSinceLastInput() : Infinity),
}) : null;

const botStatus = () => (chatbot ? { ...chatbot.status(), studio: !!studio, ...(autopilot ? autopilot.status() : {}) } : { enabled: false });

botPanel.on('connection', socket => {
  const sendStatus = () => botPanel.emit('bot:status', botStatus());
  socket.emit('bot:history', chatbot ? chatbot.history() : []);
  sendStatus();
  if (!chatbot) return;
  socket.on('bot:reroll', id => chatbot.reroll(id));
  socket.on('bot:pause', () => { chatbot.pause(); sendStatus(); });
  socket.on('bot:resume', () => { chatbot.resume(); sendStatus(); });
  // Descartada en el panel: el automático tampoco la envía
  socket.on('bot:discard', id => { const s = chatbot.find(id); if (s) s.discarded = true; });
  socket.on('bot:auto', on => { if (autopilot) autopilot.setEnabled(on); });
  // "Enviar a Studio": quien emite lo pide con un clic
  socket.on('bot:studio-send', id => {
    const s = chatbot.find(id);
    if (!studio || !s) return socket.emit('bot:studio-result', { id, ok: false, error: studio ? 'sugerencia no encontrada' : 'CHATBOT_STUDIO=1 no está activado' });
    sendToStudio(s, false).catch(() => {});
  });
  // Ajustes de escritura: un panel los cambia y los ven todos
  if (!studio) return;
  socket.emit('bot:studio-settings', studio.getSettings());
  socket.on('bot:studio-settings', patch => {
    const settings = studio.setSettings(patch);
    try { fs.writeFileSync(STUDIO_SETTINGS_FILE, JSON.stringify(settings, null, 2)); } catch (err) {
      console.error(`⚠️  No se pudieron guardar los ajustes de Studio: ${err.message}`);
    }
    botPanel.emit('bot:studio-settings', settings);
  });
  socket.on('bot:studio-settings-reset', () => {
    try { fs.unlinkSync(STUDIO_SETTINGS_FILE); } catch { /* no había */ }
    botPanel.emit('bot:studio-settings', studio.setSettings({ ...DEFAULT_STUDIO_SETTINGS, method: config.CHAT_INPUT_METHOD }));
  });
});

/* ── Endpoints de prueba (simulan el directo sin estar en TikTok) ──
 *   /api/test-vote?user=pepe&text=b     /api/test-join?user=pepe     /api/test-like?user=pepe&count=5
 *   /api/test-gift?user=pepe&diamonds=10   /api/test-follow?user=pepe   /api/test-chat?user=pepe&text=!yo
 */
function testUser(req, prefix) {
  const name = String(req.query.user || `${prefix}_${Math.random().toString(36).slice(2, 7)}`);
  return fromTikTokUser({ uniqueId: name, nickname: name });
}

app.get('/api/test-vote', (req, res) => {
  handleChat(testUser(req, 'test'), req.query.text);
  res.json({ ok: true, ...game.status() });
});
app.get('/api/test-chat', (req, res) => {
  handleChat(testUser(req, 'test'), req.query.text);
  res.json({ ok: true });
});
app.get('/api/test-join', (req, res) => {
  handleJoin(testUser(req, 'fan'));
  res.json({ ok: true, audience: audience.greeted.size });
});
app.get('/api/test-like', (req, res) => {
  handleLike(testUser(req, 'fan'), req.query.count);
  res.json({ ok: true, likes: likes.total });
});
app.get('/api/test-gift', (req, res) => {
  const diamonds = Number(req.query.diamonds) || 1;
  recorder.onGift(testUser(req, 'fan'), diamonds);
  if (vtuber) vtuber.onGift(null, diamonds);
  res.json({ ok: true, session: recorder.info() });
});
app.get('/api/test-follow', (req, res) => {
  recorder.onFollow(testUser(req, 'fan'));
  if (vtuber) vtuber.onFollow(null);
  res.json({ ok: true, session: recorder.info() });
});

/*   /api/reset-ranking   (empieza un ranking de partida nuevo sin reiniciar el servidor) */
app.get('/api/reset-ranking', (req, res) => {
  game.resetRanking();
  res.json({ ok: true });
});

/*   /api/chatbot   estado del bot del chat · /api/chatbot/pause · /api/chatbot/resume · /api/chatbot/say?text=... */
app.get('/api/chatbot', (req, res) => res.json(botStatus()));
for (const action of ['pause', 'resume', 'say']) {
  app.get(`/api/chatbot/${action}`, (req, res) => {
    if (!chatbot) return res.status(404).json({ ok: false, error: 'chatbot desactivado (CHATBOT=1 en .env)' });
    chatbot[action](req.query.text);
    res.json({ ok: true, ...chatbot.status() });
  });
}

/*   /api/vtuber   estado del avatar (conexión, modelo, qué animaciones y expresiones encontró)
 *   /api/vtuber/test?event=gift   prueba una reacción (gift, greeting, follow, game:over, round:results&pct=10...)
 *   /api/vtuber/refresh   vuelve a leer el modelo (tras cambiarlo en VTube Studio) · /api/vtuber/pause · /api/vtuber/resume */
app.get('/api/vtuber', (req, res) => res.json(vtuber ? vtuber.status() : { enabled: false }));
app.get('/api/vtuber/:action', async (req, res) => {
  if (!vtuber) return res.status(404).json({ ok: false, error: 'avatar desactivado (VTUBER=1 en .env)' });
  const { action } = req.params;
  try {
    if (action === 'test') {
      const event = String(req.query.event || 'greeting');
      const pct = Number(req.query.pct);
      const data = { diamonds: Number(req.query.diamonds) || 10, text: req.query.text, count: 50, phase: 'answer', remaining: 5,
        totalVotes: req.query.votes === '0' ? 0 : 10, correctPct: Number.isFinite(pct) ? pct : 50 };
      return res.json({ ok: true, result: vtuber.trigger(event, data), ...vtuber.status() });
    }
    if (action === 'refresh') await vtuber.refresh();
    else if (action === 'pause') vtuber.pause();
    else if (action === 'resume') vtuber.resume();
    else return res.status(404).json({ ok: false, error: `acción desconocida: ${action}` });
    res.json({ ok: true, ...vtuber.status() });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/*   /api/session          estado de la grabación del directo
 *   /api/session/finish   cierra el directo ahora (guarda y publica) sin parar el servidor */
app.get('/api/session', (req, res) => res.json({ recording: recorder.enabled, session: recorder.info() }));
app.get('/api/session/finish', async (req, res) => {
  game.stop();
  await finishSession('cerrado a mano');
  res.json({ ok: true });
});

/* ── Arranque y cierre ─────────────────────────────────────── */
const recovered = recorder.recover();
if (recovered && recovered.file) publish('directo recuperado');
else publish('datos pendientes');   // lo que no se pudo subir en el cierre anterior
standings.refresh();

let closing = false;
async function shutdown(signal) {
  if (closing) return;
  closing = true;
  console.log(`\n👋 Cerrando (${signal})...`);
  game.stop();
  if (autopilot) autopilot.stop();
  if (vtuber) vtuber.stop();
  if (chatbot) chatbot.stop().catch(() => {});
  try {
    await Promise.race([finishSession('servidor detenido'), new Promise(r => setTimeout(r, 20000))]);
  } finally {
    process.exit(0);
  }
}
process.on('SIGINT', () => shutdown('Ctrl+C'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
// Cerrar la ventana en Windows: hay unos segundos, solo da tiempo a guardar (se publica al volver a arrancar)
process.on('SIGHUP', () => { game.stop(); recorder.finish('ventana cerrada'); process.exit(0); });
// Un fallo inesperado deja el proceso en estado dudoso: se guarda la copia y se sale. Al volver a
// arrancar, recover() retoma el mismo directo sin perder lo jugado.
process.on('uncaughtException', err => {
  console.error('💥 Error inesperado:', err);
  recorder.flush();
  process.exit(1);
});

server.listen(config.PORT, () => {
  console.log(`🚀 FlagMaster LIVE en http://localhost:${config.PORT}  (juego servido desde ${config.GAME_DIR})`);
  console.log(`⏱️  Rondas: ${config.ANSWER_SECONDS} s de respuesta + ${config.RESULTS_SECONDS} s de resultados`);
  console.log(config.RECORD
    ? `💾 Grabando el directo en ${path.relative(config.ROOT, config.DATA_DIR)}/sessions · publicación automática: ${config.AUTOPUBLISH ? 'sí' : 'no'}`
    : '🧪 Modo prueba: no se graba el directo (LIVE_RECORD=1 para forzarlo)');
  tiktok.connect();
  if (chatbot) {
    chatbot.start();
    const panel = `http://localhost:${config.PORT}/bot`;
    console.log(`🤖 Sugerencias para el chat en ${panel}${studio ? ` · "Enviar a Studio" pega en (${config.CHAT_X}, ${config.CHAT_Y})` : ''}`);
    if (config.CHATBOT_OPEN_PANEL && config.CHATBOT_SENDER === 'suggest' && process.platform === 'win32') {
      spawn('cmd', ['/c', 'start', '', panel], { detached: true, stdio: 'ignore' }).unref();
    }
  }
});
