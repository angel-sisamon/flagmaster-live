'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { detectGreeting, createCountryMatcher, loadPhrases, createPhrasePicker, CATEGORIES } = require('../server/src/chatbot/brain');
const { isAllowed } = require('../server/src/chatbot/content-filter');
const { createSendQueue } = require('../server/src/chatbot/queue');
const { createChatBot } = require('../server/src/chatbot');
const { fromTikTokUser } = require('../server/src/identity');

const PHRASES_DIR = path.join(__dirname, '..', 'server', 'src', 'chatbot', 'phrases');
const COUNTRIES = [
  { code: 'ES', names: { es: 'España', en: 'Spain', fr: 'Espagne', pt: 'Espanha' } },
  { code: 'CI', names: { es: 'Costa de Marfil', en: 'Ivory Coast', fr: "Côte d'Ivoire", pt: 'Costa do Marfim' } },
];
const ana = fromTikTokUser({ userId: '7001', uniqueId: 'ana', nickname: 'Ana' });
const host = fromTikTokUser({ userId: '1', uniqueId: 'flagmaster', nickname: 'FlagMaster' });

test('todas las frases de todos los idiomas pasan el filtro y no hay pocas', () => {
  for (const file of fs.readdirSync(PHRASES_DIR).filter(f => f.endsWith('.json'))) {
    const json = JSON.parse(fs.readFileSync(path.join(PHRASES_DIR, file), 'utf8'));
    for (const cat of CATEGORIES) {
      for (const p of json[cat] || []) assert.ok(isAllowed(p.replace(/\{user\}/g, '')), `${file} ${cat}: ${p}`);
    }
  }
  const dropped = [];
  const en = loadPhrases('en', { log: m => dropped.push(m) });
  assert.deepStrictEqual(dropped, []);
  assert.ok(en.idle_chat.length >= 50);
  assert.ok(en.greetings.length >= 30 && en.greetings.every(p => p.includes('{user}')));
  assert.ok(en.game_rules_reminder.length >= 20);
});

test('el filtro veta pedir likes, follows, compartir, regalos y enlaces', () => {
  for (const bad of ['Tap tap the screen!', 'Drop some likes', 'Follow for more', 'share the live with friends',
    'send a rose', 'link in bio', 'dale like', 'sígueme', 'compartid el directo', 'subscribe', 'www.web.com']) {
    assert.ok(!isAllowed(bad), bad);
  }
  for (const ok of ['That flag looks like Chad', 'Which flag do you like most?', 'Fun fact: Nepal 🇳🇵']) assert.ok(isAllowed(ok), ok);
});

test('reconoce saludos en varios idiomas, no frases largas ni votos', () => {
  for (const s of ['hola', 'Holaaa!! 👋', 'buenas noches', 'qué tal', 'hey', 'HELLO', 'hi everyone', 'bonjour',
    'oi', 'good evening', 'hola a todos desde méxico', 'yo']) assert.ok(detectGreeting(s), s);
  for (const s of ['a', 'B', 'hiper difícil', 'yo creo que es la b', 'hey can you explain how the game works please?',
    'heyyou', '', 'España']) assert.ok(!detectGreeting(s), s);
});

test('reconoce el nombre de un país en cualquier idioma, con o sin acentos', () => {
  const match = createCountryMatcher(COUNTRIES);
  assert.strictEqual(match('España'), 'ES');
  assert.strictEqual(match('  espana!! '), 'ES');
  assert.strictEqual(match('🇪🇸 Spain'), 'ES');
  assert.strictEqual(match("cote d'ivoire"), 'CI');
  assert.strictEqual(match('es España'), null);
  assert.strictEqual(match('C'), null);
});

test('el selector de frases no repite hasta agotarlas y rellena {user}', () => {
  const pick = createPhrasePicker({ greetings: ['Hi {user}', 'Hey {user}', 'Yo {user}'] });
  const seen = new Set([pick('greetings', { user: '@ana' }), pick('greetings', { user: '@ana' }), pick('greetings', { user: '@ana' })]);
  assert.deepStrictEqual([...seen].sort(), ['Hey @ana', 'Hi @ana', 'Yo @ana']);
  assert.strictEqual(pick('nada'), null);
});

