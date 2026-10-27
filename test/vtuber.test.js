'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createVTSClient } = require('../server/src/vtuber/vts-client');
const { createAvatar, GESTURES } = require('../server/src/vtuber/avatar');
const { createBehavior } = require('../server/src/vtuber/behavior');
const { INTENTS, reactionFor, commandFor } = require('../server/src/vtuber/rules');
const { createVTuber } = require('../server/src/vtuber');
const { fromTikTokUser } = require('../server/src/identity');

const wait = ms => new Promise(r => setTimeout(r, ms));
const tmpToken = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vts-')), 'token');

/* VTube Studio de mentira: responde según vts.handle(messageType, data) → data | { error } | undefined (no responde) */
function fakeVTS(handle) {
  const vts = { sockets: [], received: [], handle };
  vts.WebSocket = class {
    constructor(url) {
      this.url = url;
      this.readyState = 0;
      this.listeners = {};
      vts.sockets.push(this);
      setImmediate(() => { this.readyState = 1; this.fire('open'); });
    }
    addEventListener(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); }
    fire(ev, arg) { (this.listeners[ev] || []).forEach(fn => fn(arg || {})); }
    send(raw) {
      const msg = JSON.parse(raw);
      vts.received.push(msg);
      const out = vts.handle(msg.messageType, msg.data);
      if (out === undefined) return;
      const reply = out.error
        ? { requestID: msg.requestID, messageType: 'APIError', data: { errorID: out.error, message: 'error' } }
        : { requestID: msg.requestID, messageType: msg.messageType.replace(/Request$/, 'Response'), data: out };
      setImmediate(() => this.fire('message', { data: JSON.stringify(reply) }));
    }
    close() { if (this.readyState === 3) return; this.readyState = 3; this.fire('close'); }
  };
  vts.types = () => vts.received.map(m => m.messageType);
  return vts;
}

function standardHandler(validToken = 'tok-1') {
  return (type, data) => {
    if (type === 'AuthenticationTokenRequest') return { authenticationToken: validToken };
    if (type === 'AuthenticationRequest') return { authenticated: data.authenticationToken === validToken };
    return {};
  };
}

const until = async (cond, ms = 1000) => {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error('timeout');
    await wait(5);
  }
};

test('VTube Studio: la primera vez pide token y lo guarda; la segunda entra con el guardado', async () => {
  const tokenFile = tmpToken();
  const vts = fakeVTS(standardHandler());
  const a = createVTSClient({ tokenFile, WebSocketImpl: vts.WebSocket });
  a.start();
  await until(() => a.isReady());
  assert.deepStrictEqual(vts.types(), ['AuthenticationTokenRequest', 'AuthenticationRequest']);
  assert.strictEqual(fs.readFileSync(tokenFile, 'utf8'), 'tok-1');
  assert.strictEqual(vts.received[0].apiName, 'VTubeStudioPublicAPI');
  a.stop();

  vts.received.length = 0;
  const b = createVTSClient({ tokenFile, WebSocketImpl: vts.WebSocket });
  b.start();
  await until(() => b.isReady());
  assert.deepStrictEqual(vts.types(), ['AuthenticationRequest']);
  assert.deepStrictEqual(await b.request('HotkeysInCurrentModelRequest'), {});
  b.stop();
});

test('VTube Studio: si el token guardado ya no vale, pide uno nuevo', async () => {
  const tokenFile = tmpToken();
  fs.writeFileSync(tokenFile, 'viejo');
  const vts = fakeVTS(standardHandler('nuevo'));
  const c = createVTSClient({ tokenFile, WebSocketImpl: vts.WebSocket });
  c.start();
  await until(() => c.isReady());
  assert.deepStrictEqual(vts.types(), ['AuthenticationRequest', 'AuthenticationTokenRequest', 'AuthenticationRequest']);
  assert.strictEqual(fs.readFileSync(tokenFile, 'utf8'), 'nuevo');
  c.stop();
});

test('VTube Studio: los errores de la API llegan como error y sin conexión falla en seguida', async () => {
  const vts = fakeVTS((type, data) => (type === 'HotkeyTriggerRequest' ? { error: 3 } : standardHandler()(type, data)));
  const c = createVTSClient({ tokenFile: tmpToken(), WebSocketImpl: vts.WebSocket });
  await assert.rejects(c.request('HotkeyTriggerRequest'), /no está conectado/);
  c.start();
  await until(() => c.isReady());
  await assert.rejects(c.request('HotkeyTriggerRequest', { hotkeyID: 'x' }), err => err.errorID === 3);
  c.stop();
});

