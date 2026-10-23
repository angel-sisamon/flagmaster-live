'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { aggregate, monthKey, createModeration, newPlayer, SCHEMA } = require('../shared/stats');

function session(id, startedAt, players, extra) {
  return Object.assign({
    schema: SCHEMA, id, month: startedAt.slice(0, 7), startedAt, endedAt: startedAt,
    totals: { games: 1, rounds: 1, answers: 0, correct: 0, likes: 0, gifts: 0, follows: 0, shares: 0, joins: 0, peakViewers: 10 },
    games: [], questions: [], players,
  }, extra);
}

const P = (fields) => Object.assign(newPlayer(), fields);

test('monthKey usa la zona horaria del directo', () => {
  // 31 oct 23:30 UTC = 1 nov 00:30 en Madrid
  assert.strictEqual(monthKey('2026-10-31T23:30:00Z', 'Europe/Madrid'), '2026-11');
  assert.strictEqual(monthKey('2026-10-31T23:30:00Z', 'UTC'), '2026-10');
});

test('suma jugadores que repiten entre directos y ordena por puntos', () => {
  const agg = aggregate([
    session('a', '2026-10-01T20:00:00Z', {
      p1: P({ u: 'ana', n: 'Ana', pts: 10, ans: 2, ok: 1, tms: 1000, fast: 1000, streak: 1 }),
      p2: P({ u: 'luis', n: 'Luis', pts: 18, ans: 2, ok: 2, tms: 3000, fast: 1200, streak: 2 }),
    }),
    session('b', '2026-10-08T20:00:00Z', {
      p1: P({ u: 'ana_new', n: 'Ana', pts: 20, ans: 3, ok: 3, tms: 1500, fast: 400, streak: 3 }),
    }),
  ]);
  assert.deepStrictEqual(agg.players.map(p => [p.id, p.pts, p.pos]), [['p1', 30, 1], ['p2', 18, 2]]);
  const ana = agg.players[0];
  assert.strictEqual(ana.u, 'ana_new', 'se queda el @ más reciente');
  assert.strictEqual(ana.lives, 2);
  assert.strictEqual(ana.fast, 400);
  assert.strictEqual(ana.streak, 3);
  assert.strictEqual(ana.avg, 625);
  assert.strictEqual(ana.best, 20);
  assert.strictEqual(ana.bestLive, 'b');
  assert.deepStrictEqual(ana.hist, [[0, 10], [1, 20]]);
  assert.strictEqual(agg.lives[0].winner.id, 'p2');
  assert.strictEqual(agg.totals.players, 2);
});

test('empate a puntos: más aciertos y luego más rápido', () => {
  const agg = aggregate([session('a', '2026-10-01T20:00:00Z', {
    lento: P({ pts: 10, ans: 1, ok: 1, tms: 9000 }),
    rapido: P({ pts: 10, ans: 1, ok: 1, tms: 1000 }),
    certero: P({ pts: 10, ans: 2, ok: 2, tms: 20000 }),
  })]);
  assert.deepStrictEqual(agg.players.map(p => p.id), ['certero', 'rapido', 'lento']);
});

test('moderación: optout por id o @ oculta de la lista pero cuenta en totales', () => {
  const moderation = createModeration({ optout: ['p1'], banned: ['@Tramposo'] });
  const agg = aggregate([session('a', '2026-10-01T20:00:00Z', {
    p1: P({ u: 'ana', pts: 50, ans: 5, ok: 5 }),
    p2: P({ u: 'tramposo', pts: 99, ans: 5, ok: 5 }),
    p3: P({ u: 'luis', pts: 5, ans: 5, ok: 1 }),
  })], { moderation });
  assert.deepStrictEqual(agg.players.map(p => [p.id, p.pos]), [['p3', 1]]);
  assert.strictEqual(agg.totals.players, 3);
});

test('jugadores nuevos frente a los que ya jugaron otros meses', () => {
  const agg = aggregate([session('a', '2026-10-01T20:00:00Z', {
    viejo: P({ pts: 1, ans: 1, ok: 1 }), nuevo: P({ pts: 1, ans: 1, ok: 1 }),
  })], { seenBefore: new Set(['viejo']) });
  assert.strictEqual(agg.totals.newPlayers, 1);
});

test('solo likes o regalos: sale en apoyos pero sin puesto en el ranking', () => {
  const agg = aggregate([session('a', '2026-10-01T20:00:00Z', {
    fan: P({ likes: 40, gifts: 10 }), nadie: P({}),
  })]);
  assert.deepStrictEqual(agg.players.map(p => [p.id, p.pos]), [['fan', 0]]);
  assert.strictEqual(agg.totals.players, 0);
});

test('ignora sesiones con otro formato', () => {
  const agg = aggregate([{ schema: 99, id: 'x', players: {}, questions: [] }, null]);
  assert.strictEqual(agg.totals.lives, 0);
});

test('totales globales: participantes, mensajes, repetidores y países distintos', () => {
  const q = code => ({ code, mode: 'guess-flag', votes: 2, ok: 1 });
  const agg = aggregate([
    session('a', '2026-10-01T20:00:00Z', {
      ana: P({ pts: 10, ans: 2, ok: 1, msgs: 5 }), mudo: P({ likes: 3 }), charla: P({ msgs: 4 }),
    }, { questions: [q('ES'), q('FR')], totals: { messages: 9, answers: 2, correct: 1 } }),
    session('b', '2026-10-08T20:00:00Z', { ana: P({ pts: 5, ans: 1, ok: 1, msgs: 1 }) },
      { questions: [q('ES')], totals: { messages: 1, answers: 1, correct: 1 } }),
  ]);
  const s = agg.totals;
  assert.deepStrictEqual([s.players, s.participants, s.chatters, s.returning, s.countries, s.messages], [1, 3, 2, 1, 2, 10]);
  assert.strictEqual(agg.lives[0].messages, 9);
  assert.strictEqual(agg.players.find(p => p.id === 'ana').msgs, 6);
});

test('sesiones grabadas antes de contar mensajes: valen 0, no rompen la suma', () => {
  const old = P({ pts: 1, ans: 1, ok: 1 });
  delete old.msgs;
  const agg = aggregate([session('a', '2026-10-01T20:00:00Z', { x: old })]);
  assert.strictEqual(agg.players[0].msgs, 0);
  assert.strictEqual(agg.totals.messages, 0);
});
