/**
 * server/src/autoloop.js — Partidas en bucle (interruptor "🔁 Partidas en bucle" de la sala).
 *
 * Con el bucle activo, al acabar una partida empieza otra sola con las mismas rondas:
 *   podio (podiumSeconds) → sala con cuenta atrás (lobbySeconds) → partida nueva.
 * Sin límite de rondas (∞) no hay bucle: la partida no termina nunca.
 * Se para solo si nadie vota en maxEmptyGames partidas seguidas (p. ej. se ha caído la conexión con TikTok),
 * y quien emite lo para con el interruptor, "Terminar", "Salir" o cerrando todas las pantallas (server/index.js).
 *
 * Emite 'loop:status' { enabled, totalRounds, phase: 'idle'|'podium'|'lobby', remaining (s), stopped: ''|'empty' }.
 * onLobby() avisa al pasar a la sala (el bot del chat anuncia la siguiente partida).
 */

'use strict';

const MAX_TOTAL_ROUNDS = 2000;

function sanitizeRounds(n) {
  n = Math.floor(Number(n));
  return Number.isFinite(n) && n > 0 ? Math.min(n, MAX_TOTAL_ROUNDS) : 0;
}

function createAutoLoop({
  startGame,
  emit,
  podiumSeconds = 30,
  lobbySeconds = 10,
  maxEmptyGames = 2,
  onLobby = () => {},
  now = Date.now,
  log = console.log,
}) {
  const state = { enabled: false, totalRounds: 0, phase: 'idle', endsAt: 0, emptyGames: 0, stopped: '' };
  let timer = null;

  function payload() {
    return {
      enabled: state.enabled,
      totalRounds: state.totalRounds,
      phase: state.phase,
      remaining: state.phase === 'idle' ? 0 : Math.max(0, Math.ceil((state.endsAt - now()) / 1000)),
      stopped: state.stopped,
    };
  }

  const broadcast = () => emit('loop:status', payload());

  function clearPending() {
    clearTimeout(timer);
    timer = null;
    state.phase = 'idle';
    state.endsAt = 0;
  }

  function wait(phase, seconds, next) {
    clearTimeout(timer);
    state.phase = phase;
    state.endsAt = now() + seconds * 1000;
    timer = setTimeout(next, seconds * 1000);
    broadcast();
  }

  /* Interruptor de la sala: { enabled, totalRounds }. Apagarlo cancela la partida que estaba por venir */
  function set({ enabled, totalRounds } = {}) {
    const rounds = sanitizeRounds(totalRounds);
    if (rounds) state.totalRounds = rounds;
    const unlimited = totalRounds !== undefined && !rounds;   // ∞: la partida no termina, no hay bucle
    const on = !!enabled && !unlimited && state.totalRounds > 0;
    if (on && !state.enabled) { state.emptyGames = 0; state.stopped = ''; }
    if (on !== state.enabled) log(on ? `🔁 Partidas en bucle: sí (${state.totalRounds} rondas)` : '🔁 Partidas en bucle: no');
    state.enabled = on;
    if (!on) clearPending();
    broadcast();
  }

  /* Quien emite arranca a mano (o reanuda): lo que estuviera programado ya no hace falta */
  function onManualStart() {
    if (state.phase !== 'idle') { clearPending(); broadcast(); }
  }

  function startNext() {
    clearPending();
    if (!state.enabled) return broadcast();
    log(`🔁 Siguiente partida en bucle (${state.totalRounds} rondas)`);
    broadcast();
    startGame({ fresh: true, totalRounds: state.totalRounds });
  }

  /* game.js 'gameEnd' { participants }: programa la siguiente o se para si nadie juega */
  function onGameEnd({ participants } = {}) {
    if (!state.enabled) return;
    state.emptyGames = participants > 0 ? 0 : state.emptyGames + 1;
    if (state.emptyGames >= maxEmptyGames) {
      state.enabled = false;
      state.stopped = 'empty';
      clearPending();
      log(`🔁 Bucle detenido: nadie ha votado en ${state.emptyGames} partidas seguidas`);
      return broadcast();
    }
    wait('podium', podiumSeconds, () => {
      wait('lobby', lobbySeconds, startNext);
      try { onLobby(); } catch (err) { log(`⚠️  Bucle: ${err.message}`); }
    });
  }

  function stop() {
    clearPending();
    state.enabled = false;
  }

  return { set, onManualStart, onGameEnd, stop, status: payload, isEnabled: () => state.enabled };
}

module.exports = { createAutoLoop };
