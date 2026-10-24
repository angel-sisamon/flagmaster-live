/**
 * server/src/chatbot/autopilot.js — Envío automático a TikTok LIVE Studio (botón Manual / Automático del panel).
 *
 * Con el automático puesto, las sugerencias del panel se escriben solas en Studio, sin un ritmo fijo: a veces una,
 * a veces dos o tres seguidas (BURST_GAP_MS entre ellas) y luego un descanso (REST_MS, a veces uno largo). Un
 * recordatorio de normas no espera al descanso (la ronda dura 20 s), solo RULES_GAP_MS. Lo que lleva demasiado
 * tiempo esperando (MAX_AGE_MS) ya no se envía.
 *
 * Seguridad: arranca siempre en manual; no envía si has tocado el ratón o el teclado hace menos de USER_IDLE_MS
 * (espera a que lo sueltes); tras MAX_FAILURES fallos seguidos vuelve solo a manual.
 *
 *   const auto = createAutopilot({ send, pending, onChange });
 *   auto.setEnabled(true);
 */

'use strict';

const TICK_MS = 1000;
const PRIORITY = { manual: 4, rules: 3, greeting: 2, game: 1, round: 1, idle: 0 };
const MAX_AGE_MS = { rules: 20000, greeting: 75000, game: 30000, round: 20000, idle: 40000, manual: 120000 };
const FIRST_DELAY_MS = [2000, 6000];
const BURST_GAP_MS = [3000, 10000];       // entre mensajes de una misma racha
const REST_MS = [20000, 70000];           // descanso tras una racha
const LONG_REST_MS = [70000, 150000];
const LONG_REST_CHANCE = 0.15;
const RULES_GAP_MS = 5000;
const USER_IDLE_MS = 2500;
const MAX_FAILURES = 3;

/* Cuántos mensajes más tendrá la siguiente racha: casi siempre 0 o 1, a veces 2 */
function nextBurst(random) {
  const r = random();
  return r < 0.55 ? 0 : r < 0.9 ? 1 : 2;
}

/**
 * send(s)       envía la sugerencia s a Studio (promesa; lanza si falla)
 * pending()     sugerencias del panel: { id, kind, text, at, used, studioSent, discarded }
 * onChange()    algo ha cambiado (activado, enviado, fallo...): para refrescar el panel
 * userIdleMs()  ms desde la última vez que se tocó ratón o teclado (Infinity si no se sabe)
 */
function createAutopilot({
  send,
  pending,
  onChange = () => {},
  userIdleMs = () => Infinity,
  random = Math.random,
  now = Date.now,
  log = console.log,
  tickMs = TICK_MS,
}) {
  const state = { enabled: false, busy: false, nextAt: 0, lastSentAt: 0, burstLeft: 0, failures: 0, waiting: '', sent: 0 };
  const rand = ([min, max]) => min + random() * (max - min);
  let timer = null;

  function candidates(t) {
    return pending()
      .filter(s => !s.used && !s.studioSent && !s.discarded && t - s.at <= (MAX_AGE_MS[s.kind] || MAX_AGE_MS.idle))
      .sort((a, b) => (PRIORITY[b.kind] || 0) - (PRIORITY[a.kind] || 0) || a.at - b.at);
  }

  function setWaiting(why) {
    if (state.waiting === why) return;
    state.waiting = why;
    onChange();
  }

  function scheduleNext(t) {
    if (state.burstLeft > 0) {
      state.burstLeft--;
      state.nextAt = t + rand(BURST_GAP_MS);
    } else {
      state.burstLeft = nextBurst(random);
      state.nextAt = t + rand(random() < LONG_REST_CHANCE ? LONG_REST_MS : REST_MS);
    }
  }

  async function tick() {
    if (!state.enabled || state.busy) return;
    const t = now();
    const [next] = candidates(t);
    if (!next) return setWaiting('');
    const due = next.kind === 'rules' ? t - state.lastSentAt >= RULES_GAP_MS : t >= state.nextAt;
    if (!due) return setWaiting('descanso');
    if (userIdleMs() < USER_IDLE_MS) return setWaiting('usuario');

    state.busy = true;
    setWaiting('');
    try {
      await send(next);
      state.failures = 0;
      state.sent++;
    } catch (err) {
      state.failures++;
      log(`⚠️  Automático: no se pudo enviar (${err.message})`);
      if (state.failures >= MAX_FAILURES) {
        state.enabled = false;
        log(`⏸️  Automático desactivado tras ${MAX_FAILURES} fallos seguidos: vuelve a manual`);
      }
    } finally {
      state.busy = false;
      state.lastSentAt = now();
      scheduleNext(state.lastSentAt);
      onChange();
    }
  }

  function setEnabled(on) {
    on = !!on;
    if (on === state.enabled) return;
    state.enabled = on;
    state.failures = 0;
    if (on) {
      state.burstLeft = nextBurst(random);
      state.nextAt = now() + rand(FIRST_DELAY_MS);
      if (!timer) {
        timer = setInterval(() => { tick().catch(err => log(`⚠️  Automático: ${err.message}`)); }, tickMs);
        if (timer.unref) timer.unref();
      }
    }
    log(on ? '🤖 Envío automático a Studio ACTIVADO' : '✋ Envío automático a Studio desactivado (manual)');
    onChange();
  }

  return {
    setEnabled,
    tick,
    stop() { clearInterval(timer); timer = null; state.enabled = false; },
    status: () => ({
      auto: state.enabled,
      autoWaiting: state.enabled ? state.waiting : '',
      autoNextInMs: state.enabled ? Math.max(0, state.nextAt - now()) : 0,
      autoSent: state.sent,
    }),
  };
}

module.exports = { createAutopilot, nextBurst };