/* Reloj y esperas falsos: la cola corre al instante y se puede comprobar el ritmo */
function fakeTime() {
  const t = { now: 1_000_000 };
  return {
    t,
    now: () => t.now,
    sleep: async ms => { t.now += ms; await new Promise(setImmediate); },
  };
}

const flush = async () => { for (let i = 0; i < 50; i++) await new Promise(setImmediate); };

test('la cola envía de uno en uno, por prioridad, con pausas, y tira lo caducado', async () => {
  const clock = fakeTime();
  const sent = [];
  const q = createSendQueue({
    send: async text => { sent.push({ text, at: clock.t.now }); return true; },
    minGapMs: 5000, maxGapMs: 5000, thinkMs: [1000, 1000], maxPerMinute: 10, maxSize: 3,
    now: clock.now, sleep: clock.sleep, random: () => 0,
  });
  q.pause();
  q.start();
  q.push({ kind: 'idle', text: 'idle', priority: 0, ttlMs: 60000 });
  q.push({ kind: 'greeting', text: 'hi ana', priority: 2, ttlMs: 60000 });
  q.push({ kind: 'rules', text: 'letter!', priority: 3, ttlMs: 60000 });
  q.push({ kind: 'old', text: 'stale', priority: 1, ttlMs: 1 });    // cola llena: se descarta lo menos importante
  assert.strictEqual(q.size(), 3);
  q.resume();
  await flush();
  q.stop();
  assert.deepStrictEqual(sent.map(s => s.text), ['letter!', 'hi ana']);   // 'idle' no cupo y 'stale' caducó
  assert.ok(sent[1].at - sent[0].at >= 6000, 'pausa entre mensajes + tiempo de pensar');
});

test('la cola respeta el tope de mensajes por minuto', async () => {
  const clock = fakeTime();
  const sent = [];
  const q = createSendQueue({
    send: async text => { sent.push(clock.t.now); return true; },
    minGapMs: 0, maxGapMs: 0, thinkMs: [0, 0], maxPerMinute: 2, maxSize: 10,
    now: clock.now, sleep: clock.sleep, random: () => 0,
  });
  for (let i = 0; i < 3; i++) q.push({ text: `m${i}`, ttlMs: 10 * 60000 });
  q.start();
  await flush();
  q.stop();
  assert.strictEqual(sent.length, 3);
  assert.ok(sent[2] - sent[0] >= 60000);
});

function makeBot(opts) {
  const sent = [];
  const clock = fakeTime();
  const bot = createChatBot(Object.assign({
    sender: { name: 'test', start: async () => {}, send: async text => { sent.push(text); return true; }, close: async () => {} },
    account: 'flagmaster',
    countries: COUNTRIES,
    queueOptions: { minGapMs: 0, maxGapMs: 0, thinkMs: [0, 0], sleep: clock.sleep, maxPerMinute: 100 },
    now: clock.now,
    log: () => {},
  }, opts));
  return { bot, sent, clock };
}

test('bot: saluda una vez por persona, recuerda la letra en plena votación e ignora a quien emite', async () => {
  let phase = 'answer';
  const { bot, sent } = makeBot({ getPhase: () => phase });
  await bot.start();
  bot.onChat(ana, 'hola!!');
  bot.onChat(ana, 'hola otra vez');
  bot.onChat(ana, 'España');
  bot.onChat(host, 'hola a todos');
  await flush();
  assert.strictEqual(sent.length, 2);
  assert.ok(sent.every(s => s.includes('@ana')));
  assert.strictEqual(bot.status().greetings, 1);
  assert.strictEqual(bot.status().reminders, 1);

  // Su propio mensaje vuelve por el chat: se reconoce para no contarlo
  assert.ok(bot.isOwnMessage(host, sent[0]));
  assert.ok(!bot.isOwnMessage(ana, sent[0]));

  // Fuera de la votación el nombre de un país es charla normal
  phase = 'results';
  const luis = fromTikTokUser({ userId: '7002', uniqueId: 'luis', nickname: 'Luis' });
  bot.onChat(luis, 'Spain');
  await flush();
  assert.strictEqual(sent.length, 2);
  await bot.stop();
});

