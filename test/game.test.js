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
