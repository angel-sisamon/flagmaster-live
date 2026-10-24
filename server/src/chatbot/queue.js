/**
 * server/src/chatbot/queue.js — Cola de envío: un mensaje cada vez y a ritmo humano.
 *
 * Cada mensaje lleva prioridad (sale antes el de más prioridad; a igualdad, el más antiguo) y caducidad: un
 * "¡hola @ana!" que lleva un minuto esperando ya no tiene sentido y se tira. Entre envíos se respeta una
 * pausa aleatoria (minGapMs..maxGapMs) y un tope por minuto; antes de escribir hay un rato de "pensar"
 * (thinkMs) y el propio sender teclea letra a letra. Si la cola se llena se descarta lo menos importante.
 *
 *   const q = createSendQueue({ send: async text => true, ... });
 *   q.push({ kind: 'greeting', text, priority: 2, ttlMs: 60000 });
 */

'use strict';

const rand = (min, max, random) => min + random() * Math.max(0, max - min);

function createSendQueue({
  send,
  minGapMs = 8000, maxGapMs = 15000,
  thinkMs = [1200, 4000],
  maxPerMinute = 4,
  maxSize = 5,
  random = Math.random,
  now = Date.now,
  sleep = ms => new Promise(r => setTimeout(r, ms)),
  log = () => {},
}) {
  const items = [];
  const sentAt = [];      // instantes de los últimos envíos (tope por minuto)
  let nextAllowedAt = 0;
  let lastSentAt = 0;
  let running = false;
  let paused = false;
  let wake = null;
  let seq = 0;

  function dropExpired() {
    const t = now();
    for (let i = items.length - 1; i >= 0; i--) {
      if (items[i].expiresAt <= t) log(`⌛ caduca (${items[i].kind}): ${items.splice(i, 1)[0].text}`);
    }
  }

  function byPriority(a, b) {
    return b.priority - a.priority || a.seq - b.seq;
  }

  function push({ kind = 'misc', text, priority = 0, ttlMs = 60000, meta = null }) {
    if (!text) return false;
    dropExpired();
    items.push({ kind, text, priority, meta, seq: seq++, expiresAt: now() + ttlMs });
    items.sort(byPriority);
    while (items.length > maxSize) log(`🗑️  cola llena, se descarta (${items[items.length - 1].kind}): ${items.pop().text}`);
    if (wake) wake();
    return items.some(i => i.text === text);
  }

  async function waitTurn() {
    for (;;) {
      const t = now();
      while (sentAt.length && t - sentAt[0] >= 60000) sentAt.shift();
      const perMinuteAt = sentAt.length >= maxPerMinute ? sentAt[0] + 60000 : 0;
      const at = Math.max(nextAllowedAt, perMinuteAt);
      if (at <= t) return;
      await sleep(at - t);
    }
  }

  async function loop() {
    while (running) {
      dropExpired();
      if (paused || !items.length) {
        await new Promise(r => { wake = r; });
        wake = null;
        continue;
      }
      await waitTurn();
      await sleep(rand(thinkMs[0], thinkMs[1], random));
      dropExpired();
      const item = items.shift();
      if (!item || paused) { if (item) items.unshift(item); continue; }
      let ok = false;
      try { ok = await send(item.text, item); } catch (err) { log(`⚠️  error al enviar: ${err.message}`); }
      const t = now();
      sentAt.push(t);
      lastSentAt = t;
      nextAllowedAt = t + rand(minGapMs, maxGapMs, random);
      if (ok) log(`💬 (${item.kind}) ${item.text}`);
    }
  }

  return {
    push,
    start() { if (!running) { running = true; loop(); } },
    stop() { running = false; if (wake) wake(); },
    pause() { paused = true; },
    resume() { paused = false; if (wake) wake(); },
    clear() { items.length = 0; },
    size: () => items.length,
    has: kind => items.some(i => i.kind === kind),
    isPaused: () => paused,
    msSinceLastSend: () => (lastSentAt ? now() - lastSentAt : Infinity),
  };
}

module.exports = { createSendQueue };