test('bot: en pausa no responde y no saluda a quien está vetado', async () => {
  const { bot, sent } = makeBot({ isHidden: p => p.u === 'ana' });
  await bot.start();
  bot.onChat(ana, 'hello');
  const eva = fromTikTokUser({ userId: '7003', uniqueId: 'eva', nickname: 'Eva' });
  bot.pause();
  bot.onChat(eva, 'hello');
  bot.resume();
  await flush();
  assert.deepStrictEqual(sent, []);
  await bot.stop();
});

test('bot: reacciona a una ronda muy difícil', async () => {
  const { bot, sent } = makeBot({ random: () => 0 });
  await bot.start();
  const votes = [1, 2, 3, 4].map(i => [`p${i}`, { index: i === 1 ? 0 : 2 }]);
  bot.onRoundEnd({ question: { correctIndex: 0 }, votes });
  await flush();
  assert.strictEqual(sent.length, 1);
  assert.strictEqual(bot.status().rounds, 1);
  await bot.stop();
});

test('panel de sugerencias: propone con contexto, "Otra" cambia la frase y lo pegado se marca como enviado', async () => {
  const { createSuggestSender } = require('../server/src/chatbot/senders');
  const events = [];
  const sender = createSuggestSender({ emit: (event, payload) => events.push([event, payload]) });
  const { bot } = makeBot({ sender });
  await bot.start();
  bot.onChat(ana, 'holaaa');
  await flush();
  const [first] = bot.history();
  assert.strictEqual(first.kind, 'greeting');
  assert.deepStrictEqual(first.meta, { category: 'greetings', user: '@ana', trigger: 'holaaa', vars: { user: '@ana' } });
  assert.ok(first.text.includes('@ana'));

  assert.ok(bot.reroll(first.id));
  const [, update] = events.find(([e]) => e === 'bot:update');
  assert.notStrictEqual(update.text, first.meta.trigger);
  assert.ok(update.text.includes('@ana'));

  // Quien emite pega la frase: vuelve por el chat desde su cuenta → enviada y no cuenta como mensaje
  assert.ok(bot.isOwnMessage(host, update.text));
  assert.ok(events.some(([e, p]) => e === 'bot:used' && p.id === first.id));
  assert.ok(bot.history()[0].used);
  await bot.stop();
});

test('Studio: sin CHAT_X / CHAT_Y no toca el ratón y explica qué falta', async () => {
  const { createStudioPaster, StudioError } = require('../server/src/chatbot/studio');
  const studio = createStudioPaster({ x: NaN, y: 500, log: () => {} });
  await assert.rejects(studio.sendChatMessage('Hello chat!'), err => err instanceof StudioError && err.stage === 'configuración' && /CHAT_X/.test(err.message));
  // El siguiente envío no se queda bloqueado por el fallo anterior
  await assert.rejects(studio.sendChatMessage('again'), StudioError);
});

/* Teclado y caja de chat de mentira: lo tecleado, lo pegado y los Retroceso acaban en `box` */
function fakeKeyboard() {
  const kb = { box: [], sent: [], clip: 'lo que había', mouse: { x: 0, y: 0 }, modifier: false };
  kb.robot = {
    setMouseDelay() {}, setKeyboardDelay() {},
    getMousePos: () => ({ ...kb.mouse }),
    moveMouse(x, y) { kb.mouse = { x, y }; },
    mouseToggle() {},
    keyToggle(key, dir) { kb.modifier = dir === 'down'; },
    typeString(s) { kb.box.push(s); },
    keyTap(key) {
      if (key === 'backspace') kb.box.pop();
      else if (key === 'enter') { kb.sent.push(kb.box.join('')); kb.box = []; }
      else if (key === 'v' && kb.modifier) kb.box.push(kb.clip);
    },
  };
  kb.clipboard = { read: async () => kb.clip, write: async t => { kb.clip = t; } };
  return kb;
}

