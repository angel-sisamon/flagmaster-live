'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('events');
const { createTikTok, roomStatusOf } = require('../server/src/tiktok');

/* TikTok falso: rooms[username] = { id, status } que se puede cambiar durante la prueba */
function fakeLib(room) {
  const created = [];
  class TikTokLiveConnection extends EventEmitter {
    constructor(username) { super(); this.username = username; this.disconnected = false; created.push(this); }
    async connect() { this.opened = true; return { roomId: room.id, roomInfo: { data: { status: room.status } } }; }
    async fetchRoomId() { return room.id; }
    async fetchIsLive() {
      if (room.liveError) throw new Error('sin respuesta');
      return room.live != null ? room.live : room.status !== 4;
    }
    async disconnect() { this.disconnected = true; }
  }
  return {
    created,
    conns: () => created.filter(c => c.opened),   // conexiones al chat (sin la de consultar)
    lib: {
      TikTokLiveConnection,
      WebcastEvent: { CHAT: 'chat', MEMBER: 'member', LIKE: 'like', GIFT: 'gift', FOLLOW: 'follow', SHARE: 'share', ROOM_USER: 'roomUser', STREAM_END: 'streamEnd' },
      ControlEvent: { DISCONNECTED: 'disconnected' },
    },
  };
}

function handlers(log) {
  const noop = () => {};
  return {
    chat: noop, join: noop, like: noop, gift: noop, follow: noop, share: noop, viewers: noop, streamEnd: noop,
    connected: id => log.push(['connected', id]),
    state: (s) => log.push(['state', s]),
  };
}

const tick = (ms = 0) => new Promise(r => setTimeout(r, ms));

test('roomStatusOf lee el estado de la sala', () => {
  assert.strictEqual(roomStatusOf({ roomInfo: { data: { status: 2 } } }), 2);
  assert.strictEqual(roomStatusOf({ roomInfo: { status: 4 } }), 4);
  assert.strictEqual(roomStatusOf({ roomId: '1' }), null);
});

test('una sala que no está en directo no se da por conectada: espera y reintenta', async () => {
  const room = { id: '111', status: 4 };
  const { lib, created, conns } = fakeLib(room);
  const log = [];
  const tt = createTikTok({ username: 'u', reconnectMs: 20, roomCheckMs: 0, handlers: handlers(log), lib });
  tt.connect();
  await tick(5);
  assert.ok(log.some(e => e[0] === 'state' && e[1] === 'waiting'));
  assert.ok(!log.some(e => e[0] === 'connected'));
  assert.ok(conns().every(c => c.disconnected), 'no queda ninguna conexión abierta a la sala vieja');
  room.id = '222'; room.status = 2;   // empieza el directo
  await tick(40);
  assert.deepStrictEqual(log.filter(e => e[0] === 'connected'), [['connected', '222']]);
  assert.strictEqual(tt.roomId(), '222');
  created.forEach(c => c.emit('disconnected'));
});

test('arrancado antes del directo (sala sin estado en room/info): espera hasta que empieza', async () => {
  // Lo que da TikTok de verdad sin directo: hay roomId, room/info sin status y fetchIsLive() = false
  const room = { id: '111', status: undefined, live: false };
  const { lib, created } = fakeLib(room);
  const log = [];
  const tt = createTikTok({ username: 'u', reconnectMs: 15, roomCheckMs: 0, handlers: handlers(log), lib });
  tt.connect();
  await tick(60);   // varios reintentos mientras se configura el directo
  assert.ok(!log.some(e => e[0] === 'connected' || (e[0] === 'state' && e[1] === 'connected')));
  assert.ok(log.some(e => e[0] === 'state' && e[1] === 'waiting'));
  assert.strictEqual(tt.roomId(), null);
  room.id = '222'; room.live = true;   // empieza el directo
  await tick(40);
  assert.deepStrictEqual(log.filter(e => e[0] === 'connected'), [['connected', '222']]);
  assert.strictEqual(tt.roomId(), '222');
  created.forEach(c => c.emit('disconnected'));
});

test('si no se puede saber si está en directo, se intenta conectar igual', async () => {
  const room = { id: '111', status: 2, liveError: true };
  const { lib, created } = fakeLib(room);
  const log = [];
  const tt = createTikTok({ username: 'u', reconnectMs: 1000, roomCheckMs: 0, handlers: handlers(log), lib });
  tt.connect();
  await tick(10);
  assert.strictEqual(tt.roomId(), '111');
  created.forEach(c => c.emit('disconnected'));
});

test('si TikTok abre otra sala (directo nuevo), se cambia a ella', async () => {
  const room = { id: '111', status: 2 };
  const { lib, created, conns } = fakeLib(room);
  const log = [];
  const tt = createTikTok({ username: 'u', reconnectMs: 1000, roomCheckMs: 15, handlers: handlers(log), lib });
  tt.connect();
  await tick(5);
  assert.strictEqual(tt.roomId(), '111');
  await tick(40);   // misma sala: no cambia nada
  assert.strictEqual(log.filter(e => e[0] === 'connected').length, 1);
  room.id = '222';
  await tick(60);
  assert.deepStrictEqual(log.filter(e => e[0] === 'connected').map(e => e[1]), ['111', '222']);
  assert.ok(conns()[0].disconnected, 'la conexión vieja se cierra');
  assert.strictEqual(tt.roomId(), '222');
  // Que la vieja avise de su desconexión no debe provocar otra reconexión
  conns()[0].emit('disconnected');
  await tick(5);
  assert.ok(!log.some(e => e[0] === 'state' && e[1] === 'disconnected'));
  room.id = '222';
  created.forEach(c => c.emit('disconnected'));
});
