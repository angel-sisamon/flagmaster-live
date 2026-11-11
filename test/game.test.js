'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { createGame } = require('../server/src/game');
const { fromTikTokUser, avatarOf } = require('../server/src/identity');

const PIC = 'https://p16-sign.tiktokcdn.com/avatar~100x100.webp';

test('identity: foto de perfil de v1 y v2, solo https', () => {
  assert.strictEqual(avatarOf({ profilePictureUrl: PIC }), PIC);
  assert.strictEqual(avatarOf({ avatarThumb: { url: ['http://inseguro/a.jpg', PIC] } }), PIC);
  assert.strictEqual(avatarOf({ profilePictureUrl: 'javascript:alert(1)' }), '');
  assert.strictEqual(avatarOf({}), '');
  assert.strictEqual(fromTikTokUser({ userId: '1', uniqueId: 'ana', nickname: 'Ana', avatarThumb: { url: [PIC] } }).avatar, PIC);
});

test('game: round:votes dice quién acaba de responder (sin su voto) y el ranking lleva la foto', t => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'] });
  const sent = [];
  const game = createGame({
    emit: (ev, data) => sent.push([ev, data]),
    buildQuestion: () => ({ mode: 'flag', correctIndex: 1, correct: { flag: '🇪🇸', names: { es: 'España' } }, options: [] }),
    answerSeconds: 3,
    resultsSeconds: 2,
  });
  const ana = fromTikTokUser({ userId: '7001', uniqueId: 'ana', nickname: 'Ana', profilePictureUrl: PIC });
  const luis = fromTikTokUser({ userId: '7002', uniqueId: 'luis', nickname: 'Luis' });
  game.start({ totalRounds: 1 });
  game.vote(ana, 'b');
  game.vote(luis, 'a');
  game.vote(ana, 'c');   // segundo voto: no cuenta ni sale otra vez
  t.mock.timers.tick(500);
  const votes = sent.filter(([ev]) => ev === 'round:votes').map(([, d]) => d);
  assert.strictEqual(votes.length, 1);
  assert.deepStrictEqual(votes[0].recent, [{ nickname: 'Ana', avatar: PIC }, { nickname: 'Luis', avatar: '' }]);
  t.mock.timers.tick(500);
  assert.strictEqual(sent.filter(([ev]) => ev === 'round:votes').length, 1, 'sin votos nuevos no se reenvía');

  t.mock.timers.tick(3000);   // fin de la votación
  const results = sent.find(([ev]) => ev === 'round:results')[1];
  assert.deepStrictEqual(results.ranking[0], { nickname: 'Ana', points: 10, gained: 10, avatar: PIC });
  t.mock.timers.tick(2000);   // fin de los resultados de la única ronda
  const over = sent.find(([ev]) => ev === 'game:over')[1];
  assert.strictEqual(over.ranking[0].avatar, PIC);
});

test('game: los puntos van por el orden de TikTok (createTime), no por el de llegada al servidor', t => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: 1_000_000 });
  const sent = [];
  const game = createGame({
    emit: (ev, data) => sent.push([ev, data]),
    buildQuestion: () => ({ mode: 'flag', correctIndex: 1, correct: { flag: '🇪🇸', names: { es: 'España' } }, options: [] }),
    answerSeconds: 3,
    resultsSeconds: 2,
  });
  const ana = fromTikTokUser({ userId: '7001', uniqueId: 'ana', nickname: 'Ana' });
  const luis = fromTikTokUser({ userId: '7002', uniqueId: 'luis', nickname: 'Luis' });
  const eva = fromTikTokUser({ userId: '7003', uniqueId: 'eva', nickname: 'Eva' });
  const ends = [];
  game.events.on('roundEnd', e => ends.push(e));
  game.start({ totalRounds: 1 });
  game.vote(ana, 'b', 5_000_300);    // llega la primera, pero TikTok la recibió la última
  game.vote(luis, 'b', 5_000_100);
  game.vote(eva, 'c', 5_000_500);    // Eva: primero "c"...
  game.vote(eva, 'b', 5_000_050);    // ...pero este "b" lo recibió TikTok antes: es su primer voto
  game.vote(luis, 'a', 5_000_900);   // segundo voto de Luis, posterior: no cuenta
  t.mock.timers.tick(3000);
  const results = sent.find(([ev]) => ev === 'round:results')[1];
  assert.deepStrictEqual(results.winners, [
    { nickname: 'Eva', points: 10 }, { nickname: 'Luis', points: 8 }, { nickname: 'Ana', points: 6 }]);
  assert.deepStrictEqual(results.counts, [0, 3, 0, 0]);
  const at = ends[0].votes.find(([pid]) => pid === ana.pid)[1].at;
  assert.strictEqual(at, 1_000_000, 'la hora de llegada (reloj del PC) se guarda para las estadísticas');
});

