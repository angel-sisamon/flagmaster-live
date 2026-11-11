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
  const user = (id, name) => fromTikTokUser({ userId: id, uniqueId: name, nickname: name });
  const [ana, luis, eva, leo] = [user('1', 'Ana'), user('2', 'Luis'), user('3', 'Eva'), user('4', 'Leo')];
  game.start({ totalRounds: 1 });
  game.vote(ana, 'b', 5_000_300);   // llega la primera, pero TikTok la recibió la última
  game.vote(luis, 'b', 5_000_100);
  game.vote(eva, 'b', 5_000_100);   // mismo milisegundo que Luis: va detrás (llegó después)
  game.vote(leo, 'b');              // sin createTime (voto de prueba): cuenta y se ordena por la llegada
  t.mock.timers.tick(3000);
  const results = sent.find(([ev]) => ev === 'round:results')[1];
  assert.deepStrictEqual(results.winners.map(w => w.nickname), ['Leo', 'Luis', 'Eva', 'Ana']);
  assert.strictEqual(results.totalVotes, 4, 'cuentan todos los votos que llegan durante la votación');
});

test('tiktok: createTime de v2 (common) y v1 (aplanado)', () => {
  const { createTimeOf } = require('../server/src/tiktok');
  assert.strictEqual(createTimeOf({ common: { createTime: '1794408826045' } }), 1794408826045);
  assert.strictEqual(createTimeOf({ createTime: '1794408826045' }), 1794408826045);
  assert.strictEqual(createTimeOf({ common: { createTime: '0' } }), 0);
  assert.strictEqual(createTimeOf({}), 0);
  assert.strictEqual(createTimeOf(null), 0);
});
