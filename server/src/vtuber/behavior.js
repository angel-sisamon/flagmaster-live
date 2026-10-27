/**
 * server/src/vtuber/behavior.js — AvatarBehaviorManager: qué hace el avatar en cada momento, sin solaparse.
 *
 * Cada reacción llega con prioridad y duración:
 *   high    regalos, saludos, comandos del público, ganador: corta lo que esté haciendo
 *   medium  momentos de la partida (pregunta nueva, resultado de la ronda): la más reciente sustituye a la anterior
 *   low     reposo: cambia de postura, mira alrededor, se balancea... (cuando no hay nada más)
 *
 * Mientras suena la voz (avatar.isSpeaking) y no hay reacción en curso, acompaña con gestos de hablar.
 *
 * Una reacción de menos prioridad que la que está en curso se descarta, salvo que pida esperar (queue: true):
 * entonces espera su turno como mucho QUEUE_TTL_MS. Cada reacción tiene una clave (key) con cooldownMs para que
 * nada se repita sin parar (p. ej. una lluvia de regalos).
 *
 *   request({ priority, key, cooldownMs, ms, anim, face, gesture, look, queue })  → 'started' | 'queued' | 'cooldown' | 'busy'
 *   tick()   lo llama un intervalo (start): termina lo que caduca, saca lo que espera y mueve el reposo
 */

'use strict';

const LEVEL = { low: 1, medium: 2, high: 3 };
const MAX_QUEUE = 3;
const QUEUE_TTL_MS = 8000;
const IDLE_EVERY_MS = [2500, 6500];
const IDLE_GESTURE_CHANCE = 0.35;
const IDLE_GESTURES = ['tilt', 'lookAround', 'sway', 'think', 'hop', 'shrug'];
const TALK_EVERY_MS = [1600, 3400];
const TALK_GESTURES = ['nod', 'tilt', 'sway', 'laugh', 'shrug'];

function createBehavior({ avatar, now = Date.now, random = Math.random, tickMs = 100 }) {
  const lastByKey = new Map();
  const st = { current: null, queue: [], nextIdleAt: 0, nextTalkAt: 0, lastGesture: '', timer: null, paused: false, played: 0 };

  const rand = (a, b) => a + random() * (b - a);
  /* Un gesto de la lista que no sea el último que hizo */
  function pickGesture(list) {
    const options = list.filter(g => g !== st.lastGesture);
    st.lastGesture = options[Math.floor(random() * options.length) % options.length];
    return st.lastGesture;
  }

  function begin(a) {
    st.current = { ...a, endsAt: now() + (a.ms || 2000) };
    st.played++;
    if (a.face) avatar.face(a.face, true);
    if (a.anim) avatar.anim(a.anim);
    if (a.gesture) avatar.gesture(a.gesture);
    avatar.look(a.look || null);
  }

  function finish() {
    const a = st.current;
    if (!a) return;
    st.current = null;
    if (a.face) avatar.face(a.face, false);
    avatar.look(null);
    st.nextIdleAt = now() + rand(800, 1800);   // un respiro antes de volver al reposo
  }

  function request(action) {
    if (st.paused) return 'busy';
    const a = { priority: 'medium', ...action };
    const level = LEVEL[a.priority] || LEVEL.medium;
    const t = now();
    if (a.key && a.cooldownMs && t - (lastByKey.get(a.key) || -Infinity) < a.cooldownMs) return 'cooldown';
    const cur = st.current ? LEVEL[st.current.priority] : 0;
    if (level < cur || (level === cur && level === LEVEL.high)) {
      if (!a.queue) return 'busy';
      st.queue = st.queue.filter(q => q.key !== a.key || !a.key);
      st.queue.push({ ...a, level, expiresAt: t + QUEUE_TTL_MS });
      st.queue.sort((x, y) => y.level - x.level);
      if (st.queue.length > MAX_QUEUE) st.queue.length = MAX_QUEUE;
      if (a.key) lastByKey.set(a.key, t);
      return 'queued';
    }
    finish();
    if (a.key) lastByKey.set(a.key, t);
    begin(a);
    return 'started';
  }

  function tick() {
    const t = now();
    if (st.current && t >= st.current.endsAt) finish();
    if (!st.current) {
      st.queue = st.queue.filter(q => q.expiresAt > t);
      const next = st.queue.shift();
      if (next) return begin(next);
      if (avatar.isSpeaking()) {
        if (t >= st.nextTalkAt) {
          avatar.gesture(pickGesture(TALK_GESTURES));
          st.nextTalkAt = t + rand(TALK_EVERY_MS[0], TALK_EVERY_MS[1]);
        }
        return;
      }
      if (t >= st.nextIdleAt) {
        // Postura nueva: hacia dónde mira, algo de sonrisa y los brazos un poco distintos
        avatar.idle({ x: rand(-10, 10), y: rand(-4, 6), z: rand(-5, 5), smile: random() < 0.4 ? rand(0.2, 0.6) : 0, armL: rand(-0.2, 0.25), armR: rand(-0.2, 0.25) });
        if (random() < IDLE_GESTURE_CHANCE) avatar.gesture(pickGesture(IDLE_GESTURES));
        st.nextIdleAt = t + rand(IDLE_EVERY_MS[0], IDLE_EVERY_MS[1]);
      }
    }
  }

  return {
    request,
    tick,
    start() { if (!st.timer) st.timer = setInterval(tick, tickMs); },
    stop() { clearInterval(st.timer); st.timer = null; finish(); st.queue = []; },
    pause() { st.paused = true; finish(); st.queue = []; },
    resume() { st.paused = false; },
    status: () => ({
      paused: st.paused,
      current: st.current ? { priority: st.current.priority, key: st.current.key || '' } : null,
      queued: st.queue.length,
      played: st.played,
    }),
  };
}

module.exports = { createBehavior, LEVEL };