test('tiktok: createTime de v2 (common) y v1 (aplanado), en ms', () => {
  const { createTimeOf } = require('../server/src/tiktok');
  assert.strictEqual(createTimeOf({ common: { createTime: '1794408826045' } }), 1794408826045);
  assert.strictEqual(createTimeOf({ createTime: '1794408826045' }), 1794408826045);
  assert.strictEqual(createTimeOf({ createTime: '1794408826' }), 1794408826000);
  assert.strictEqual(createTimeOf({ common: { createTime: '0' } }), 0);
  assert.strictEqual(createTimeOf({}), 0);
});

test('game: no cuentan los votos escritos antes de empezar la ronda (historial que TikTok reenvía al reconectar)', t => {
  // Reloj del PC 3 s por delante del de TikTok; la red tarda 0,8 s
  const SKEW = 3000;
  const LAT = 800;
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: 2_000_000 });
  const sent = [];
  const game = createGame({
    emit: (ev, data) => sent.push([ev, data]),
    buildQuestion: () => ({ mode: 'flag', correctIndex: 1, correct: { flag: '🇪🇸', names: { es: 'España' } }, options: [] }),
    answerSeconds: 10,
    resultsSeconds: 2,
  });
  const user = (id, name) => fromTikTokUser({ userId: id, uniqueId: name, nickname: name });
  const [ana, luis, eva, leo] = [user('1', 'Ana'), user('2', 'Luis'), user('3', 'Eva'), user('4', 'Leo')];
  const tiktokNow = () => Date.now() - SKEW;
  game.vote(leo, 'hola', tiktokNow() - LAT);   // chat antes de la partida: sirve para medir el desfase
  t.mock.timers.tick(1000);
  game.start({ totalRounds: 1 });
  const startTikTok = tiktokNow();
  t.mock.timers.tick(4000);
  game.vote(ana, 'b', startTikTok - 90_000);   // "b" de hace minutos, reenviada al reconectar
  game.vote(luis, 'b', startTikTok - 2000);    // escrita durante los resultados de la ronda anterior
  game.vote(eva, 'b', tiktokNow() - LAT);      // voto de verdad
  game.vote(ana, 'b', tiktokNow() - LAT + 100);   // Ana vuelve a votar ya en la ronda: ahora sí cuenta
  t.mock.timers.tick(10_000);
  const results = sent.find(([ev]) => ev === 'round:results')[1];
  assert.deepStrictEqual(results.winners.map(w => w.nickname), ['Eva', 'Ana']);
  assert.strictEqual(results.totalVotes, 2);
});

test('game: sin mensajes con los que medir el desfase, el voto se acepta', t => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: 2_000_000 });
  const sent = [];
  const game = createGame({
    emit: (ev, data) => sent.push([ev, data]),
    buildQuestion: () => ({ mode: 'flag', correctIndex: 0, correct: { flag: '🇪🇸', names: { es: 'España' } }, options: [] }),
    answerSeconds: 3,
    resultsSeconds: 2,
  });
  game.start({ totalRounds: 1 });
  game.vote(fromTikTokUser({ userId: '1', uniqueId: 'ana', nickname: 'Ana' }), 'a', 1_000);
  t.mock.timers.tick(3000);
  assert.strictEqual(sent.find(([ev]) => ev === 'round:results')[1].totalVotes, 1);
});
