'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { createAutoLoop } = require('../server/src/autoloop');
const { createGame } = require('../server/src/game');
const { loadPhrases } = require('../server/src/chatbot/brain');

function setup(t, opts = {}) {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 1_000_000 });
  const sent = [];
  const starts = [];
  let lobbies = 0;
  const loop = createAutoLoop({
    startGame: o => starts.push(o),
    emit: (ev, data) => sent.push([ev, data]),
    podiumSeconds: 30,
    lobbySeconds: 10,
    maxEmptyGames: 2,
    onLobby: () => lobbies++,
    log: () => {},
    ...opts,
  });
  const last = () => sent.filter(([ev]) => ev === 'loop:status').map(([, d]) => d).pop();
  return { loop, starts, last, lobbies: () => lobbies };
}

test('bucle: podio 30 s → sala 10 s → partida nueva con las mismas rondas', t => {
  const { loop, starts, last, lobbies } = setup(t);
  loop.set({ enabled: true, totalRounds: 20 });
  loop.onGameEnd({ participants: 5 });
  assert.deepStrictEqual(last(), { enabled: true, totalRounds: 20, phase: 'podium', remaining: 30, stopped: '' });
  t.mock.timers.tick(29_000);
  assert.strictEqual(starts.length, 0);
  t.mock.timers.tick(1_000);
  assert.strictEqual(last().phase, 'lobby');
  assert.strictEqual(last().remaining, 10);
  assert.strictEqual(lobbies(), 1, 'el bot anuncia la siguiente al pasar a la sala');
  t.mock.timers.tick(10_000);
  assert.deepStrictEqual(starts, [{ fresh: true, totalRounds: 20 }]);
  assert.strictEqual(last().phase, 'idle');
});

test('bucle: desmarcado no hace nada y apagarlo cancela la partida que venía', t => {
  const { loop, starts, last } = setup(t);
  loop.onGameEnd({ participants: 5 });
  t.mock.timers.tick(60_000);
  assert.strictEqual(starts.length, 0);

  loop.set({ enabled: true, totalRounds: 10 });
  loop.onGameEnd({ participants: 5 });
  t.mock.timers.tick(35_000);
  loop.set({ enabled: false });
  t.mock.timers.tick(60_000);
  assert.strictEqual(starts.length, 0);
  assert.deepStrictEqual([last().enabled, last().phase], [false, 'idle']);
});

test('bucle: sin límite de rondas (∞) no hay bucle', t => {
  const { loop, last } = setup(t);
  loop.set({ enabled: true, totalRounds: 0 });
  assert.strictEqual(last().enabled, false);
  loop.set({ enabled: true, totalRounds: 20 });
  loop.set({ enabled: true, totalRounds: 0 });   // cambiar a ∞ con el bucle en marcha lo para
  assert.strictEqual(last().enabled, false);
});

test('bucle: se para solo tras 2 partidas seguidas sin votos', t => {
  const { loop, starts, last } = setup(t);
  loop.set({ enabled: true, totalRounds: 5 });
  loop.onGameEnd({ participants: 0 });     // una vacía: sigue
  t.mock.timers.tick(30_000); t.mock.timers.tick(10_000);   // podio + sala
  assert.strictEqual(starts.length, 1);
  loop.onGameEnd({ participants: 3 });     // alguien vota: la cuenta vuelve a 0
  t.mock.timers.tick(30_000); t.mock.timers.tick(10_000);   // podio + sala
  loop.onGameEnd({ participants: 0 });
  t.mock.timers.tick(30_000); t.mock.timers.tick(10_000);   // podio + sala
  assert.strictEqual(starts.length, 3);
  loop.onGameEnd({ participants: 0 });     // segunda vacía seguida: se para
  assert.deepStrictEqual([last().enabled, last().stopped, last().phase], [false, 'empty', 'idle']);
  t.mock.timers.tick(60_000);
  assert.strictEqual(starts.length, 3);
  loop.set({ enabled: true, totalRounds: 5 });   // volver a marcarlo borra el aviso
  assert.deepStrictEqual([last().enabled, last().stopped], [true, '']);
});

test('bucle: arrancar a mano en plena espera cancela la programada', t => {
  const { loop, starts, last } = setup(t);
  loop.set({ enabled: true, totalRounds: 5 });
  loop.onGameEnd({ participants: 2 });
  t.mock.timers.tick(5_000);
  loop.onManualStart();
  t.mock.timers.tick(60_000);
  assert.strictEqual(starts.length, 0);
  assert.deepStrictEqual([last().enabled, last().phase], [true, 'idle']);
});

test('bucle + juego real: al acabar la partida empieza otra sola con las mismas rondas', t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 1_000_000 });
  const events = [];
  const game = createGame({
    emit: ev => events.push(ev),
    buildQuestion: () => ({ mode: 'flag', correctIndex: 0, correct: { flag: '🇪🇸', names: { es: 'España' } }, options: [] }),
    answerSeconds: 2,
    resultsSeconds: 1,
  });
  const loop = createAutoLoop({ startGame: o => game.start(o), emit: () => {}, podiumSeconds: 30, lobbySeconds: 10, log: () => {} });
  const ends = [];
  game.events.on('gameEnd', e => { ends.push(e); loop.onGameEnd(e); });
  game.start({ totalRounds: 2 });
  loop.set({ enabled: true, totalRounds: game.status().totalRounds });
  game.vote({ pid: 'p1', nickname: 'Ana' }, 'a');
  t.mock.timers.tick(6_000);   // 2 rondas × (2 + 1 s)
  assert.strictEqual(ends.length, 1);
  assert.strictEqual(ends[0].participants, 1);
  assert.strictEqual(game.isRunning(), false);
  t.mock.timers.tick(30_000); t.mock.timers.tick(10_000);   // podio + sala
  assert.strictEqual(game.isRunning(), true);
  assert.strictEqual(game.status().totalRounds, 2);
  assert.strictEqual(game.status().round, 1);
});

test('bot: frases para anunciar la siguiente partida del bucle', () => {
  const phrases = loadPhrases('en', { log: () => {} });
  assert.ok(phrases.game_next.length >= 10);
  for (const p of phrases.game_next) assert.ok(!/\p{Extended_Pictographic}/u.test(p), `sin emojis: ${p}`);
});