test('Studio: al teclear con errores, los corrige y lo enviado es el texto exacto', async () => {
  const { createStudioPaster } = require('../server/src/chatbot/studio');
  const kb = fakeKeyboard();
  let seed = 7;
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const studio = createStudioPaster({
    x: 100, y: 200, settings: { method: 'type', typoPct: 30, typoLateMax: 3 }, log: () => {},
    robot: kb.robot, clipboard: kb.clipboard, windows: () => null, sleep: async () => {}, random,
  });
  const text = 'Welcome @Ana_99, vote with the letter: A, B, C or D!';
  const report = await studio.sendChatMessage(text);
  assert.deepStrictEqual(kb.sent, [text]);
  assert.ok(report.typos > 0, 'con un 30 % tiene que haber fallado alguna letra');
  assert.deepStrictEqual(kb.mouse, { x: 0, y: 0 });   // el ratón vuelve a su sitio

  // Sin errores: ni un Retroceso
  studio.setSettings({ typoPct: 0 });
  const r2 = await studio.sendChatMessage('Second message');
  assert.strictEqual(r2.typos, 0);
  assert.deepStrictEqual(kb.sent, [text, 'Second message']);

  // Pegando: el texto entero de golpe
  studio.setSettings({ method: 'paste' });
  await studio.sendChatMessage('Third one');
  assert.strictEqual(kb.sent[2], 'Third one');
});

test('Studio: los ajustes del panel se validan (rangos ordenados, límites, basura ignorada)', () => {
  const { normalizeSettings, DEFAULT_SETTINGS, createStudioPaster } = require('../server/src/chatbot/studio');
  const s = normalizeSettings({ method: 'robot', keyMs: [300, 100], typoPct: 99, thinkPct: 'x', backspaceMs: [1, 2, 3], typoLateMax: -4, thinkMs: [0, 99999] });
  assert.strictEqual(s.method, DEFAULT_SETTINGS.method);
  assert.deepStrictEqual(s.keyMs, [100, 300]);
  assert.strictEqual(s.typoPct, 30);
  assert.strictEqual(s.thinkPct, DEFAULT_SETTINGS.thinkPct);
  assert.deepStrictEqual(s.backspaceMs, DEFAULT_SETTINGS.backspaceMs);
  assert.strictEqual(s.typoLateMax, 0);
  assert.deepStrictEqual(s.thinkMs, [0, 5000]);
  // CHAT_INPUT_METHOD sigue valiendo, y un cambio parcial no borra lo demás
  const studio = createStudioPaster({ x: 1, y: 1, method: 'type', log: () => {} });
  assert.strictEqual(studio.getSettings().method, 'type');
  const after = studio.setSettings({ typoPct: 2 });
  assert.strictEqual(after.method, 'type');
  assert.strictEqual(after.typoPct, 2);
  assert.deepStrictEqual(after.keyMs, DEFAULT_SETTINGS.keyMs);
});

test('Studio: reconoce la ventana de TikTok LIVE Studio por el ejecutable o el título', () => {
  const { isStudio, label } = require('../server/src/chatbot/win32');
  assert.ok(isStudio({ exe: 'TikTok LIVE Studio.exe', title: '' }));
  assert.ok(!isStudio({ exe: 'WindowsTerminal.exe', title: 'Prueba del chat de TikTok LIVE Studio' }));
  assert.ok(!isStudio({ exe: 'chrome.exe', title: 'Sugerencias del chat' }));
  assert.ok(!isStudio(null));
  assert.strictEqual(label({ exe: 'chrome.exe', title: 'Panel', pid: 1 }), '"Panel" (chrome.exe)');
});