test('VTube Studio: reconecta si se cierra y si deja de responder al latido', async () => {
  let answerHeartbeat = true;
  const vts = fakeVTS((type, data) => (type === 'APIStateRequest' && !answerHeartbeat ? undefined : standardHandler()(type, data)));
  const states = [];
  const c = createVTSClient({ tokenFile: tmpToken(), WebSocketImpl: vts.WebSocket, heartbeatMs: 20, requestTimeoutMs: 30, reconnectMs: [10, 40] });
  c.on('state', s => states.push(s));
  c.start();
  await until(() => c.isReady());

  vts.sockets[0].close();   // VTube Studio se cierra
  assert.ok(!c.isReady());
  await until(() => c.isReady() && vts.sockets.length === 2);

  answerHeartbeat = false;  // se cuelga
  await until(() => vts.sockets.length === 3);
  answerHeartbeat = true;
  await until(() => c.isReady());
  assert.ok(states.filter(s => s === 'disconnected').length >= 2);
  c.stop();
});

/* Cliente de mentira para avatar y behavior */
function fakeClient(model) {
  const sent = [];
  return {
    sent,
    isReady: () => true,
    send: (type, data) => { sent.push([type, data]); return Promise.resolve(); },
    request: type => Promise.resolve(type === 'HotkeysInCurrentModelRequest'
      ? { modelLoaded: true, modelName: 'Hiyori', availableHotkeys: model.hotkeys }
      : { expressions: model.expressions }),
  };
}

const MODEL = {
  hotkeys: [
    { hotkeyID: 'h1', name: 'Wave Hand', type: 'TriggerAnimation', file: 'wave.motion3.json' },
    { hotkeyID: 'h2', name: 'Smile toggle', type: 'ToggleExpression', file: 'smile.exp3.json' },
    { hotkeyID: 'h3', name: 'Baile', type: 'TriggerAnimation', file: 'dance_01.motion3.json' },
  ],
  expressions: [
    { name: 'Sonrisa', file: 'smile.exp3.json' },
    { name: 'Shocked', file: 'Shock.exp3.json' },
  ],
};

test('avatar: encuentra animaciones y expresiones por palabras clave o por el mapa a mano', async () => {
  const client = fakeClient(MODEL);
  const avatar = createAvatar({ client, intents: INTENTS, log: () => {} });
  const inv = await avatar.refresh();
  assert.strictEqual(inv.model, 'Hiyori');
  assert.deepStrictEqual(inv.hotkeys, ['Wave Hand', 'Baile']);   // los de expresión van por face()
  assert.deepStrictEqual(inv.resolved.anim, { wave: 'Wave Hand', celebrate: 'Baile' });
  assert.deepStrictEqual(inv.resolved.face, { happy: 'Sonrisa', surprised: 'Shocked' });

  assert.ok(avatar.anim('wave'));
  assert.ok(!avatar.anim('love'));
  assert.ok(avatar.face('happy', true));
  avatar.face('happy', true);    // ya activa: no se repite
  avatar.face('happy', false);
  assert.deepStrictEqual(client.sent.map(([t, d]) => [t, d.hotkeyID || d.expressionFile, d.active]), [
    ['HotkeyTriggerRequest', 'h1', undefined],
    ['ExpressionActivationRequest', 'smile.exp3.json', true],
    ['ExpressionActivationRequest', 'smile.exp3.json', false],
  ]);

  const mapped = createAvatar({ client: fakeClient(MODEL), intents: INTENTS, map: { anim: { wave: 'Baile', celebrate: '' } }, log: () => {} });
  const inv2 = await mapped.refresh();
  assert.deepStrictEqual(inv2.resolved.anim, { wave: 'Baile' });
});

test('avatar: los gestos mueven la cabeza y vuelven a su sitio; la cara se pone a mano', () => {
  let t = 0;
  const avatar = createAvatar({ client: fakeClient(MODEL), intents: INTENTS, now: () => t });
  assert.ok(avatar.gesture('shake'));
  assert.ok(!avatar.gesture('backflip'));
  t = 120;
  assert.ok(Math.abs(avatar.step().x) > 3);
  t = 5000;
  assert.ok(Math.abs(avatar.step().x) < 0.01);   // y / z llevan la respiración

  avatar.face('happy', true);
  for (let i = 0; i < 60; i++) avatar.step();
  assert.ok(avatar.step().smile > 0.9);
  avatar.face('happy', false);
  for (let i = 0; i < 60; i++) avatar.step();
  assert.ok(avatar.step().smile < 0.1);

  // todos los gestos dejan los canales dentro de rango
  for (const name of Object.keys(GESTURES)) {
    avatar.gesture(name);
    for (let i = 0; i < 10; i++) {
      t += GESTURES[name].ms / 10;
      const v = avatar.step();
      assert.ok(v.armL >= -1 && v.armL <= 1 && v.smile >= 0 && v.smile <= 1 && Math.abs(v.x) < 30, name);
    }
  }
});

