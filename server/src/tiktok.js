/**
 * server/src/tiktok.js — Conexión con el chat del directo (tiktok-live-connector).
 *
 * Compatible con tiktok-live-connector v2 (TikTokLiveConnection, protobuf) y v1 (WebcastPushConnection,
 * datos aplanados). Traduce cada evento a algo simple y con el usuario ya identificado (identity.js):
 *
 *   handlers.chat(user, text, createTime)   (createTime: ms en que llegó a TikTok, 0 si no viene)
 *   handlers.join(user)         handlers.like(user, count, roomTotal)
 *   handlers.gift(user, diamonds)    handlers.follow(user)       handlers.share(user)
 *   handlers.viewers(count)          handlers.connected(roomId)  handlers.streamEnd()
 *   handlers.state(state, message)   'connecting' | 'connected' | 'waiting' (aún no en directo) | 'disconnected' | 'disabled'
 *
 * El servidor se arranca antes del directo: hasta que @usuario está en directo (fetchIsLive) no se conecta, solo
 * espera. Solo se queda en una sala en directo, y si @usuario abre otra (directo nuevo) se cambia a ella.
 */

'use strict';

const TikTok = require('tiktok-live-connector');
const { fromTikTokUser } = require('./identity');

function userOf(data) {
  return fromTikTokUser((data && data.user) || data);
}

/* Momento en que el mensaje llegó a TikTok (ms; v2 en data.common, v1 aplanado). 0 si no viene */
function createTimeOf(data) {
  const t = Number(data && ((data.common && data.common.createTime) || data.createTime));
  return Number.isFinite(t) && t > 0 ? t : 0;
}

/* Regalos: los de tipo 1 se pueden encadenar (combo) y llegan repetidos; solo cuenta el último (repeatEnd) */
function giftDiamonds(data) {
  const gift = data.gift || data.giftDetails || {};
  const type = gift.type != null ? gift.type : data.giftType;
  const each = Number(gift.diamondCount != null ? gift.diamondCount : data.diamondCount) || 0;
  const repeat = Math.max(1, Number(data.repeatCount) || 1);
  if (type === 1 && !data.repeatEnd) return 0;
  return each * repeat;
}

/* Estado de la sala (roomInfo.data.status de TikTok): 2 = en directo, 4 = terminado. Con el directo aún sin
 * empezar (LIVE Studio abierto, o la sala del directo anterior) TikTok ya da un roomId y la conexión "funciona",
 * pero ahí no llega el chat: al pulsar "Empezar directo" TikTok abre otra sala. null si no se sabe. */
const STATUS_LIVE = 2;
function roomStatusOf(s) {
  const info = s && s.roomInfo;
  const st = Number(info && (info.data ? info.data.status : info.status));
  return Number.isFinite(st) ? st : null;
}

function withTimeout(promise, ms) {
  let t;
  return Promise.race([promise, new Promise((_, rej) => { t = setTimeout(() => rej(new Error('timeout')), ms); })])
    .finally(() => clearTimeout(t));
}