test('bot: mensajes según el momento de la partida (inicio, mitad, recta final, última ronda, ganador)', async () => {
  const { bot, sent } = makeBot({ random: () => 0 });
  await bot.start();
  bot.onGameStart({ totalRounds: 10 });
  for (let round = 1; round <= 10; round++) bot.onRoundEnd({ round, question: { correctIndex: 0 }, votes: [] });
  bot.onGameEnd({ ranking: [['p1', { nickname: 'Ana', points: 42 }]] });
  await flush();
  // inicio + mitad (ronda 5) + quedan pocas (ronda 7) + última (tras la 9) + ganador
  assert.strictEqual(bot.status().game, 5);
  const history = sent.join(' | ');
  assert.ok(sent.at(-1).includes('Ana'), history);
  await bot.stop();
});

test('automático: envía por prioridad, alterna rachas y descansos, espera si estás usando el PC', async () => {
  const { createAutopilot } = require('../server/src/chatbot/autopilot');
  const t = { now: 1_000_000 };
  const sent = [];
  let idle = Infinity;
  const items = [
    { id: 1, kind: 'idle', text: 'idle', at: t.now },
    { id: 2, kind: 'greeting', text: 'hi', at: t.now },
    { id: 3, kind: 'idle', text: 'viejo', at: t.now - 10 * 60000 },   // caducado: no se envía
  ];
  const auto = createAutopilot({
    send: async s => { sent.push({ text: s.text, at: t.now }); s.studioSent = true; },
    pending: () => items, userIdleMs: () => idle, now: () => t.now, random: () => 0.6, log: () => {},
  });
  // random() = 0.6 → primer envío a los 4,4 s · rachas de 2 con 7,2 s entre ellos · luego descanso de 50 s
  auto.setEnabled(true);
  t.now += 2000;
  await auto.tick();
  assert.deepStrictEqual(sent, [], 'el primero no sale de golpe');
  t.now += 2400;
  idle = 500;                   // estás moviendo el ratón
  await auto.tick();
  assert.deepStrictEqual(sent, []);
  assert.strictEqual(auto.status().autoWaiting, 'usuario');
  idle = Infinity;
  await auto.tick();
  assert.deepStrictEqual(sent.map(s => s.text), ['hi'], 'por prioridad: el saludo antes que la charla');
  t.now += 7200;
  await auto.tick();
  assert.deepStrictEqual(sent.map(s => s.text), ['hi', 'idle'], 'segundo de la racha, enseguida');
  items.push({ id: 4, kind: 'idle', text: 'otra', at: t.now });
  t.now += 10000;
  await auto.tick();
  assert.strictEqual(sent.length, 2, 'tras la racha, descanso');
  assert.strictEqual(auto.status().autoWaiting, 'descanso');
  items.push({ id: 5, kind: 'rules', text: 'letter!', at: t.now });
  await auto.tick();
  assert.strictEqual(sent.at(-1).text, 'letter!', 'las normas no esperan al descanso');
  auto.setEnabled(false);
  assert.strictEqual(auto.status().auto, false);
  auto.stop();
});

test('sin emojis: ni en las frases ni en lo que se envía (Studio los pinta como una X)', () => {
  const { stripEmoji } = require('../server/src/chatbot/brain');
  const EMOJI = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}]/u;
  for (const file of fs.readdirSync(PHRASES_DIR).filter(f => f.endsWith('.json'))) {
    const json = JSON.parse(fs.readFileSync(path.join(PHRASES_DIR, file), 'utf8'));
    for (const cat of CATEGORIES) for (const p of json[cat] || []) assert.ok(!EMOJI.test(p), `${file} ${cat}: ${p}`);
  }
  assert.strictEqual(stripEmoji('Hey @ana 👋🏽! Spain 🇪🇸 is cool 👨‍👩‍👧'), 'Hey @ana! Spain is cool');
  const pick = createPhrasePicker({ idle_chat: ['Last round! 🔥'] });
  assert.strictEqual(pick('idle_chat'), 'Last round!');
});