/* behavior con un avatar que solo apunta lo que le piden */
function recordingAvatar() {
  const log = [];
  return {
    log,
    face: (f, on) => log.push(`face:${f}:${on}`),
    anim: a => log.push(`anim:${a}`),
    gesture: g => log.push(`gesture:${g}`),
    look: () => {},
    idle: () => log.push('idle'),
    isSpeaking: () => false,
  };
}

test('behavior: lo urgente corta lo demás, lo menor espera o se descarta y nada se repite sin parar', () => {
  let t = 1000;
  const avatar = recordingAvatar();
  const b = createBehavior({ avatar, now: () => t, random: () => 0.5 });

  assert.strictEqual(b.request({ priority: 'medium', key: 'round', face: 'thinking', ms: 2000 }), 'started');
  assert.strictEqual(b.request({ priority: 'low', key: 'join', ms: 1000 }), 'busy');
  assert.strictEqual(b.request({ priority: 'high', key: 'gift', cooldownMs: 3000, anim: 'celebrate', face: 'happy', ms: 3000 }), 'started');
  assert.deepStrictEqual(avatar.log.slice(0, 4), ['face:thinking:true', 'face:thinking:false', 'face:happy:true', 'anim:celebrate']);
  assert.strictEqual(b.request({ priority: 'medium', key: 'round', ms: 2000 }), 'busy');
  assert.strictEqual(b.request({ priority: 'high', key: 'follow', queue: true, face: 'happy', ms: 1000 }), 'queued');
  assert.strictEqual(b.request({ priority: 'high', key: 'gift', cooldownMs: 3000, ms: 3000 }), 'cooldown');

  t += 3000;
  b.tick();   // termina el regalo y entra el follow que esperaba
  assert.deepStrictEqual(b.status().current, { priority: 'high', key: 'follow' });
  t += 1000;
  b.tick();
  assert.strictEqual(b.status().current, null);
  t += 5000;
  b.tick();
  assert.strictEqual(avatar.log.at(-1), 'idle');

  // lo que espera demasiado caduca
  b.request({ priority: 'high', key: 'a', ms: 20000 });
  b.request({ priority: 'high', key: 'b', queue: true, ms: 1000 });
  t += 20000;
  b.tick();
  assert.strictEqual(b.status().current, null);
});

test('reglas: reacciones del juego, regalos y comandos', () => {
  assert.strictEqual(reactionFor('round:results', { totalVotes: 10, correctPct: 10 }).face, 'surprised');
  assert.strictEqual(reactionFor('round:results', { totalVotes: 10, correctPct: 90 }).face, 'happy');
  assert.strictEqual(reactionFor('round:results', { totalVotes: 0 }).face, 'sad');
  assert.strictEqual(reactionFor('round:tick', { phase: 'answer', remaining: 5 }).gesture, 'hop');
  assert.strictEqual(reactionFor('round:tick', { phase: 'answer', remaining: 4 }), null);
  assert.strictEqual(reactionFor('gift', { diamonds: 0 }), null);
  assert.strictEqual(reactionFor('gift', { diamonds: 500 }).ms, 5000);
  assert.strictEqual(reactionFor('live:like', { count: 3 }), null);
  assert.strictEqual(reactionFor('round:votes', {}), null);
  assert.strictEqual(commandFor(' !Dance ').anim, 'celebrate');
  assert.strictEqual(commandFor('!dance please'), null);
  assert.strictEqual(commandFor('a'), null);
  for (const r of ['gift', 'greeting', 'follow', 'game:over', 'round:question', 'live:join']) {
    const a = reactionFor(r, { diamonds: 1 });
    for (const k of [a.anim, a.face].filter(Boolean)) assert.ok(INTENTS[k], `${r}: intención ${k}`);
    assert.ok(GESTURES[a.gesture], `${r}: gesto ${a.gesture}`);
  }
});

test('vtuber: el chat saluda y los comandos tienen espera por persona', () => {
  const client = { on: () => {}, start: () => {}, stop: () => {}, isReady: () => false, send: () => Promise.resolve(), status: () => ({ state: 'disconnected' }) };
  const v = createVTuber({ client, log: () => {} });
  const ana = fromTikTokUser({ userId: '7001', uniqueId: 'ana', nickname: 'Ana' });
  const leo = fromTikTokUser({ userId: '7002', uniqueId: 'leo', nickname: 'Leo' });
  assert.strictEqual(v.onChat(ana, 'hola!!'), 'started');
  assert.strictEqual(v.onChat(ana, 'b'), 'none');
  v.pause(); v.resume();
  assert.strictEqual(v.onChat(ana, '!wave'), 'started');
  assert.strictEqual(v.onChat(ana, '!dance'), 'cooldown');      // la misma persona, en seguida
  assert.strictEqual(v.onChat(leo, '!dance'), 'cooldown');      // otra persona, pero los comandos van de 5 en 5 s
  v.onEmit('round:votes', { counts: [] });                        // eventos que no son reacción: nada
  assert.strictEqual(v.status().behavior.played, 2);
});
