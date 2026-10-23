'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createRecorder } = require('../server/src/recorder');
const { fromTikTokUser } = require('../server/src/identity');
const { giftDiamonds } = require('../server/src/tiktok');
const { composeLivePage } = require('../server/src/live-page');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'fm-live-'));
}

function makeRecorder(dir, t, opts) {
  return createRecorder(Object.assign({ enabled: true, dataDir: path.join(dir, 'data'), stateDir: path.join(dir, 'state'),
    timeZone: 'Europe/Madrid', host: 'test', resumeWindowMs: 60000, clock: () => new Date(t.now) }, opts));
}

const Q = { mode: 'guess-flag', correct: { code: 'ES', flag: '🇪🇸', names: { es: 'España', en: 'Spain' } }, correctIndex: 1 };
const ana = fromTikTokUser({ userId: '7001', uniqueId: 'ana', nickname: 'Ana' });
const luis = fromTikTokUser({ userId: '7002', uniqueId: 'luis', nickname: 'Luis' });
const vote = (u, index, at) => [u.pid, { index, nickname: u.nickname, handle: u.handle, at }];

test('el id del jugador es estable aunque cambie el @ y no expone el id de TikTok', () => {
  const a = fromTikTokUser({ userId: '7001', uniqueId: 'ana', nickname: 'Ana' });
  const b = fromTikTokUser({ id: '7001', displayId: 'ana_2024', nickname: 'Ana!' });
  assert.strictEqual(a.pid, b.pid);
  assert.ok(!a.pid.includes('7001'));
  assert.strictEqual(fromTikTokUser({}), null);
});

test('regalos en combo: solo cuenta el mensaje final', () => {
  assert.strictEqual(giftDiamonds({ gift: { type: 1, diamondCount: 1 }, repeatCount: 5, repeatEnd: 0 }), 0);
  assert.strictEqual(giftDiamonds({ gift: { type: 1, diamondCount: 1 }, repeatCount: 5, repeatEnd: 1 }), 5);
  assert.strictEqual(giftDiamonds({ giftType: 2, diamondCount: 99, repeatCount: 1 }), 99);
});

test('graba aciertos, rachas, tiempos y primer puesto; guarda la sesión al cerrar', () => {
  const dir = tmpDir();
  const t = { now: Date.parse('2026-10-23T19:30:00Z') };
  const rec = makeRecorder(dir, t);
  rec.onGameStart({ totalRounds: 2 });
  rec.onRoundEnd({ question: Q, startedAt: t.now, votes: [vote(ana, 1, t.now + 2000), vote(luis, 1, t.now + 900)],
    gained: new Map([[luis.pid, 10], [ana.pid, 8]]) });
  rec.onRoundEnd({ question: Q, startedAt: t.now, votes: [vote(ana, 1, t.now + 1500), vote(luis, 0, t.now + 500)],
    gained: new Map([[ana.pid, 10]]) });
  rec.onLike(ana, 20);
  rec.onGift(luis, 5);
  rec.onGameEnd({ ranking: [[ana.pid, { points: 18 }]] });
  t.now += 3600e3;
  const file = rec.finish('test');

  assert.ok(file.endsWith(path.join('sessions', '2026-10', '2026-10-23_2130.json')));
  const s = JSON.parse(fs.readFileSync(file, 'utf8'));
  const a = s.players[ana.pid];
  const l = s.players[luis.pid];
  assert.deepStrictEqual([a.pts, a.ans, a.ok, a.streak, a.fast, a.first, a.wins, a.likes, a.games], [18, 2, 2, 2, 1500, 1, 1, 20, 1]);
  assert.deepStrictEqual([l.pts, l.ok, l.streak, l.first, l.gifts], [10, 1, 1, 1, 5]);
  assert.deepStrictEqual(a.modes, { 'guess-flag': [2, 2] });
  assert.ok(!('_g' in a), 'los campos internos no se publican');
  assert.deepStrictEqual([s.totals.rounds, s.totals.answers, s.totals.correct], [2, 4, 3]);
  assert.strictEqual(s.questions[0].es, 'España');
  assert.ok(!fs.existsSync(path.join(dir, 'state', 'current-session.json')));
});

test('una sesión sin respuestas no se publica', () => {
  const dir = tmpDir();
  const rec = makeRecorder(dir, { now: Date.now() });
  rec.onLike(ana, 3);
  assert.strictEqual(rec.finish('test'), null);
});

test('tras un cierre inesperado retoma la sesión, o la guarda si es antigua', () => {
  const dir = tmpDir();
  const t = { now: Date.now() };
  const rec = makeRecorder(dir, t);
  rec.onGameStart({ totalRounds: 0 });
  rec.onRoundEnd({ question: Q, startedAt: t.now, votes: [vote(ana, 1, t.now + 1000)], gained: new Map([[ana.pid, 10]]) });
  rec.flush();

  const again = makeRecorder(dir, t);
  assert.deepStrictEqual(again.recover(), { resumed: true, file: null });
  again.onGameStart({ totalRounds: 0 });
  again.onRoundEnd({ question: Q, startedAt: t.now, votes: [vote(ana, 1, t.now + 1000)], gained: new Map([[ana.pid, 10]]) });
  again.flush();
  const s = again.current();
  assert.strictEqual(s.players[ana.pid].pts, 20);
  assert.strictEqual(s.players[ana.pid].games, 2, 'la partida tras el reinicio cuenta como otra');
  assert.strictEqual(s.players[ana.pid].streak, 2, 'la racha sobrevive al reinicio');

  const late = makeRecorder(dir, t, { resumeWindowMs: -1 });
  const r = late.recover();
  assert.strictEqual(r.resumed, false);
  assert.ok(fs.existsSync(r.file));
});

test('la página LIVE inyecta la capa sobre el index del juego', () => {
  const dir = tmpDir();
  const client = path.join(dir, 'client');
  fs.mkdirSync(client);
  fs.writeFileSync(path.join(dir, 'index.html'), '<html><head><title>x</title></head><body><p>$1</p><script src="js/main.js"></script></body></html>');
  fs.writeFileSync(path.join(client, 'live-screens.html'), '<div id="screen-live-lobby">$&</div>');
  const html = composeLivePage(dir, client);
  assert.ok(html.includes('<link rel="stylesheet" href="live/live-mode.css"/>\n</head>'));
  assert.ok(html.indexOf('js/main.js') < html.indexOf('live/live-mode.js'), 'los scripts LIVE van después de los del juego');
  assert.ok(html.includes('<div id="screen-live-lobby">$&</div>'), 'sin sustituciones de patrón');
});
