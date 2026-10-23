/**
 * server/src/tiktok.js — Conexión con el chat del directo (tiktok-live-connector).
 *
 * Compatible con tiktok-live-connector v2 (TikTokLiveConnection, protobuf) y v1 (WebcastPushConnection,
 * datos aplanados). Traduce cada evento a algo simple y con el usuario ya identificado (identity.js):
 *
 *   handlers.chat(user, text)        handlers.join(user)         handlers.like(user, count, roomTotal)
 *   handlers.gift(user, diamonds)    handlers.follow(user)       handlers.share(user)
 *   handlers.viewers(count)          handlers.connected(roomId)  handlers.streamEnd()
 *   handlers.state(state, message)   'connecting' | 'connected' | 'disconnected' | 'disabled'
 */

'use strict';

const TikTok = require('tiktok-live-connector');
const { fromTikTokUser } = require('./identity');

function userOf(data) {
  return fromTikTokUser((data && data.user) || data);
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

function createTikTok({ username, signApiKey, reconnectMs, handlers }) {
  const state = { conn: null, retry: null };
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
    handlers.state('connecting', `Conectando con @${username}...`);

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
    conn.on(EV.CHAT, data => handlers.chat(userOf(data), data.content != null ? data.content : data.comment));
    conn.on(EV.MEMBER, data => handlers.join(userOf(data)));
    conn.on(EV.LIKE, data => handlers.like(userOf(data),
      Math.max(1, Number(data.likeCount != null ? data.likeCount : data.count) || 1),
      Number(data.totalLikeCount != null ? data.totalLikeCount : data.total) || 0));
    conn.on(EV.GIFT, data => handlers.gift(userOf(data), giftDiamonds(data)));
    if (EV.FOLLOW) conn.on(EV.FOLLOW, data => handlers.follow(userOf(data)));
    if (EV.SHARE) conn.on(EV.SHARE, data => handlers.share(userOf(data)));
    conn.on(EV.ROOM_USER, data => handlers.viewers(Number(data.total != null ? data.total : data.viewerCount) || 0));

    const scheduleReconnect = reason => {
      if (state.conn !== conn) return;
      state.conn = null;
      handlers.state('disconnected', `${reason}. Reintentando en ${reconnectMs / 1000} s...`);
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
        const roomId = s && (s.roomId || (s.roomInfo && s.roomInfo.id));
        handlers.connected(roomId);
        handlers.state('connected', `Conectado a @${username}${roomId ? ` (sala ${roomId})` : ''}`);
      })
      .catch(err => {
        console.error('❌ Error conectando con TikTok:', err && err.message ? err.message : err);
        scheduleReconnect(`No se pudo conectar (¿@${username} está en directo?)`);
      });
  }

  return { connect };
}

module.exports = { createTikTok, giftDiamonds };
