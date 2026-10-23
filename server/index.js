/**
 * server/index.js — FlagMaster TikTok LIVE
 *
 *   1. Se conecta al chat de un directo de TikTok (src/tiktok.js).
 *   2. Ejecuta las partidas: el chat vota con A/B/C/D (src/game.js).
 *   3. Graba cada directo en data/sessions/ (src/recorder.js) y, al terminar, lo sube al repo
 *      para que GitHub Actions regenere la web de clasificaciones (src/publisher.js).
 *   4. Lleva la clasificación del mes en directo: TOP en la sala y "!yo" en el chat (src/standings.js).
 *   5. Sirve el juego (www de flag-master) con la capa LIVE de client/ (src/live-page.js) y lo emite
 *      todo por Socket.io.
 *
 * Arranque:  npm start -- <usuario_tiktok>      (o TIKTOK_USERNAME en .env; sin usuario = modo prueba)
 */

'use strict';

const http = require('http');
const path = require('path');
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
app.use('/live', express.static(config.CLIENT_DIR));
app.use(express.static(config.GAME_DIR, { index: false }));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: corsOrigin, methods: ['GET', 'POST'] } });
const emit = (event, payload) => io.emit(event, payload);

/* ── Piezas ────────────────────────────────────────────────── */
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

game.events.on('gameStart', e => recorder.onGameStart(e));
game.events.on('roundEnd', e => {
  recorder.onRoundEnd(e);
  standings.refresh();
  emit('month:update', standings.payload());
});
game.events.on('gameEnd', e => recorder.onGameEnd(e));
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
  if (game.vote(user, text)) return;
  handleCommand(user, String(text || ''));
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
    gift: (user, diamonds) => recorder.onGift(user, diamonds),
    follow: user => recorder.onFollow(user),
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
  };
}

function broadcastStatus() {
  emit('live:status', statusPayload());
}

io.on('connection', socket => {
  console.log(`🔌 Cliente conectado (${io.engine.clientsCount})`);
  socket.emit('live:status', statusPayload());
  socket.emit('month:update', standings.payload());
  game.syncSocket(socket);

  socket.on('game:start', opts => game.start(opts));
  socket.on('game:stop', () => game.stop());
  socket.on('game:end', () => game.end());

  socket.on('disconnect', () => {
    console.log(`🔌 Cliente desconectado (${io.engine.clientsCount})`);
    if (io.engine.clientsCount === 0) game.stop();   // nadie mirando: no gastar rondas
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
  recorder.onGift(testUser(req, 'fan'), Number(req.query.diamonds) || 1);
  res.json({ ok: true, session: recorder.info() });
});
app.get('/api/test-follow', (req, res) => {
  recorder.onFollow(testUser(req, 'fan'));
  res.json({ ok: true, session: recorder.info() });
});

/*   /api/reset-ranking   (empieza un ranking de partida nuevo sin reiniciar el servidor) */
app.get('/api/reset-ranking', (req, res) => {
  game.resetRanking();
  res.json({ ok: true });
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
});
