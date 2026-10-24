/**
 * server/src/chatbot/index.js — Bot que anima el chat del directo (opcional: CHATBOT=1 en .env).
 *
 * Escucha el mismo chat que el juego (handleChat de server/index.js) y responde por orden de prioridad:
 *   3. Nombre de un país en plena votación → recuerda que hay que escribir la letra (una vez por persona cada
 *      REMIND_USER_MS, y como mucho un recordatorio cada REMIND_GAP_MS: uno ya lo lee todo el chat).
 *   2. Saludo ("hola", "hey", "bonjour"...) → saluda a esa persona por su @ (una vez por directo).
 *   1. Momentos de la partida: empieza, va por la mitad, quedan pocas rondas, última ronda, gana fulano.
 *      Si no toca ninguno, a veces una reacción a una ronda muy difícil o muy fácil.
 *   0. Si nadie ha dicho nada en idleSeconds (45-90 s, aleatorio) → frase suelta, curiosidad o pregunta.
 * Todo pasa por la cola (queue.js), que marca el ritmo, y por content-filter.js, que veta pedir likes,
 * follows, compartir o regalos. Lo que sale va al panel de sugerencias (senders.js): quien emite lo pega en el
 * chat con su cuenta (CHATBOT_ACCOUNT, por defecto la del directo). Al volver por el chat se marca como usado.
 */

'use strict';

const { normalize, detectGreeting, createCountryMatcher, loadPhrases, createPhrasePicker } = require('./brain');
const { createSendQueue } = require('./queue');
const { isAllowed } = require('./content-filter');

const PRIORITY = { rules: 3, greeting: 2, game: 1, round: 1, idle: 0 };
const TTL_MS = { rules: 20000, greeting: 60000, game: 30000, round: 15000, idle: 20000 };
const REMIND_USER_MS = 10 * 60 * 1000;
const REMIND_GAP_MS = 25000;
const ECHO_MS = 3 * 60 * 1000;          // el mensaje del bot vuelve por el chat: se reconoce y se ignora
const MIN_VOTES_FOR_REACTION = 3;
const HARD_PCT = 25;
const EASY_PCT = 85;
const MID_MIN_ROUNDS = 6;          // "vamos por la mitad" solo en partidas de al menos estas rondas
const STRETCH_MIN_ROUNDS = 8;      // "quedan pocas" (3 antes del final) solo en partidas largas
const STRETCH_ROUNDS_LEFT = 3;
const WINNER_CHANCE = 0.7;         // al acabar: felicitar a quien gana o un "GG" general