function createTikTok({
  username, signApiKey, reconnectMs, handlers,
  roomCheckMs = 60000,      // cada cuánto se mira si TikTok ha abierto otra sala (directo nuevo)
  lib = TikTok,             // inyectable para los tests
}) {
  const TikTok = lib;
  const state = { conn: null, retry: null, roomId: null, watch: null, probe: null, attempt: 0, waiting: false };
  const isV2 = typeof TikTok.TikTokLiveConnection === 'function';
  const EV = isV2 ? TikTok.WebcastEvent : {
    CHAT: 'chat', MEMBER: 'member', LIKE: 'like', GIFT: 'gift', FOLLOW: 'follow', SHARE: 'share',
    ROOM_USER: 'roomUser', STREAM_END: 'streamEnd',
  };
  const DISCONNECTED = (isV2 && TikTok.ControlEvent && TikTok.ControlEvent.DISCONNECTED) || 'disconnected';

  function connect() {
    if (!username) {
      handlers.state('disabled', 'Sin usuario de TikTok: arranca con "npm start -- <usuario>"');
      return;
    }
    clearTimeout(state.retry);
    stopWatch();
    const attempt = ++state.attempt;
    if (!state.waiting) handlers.state('connecting', `Conectando con @${username}...`);

    // Primero se pregunta si @username está en directo: con el directo sin empezar TikTok ya da una sala
    // (y su room/info viene sin estado), pero en ella no llega el chat. Mientras no lo esté, se espera.
    isLiveNow().then(live => {
      if (attempt !== state.attempt) return;
      if (live === false) {
        if (!state.waiting) console.log(`⏳ @${username} todavía no está en directo: se espera a que empiece`);
        state.waiting = true;
        handlers.state('waiting', `Esperando a que @${username} empiece el directo (se mira cada ${reconnectMs / 1000} s)...`);
        state.retry = setTimeout(connect, reconnectMs);
        return;
      }
      if (state.waiting) handlers.state('connecting', `@${username} ya está en directo: conectando...`);
      state.waiting = false;
      open();
    });
  }

  function probe() {
    // v2.5 lee options.* sin comprobar que exista: hay que pasar siempre un objeto
    if (!state.probe) state.probe = new TikTok.TikTokLiveConnection(username, signApiKey ? { signApiKey } : {});
    return state.probe;
  }

  /* true/false si TikTok sabe decir si está en directo; null si no se puede saber (v1, o TikTok no responde) */
  async function isLiveNow() {
    if (!isV2) return null;
    try {
      const p = probe();
      if (typeof p.fetchIsLive !== 'function') return null;
      const live = await withTimeout(p.fetchIsLive(), 20000);
      return typeof live === 'boolean' ? live : null;
    } catch (err) {
      console.error('⚠️  No se pudo saber si está en directo:', (err && err.message) || err);
      return null;
    }
  }

  function open() {
    // v2.5 lee options.* sin comprobar que exista: hay que pasar siempre un objeto
    const options = signApiKey ? { signApiKey } : {};
    let conn;
    try {
      conn = isV2 ? new TikTok.TikTokLiveConnection(username, options) : new TikTok.WebcastPushConnection(username, options);
    } catch (err) {
      console.error('❌ No se pudo crear la conexión con TikTok:', err.message);
      handlers.state('disconnected', `Error al crear la conexión: ${err.message}. Reintentando en ${reconnectMs / 1000} s...`);
      state.retry = setTimeout(connect, reconnectMs);
      return;
    }
    state.conn = conn;

    // v2 manda el texto en data.content; v1 en data.comment
    conn.on(EV.CHAT, data => handlers.chat(userOf(data), data.content != null ? data.content : data.comment, createTimeOf(data)));
    conn.on(EV.MEMBER, data => handlers.join(userOf(data)));
    conn.on(EV.LIKE, data => handlers.like(userOf(data),
      Math.max(1, Number(data.likeCount != null ? data.likeCount : data.count) || 1),
      Number(data.totalLikeCount != null ? data.totalLikeCount : data.total) || 0));
    conn.on(EV.GIFT, data => handlers.gift(userOf(data), giftDiamonds(data)));
    if (EV.FOLLOW) conn.on(EV.FOLLOW, data => handlers.follow(userOf(data)));
    if (EV.SHARE) conn.on(EV.SHARE, data => handlers.share(userOf(data)));
    conn.on(EV.ROOM_USER, data => handlers.viewers(Number(data.total != null ? data.total : data.viewerCount) || 0));

    const scheduleReconnect = (reason, st = 'disconnected') => {
      if (state.conn !== conn) return;
      state.conn = null;
      stopWatch();
      handlers.state(st, `${reason}. Reintentando en ${reconnectMs / 1000} s...`);
      state.retry = setTimeout(connect, reconnectMs);
    };
    // Sin listener de 'error', un EventEmitter que emite error tumba todo el proceso de Node
    conn.on('error', err => console.error('⚠️  TikTok:', (err && (err.info || err.message)) || err));
    conn.on(DISCONNECTED, () => scheduleReconnect('Desconectado de TikTok'));
    conn.on(EV.STREAM_END, () => {
      handlers.streamEnd();
      scheduleReconnect('El directo ha terminado');
    });

    conn.connect()
      .then(s => {
        if (state.conn !== conn) return;
        const roomId = s && (s.roomId || (s.roomInfo && s.roomInfo.id));
        const status = roomStatusOf(s);
        if (status != null && status !== STATUS_LIVE) {
          // Sala que aún no está (o ya no está) en directo: aquí no llegarían los votos
          console.log(`⏳ @${username} todavía no está en directo (sala ${roomId || '?'}, estado ${status}): se espera`);
          Promise.resolve().then(() => conn.disconnect()).catch(() => {});
          scheduleReconnect(`Esperando a que @${username} empiece el directo`, 'waiting');
          return;
        }
        state.roomId = roomId ? String(roomId) : null;
        handlers.connected(roomId);
        handlers.state('connected', `Conectado a @${username}${roomId ? ` (sala ${roomId})` : ''}`);
        startWatch(conn);
      })
      .catch(err => {
        console.error('❌ Error conectando con TikTok:', err && err.message ? err.message : err);
        scheduleReconnect(`No se pudo conectar (¿@${username} está en directo?)`);
      });
  }

  /* Vigilancia: si @username tiene ahora otra sala (ha empezado un directo nuevo y seguimos en la vieja, que
   * ya no recibe chat), se cambia a la nueva. Usa una conexión aparte: fetchRoomId() cambia el roomId de
   * la conexión en la que se llama. */
  function startWatch(conn) {
    stopWatch();
    if (!isV2 || !roomCheckMs || !state.roomId) return;
    let busy = false;
    state.watch = setInterval(async () => {
      if (busy || state.conn !== conn) return;
      busy = true;
      try {
        const current = await withTimeout(probe().fetchRoomId(), 20000);
        if (state.conn !== conn || !current || String(current) === state.roomId) return;
        console.log(`🔄 @${username} tiene una sala nueva (${state.roomId} → ${current}): cambiando a la nueva`);
        state.conn = null;
        stopWatch();
        try { await withTimeout(Promise.resolve(conn.disconnect()), 5000); } catch { /* da igual: se abandona */ }
        connect();
      } catch { /* sin respuesta de TikTok: se vuelve a mirar en la siguiente */ } finally {
        busy = false;
      }
    }, roomCheckMs);
    if (state.watch.unref) state.watch.unref();
  }

  function stopWatch() {
    clearInterval(state.watch);
    state.watch = null;
  }

  return { connect, roomId: () => state.roomId };
}

module.exports = { createTikTok, giftDiamonds, createTimeOf, roomStatusOf };