function createChatBot({
  sender,
  lang = 'en',
  account = '',
  countries = [],
  idleSeconds = [45, 90],
  getPhase = () => 'idle',
  isHidden = () => false,
  queueOptions = {},
  random = Math.random,
  now = Date.now,
  log = console.log,
}) {
  const phrases = loadPhrases(lang);
  const pick = createPhrasePicker(phrases, { random });
  const isCountryName = createCountryMatcher(countries);
  const accountHandle = String(account || '').replace(/^@/, '').toLowerCase();
  const greeted = new Set();
  const reminded = new Map();      // pid -> último recordatorio
  const recentSent = new Map();    // texto normalizado -> cuándo se envió
  let lastReminderAt = 0;
  let totalRounds = 0;             // de la partida en curso (0 = sin límite)
  let idleTimer = null;
  let running = false;
  const stats = { greetings: 0, reminders: 0, rounds: 0, game: 0, idle: 0, sent: 0, failed: 0, lastError: '' };

  const queue = createSendQueue({
    random, now, log,
    ...queueOptions,
    async send(text, item) {
      if (!isAllowed(text)) { log(`🚫 Chatbot: mensaje bloqueado por el filtro: ${text}`); return false; }
      recentSent.set(normalize(text), now());
      let ok = false;
      try { ok = await sender.send(text, item); } catch (err) {
        stats.lastError = err.message.split('\n')[0];
        log(`⚠️  Chatbot: no se pudo enviar (${stats.lastError})`);
      }
      stats[ok ? 'sent' : 'failed']++;
      return ok;
    },
  });

  const mention = user => (user.handle ? '@' + user.handle : user.nickname);

  /* opts: { user, trigger: lo que escribió, vars: variables extra como { winner } } */
  function enqueue(kind, category, { user, trigger, vars } = {}) {
    const allVars = { ...vars, ...(user ? { user: mention(user) } : {}) };
    const text = pick(category, allVars);
    if (!text) return false;
    // meta: para el panel (a quién y por qué) y para el botón "Otra"
    const meta = { category, user: user ? mention(user) : '', trigger: trigger || '', vars: allVars };
    return queue.push({ kind, text, priority: PRIORITY[kind], ttlMs: TTL_MS[kind], meta });
  }

  function isOwnMessage(user, text) {
    if (!user) return false;
    if (accountHandle && String(user.handle || '').toLowerCase() !== accountHandle) return false;
    const t = now();
    for (const [k, at] of recentSent) if (t - at > ECHO_MS) recentSent.delete(k);
    if (!recentSent.has(normalize(text))) return false;
    if (sender.markUsed) sender.markUsed(text, normalize);
    return true;
  }

  /* Botón "Otra" del panel: otra frase de la misma categoría para la misma persona */
  function reroll(id) {
    const s = sender.find && sender.find(id);
    if (!s || !s.meta) return false;
    const text = pick(s.meta.category, s.meta.vars || (s.meta.user ? { user: s.meta.user } : undefined));
    if (!text || !isAllowed(text)) return false;
    recentSent.set(normalize(text), now());
    return sender.update(id, text);
  }

  function onChat(user, text) {
    if (!running || !user || queue.isPaused()) return;
    if (accountHandle && String(user.handle || '').toLowerCase() === accountHandle) return;   // quien emite
    if (isHidden({ id: user.pid, u: user.handle })) return;
    const t = now();

    if (getPhase() === 'answer' && isCountryName(text)) {
      if (t - (reminded.get(user.pid) || 0) < REMIND_USER_MS || t - lastReminderAt < REMIND_GAP_MS) return;
      if (enqueue('rules', 'game_rules_reminder', { user, trigger: text })) {
        reminded.set(user.pid, t);
        lastReminderAt = t;
        stats.reminders++;
      }
      return;
    }

    if (!greeted.has(user.pid) && detectGreeting(text)) {
      greeted.add(user.pid);   // aunque la cola lo descarte: no se le saluda dos veces
      if (enqueue('greeting', 'greetings', { user, trigger: text })) stats.greetings++;
    }
  }

  function gameMoment(category) {
    if (!enqueue('game', category)) return false;
    stats.game++;
    return true;
  }

  /* Eventos de game.js: 'gameStart' { totalRounds }, 'roundEnd' { round, question, votes }, 'gameEnd' { ranking } */
  function onGameStart({ totalRounds: total } = {}) {
    totalRounds = Number(total) || 0;
    if (running) gameMoment('game_start');
  }

  /* Tras la ronda `round`: ¿toca un momento de la partida? (el siguiente mensaje se lee durante la ronda siguiente) */
  function momentAfter(round) {
    const t = totalRounds;
    if (!t) return null;
    if (t >= MID_MIN_ROUNDS && round === Math.ceil(t / 2)) return 'game_mid';
    if (t >= STRETCH_MIN_ROUNDS && round === t - STRETCH_ROUNDS_LEFT) return 'game_final_stretch';
    if (t >= 3 && round === t - 1) return 'game_last_round';
    return null;
  }

  function onRoundEnd({ round, question, votes }) {
    if (!running) return;
    const moment = momentAfter(Number(round) || 0);
    if (moment && gameMoment(moment)) return;          // un mensaje por ronda como mucho
    if (totalRounds && round >= totalRounds) return;   // la última: ya viene el de fin de partida
    if (!question || !votes || votes.length < MIN_VOTES_FOR_REACTION) return;
    const pct = (votes.filter(([, v]) => v.index === question.correctIndex).length / votes.length) * 100;
    const category = pct <= HARD_PCT ? 'round_hard' : pct >= EASY_PCT ? 'round_easy' : null;
    const chance = category === 'round_hard' ? 0.5 : 0.35;
    if (category && random() < chance && enqueue('round', category)) stats.rounds++;
  }

  function onGameEnd({ ranking } = {}) {
    if (!running) return;
    const [pid, best] = (ranking && ranking[0]) || [];
    const winner = best && best.points > 0 && !isHidden({ id: pid }) ? best.nickname : '';
    if (winner && random() < WINNER_CHANCE && enqueue('game', 'game_end_winner', { vars: { winner } })) stats.game++;
    else gameMoment('game_end');
    totalRounds = 0;
  }

  function scheduleIdle() {
    clearTimeout(idleTimer);
    if (!running) return;
    const [min, max] = idleSeconds;
    const ms = (min + random() * Math.max(0, max - min)) * 1000;
    idleTimer = setTimeout(() => {
      // Solo si el bot lleva un rato callado y no hay nada más importante esperando
      if (!queue.isPaused() && !queue.size() && queue.msSinceLastSend() >= min * 1000 && enqueue('idle', 'idle_chat')) stats.idle++;
      scheduleIdle();
    }, ms);
    if (idleTimer.unref) idleTimer.unref();
  }

  async function start() {
    if (running) return;
    running = true;
    const counts = Object.entries(phrases).map(([k, v]) => `${k}×${v.length}`).join(', ');
    log(`🤖 Chatbot (${sender.name}, ${lang}${accountHandle ? `, lo pega @${accountHandle}` : ''}): ${counts}`);
    queue.start();
    scheduleIdle();
    try { await sender.start(); } catch (err) {
      log(`⚠️  Chatbot: no se pudo abrir el envío (${err.message}). Se reintentará con el primer mensaje.`);
    }
  }

  async function stop() {
    running = false;
    clearTimeout(idleTimer);
    queue.stop();
    await sender.close();
  }

  function status() {
    return { enabled: running, paused: queue.isPaused(), sender: sender.name, lang, queued: queue.size(), ...stats };
  }

  return {
    start, stop, onChat, onGameStart, onRoundEnd, onGameEnd, isOwnMessage, status, reroll,
    history: () => (sender.history ? sender.history() : []),
    find: id => (sender.find ? sender.find(id) : null),
    pause: () => queue.pause(),
    resume: () => queue.resume(),
    say: text => queue.push({ kind: 'manual', text: String(text || '').trim(), priority: 4, ttlMs: 60000 }),
  };
}

module.exports = { createChatBot };
