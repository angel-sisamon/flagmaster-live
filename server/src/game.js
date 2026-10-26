/**
 * server/src/game.js — Partidas del directo.
 *
 * Una partida dura totalRounds rondas (lo elige quien emite en la sala; 0 = sin límite):
 * ANSWER_SECONDS de votación + RESULTS_SECONDS de resultados por ronda. ✕ / desconexión la pausan
 * (se puede reanudar); al acabar la última ronda o con "Terminar" pasa a 'over' y se emite game:over.
 * La siguiente partida empieza de cero.
 *
 * Puntos por orden de llegada entre quienes aciertan: 10, 8, 6, 5, 4, 3, 2 y luego 1; los fallos suman 0.
 * Empates en el ranking: va delante quien llegó antes a esa puntuación.
 *
 * Emite (EventEmitter) para el grabador y la clasificación mensual, sin saber nada de ellos:
 *   'gameStart' { number, totalRounds }
 *   'roundEnd'  { number, round, question, startedAt, votes: [[pid, voto]], gained: Map pid → puntos }
 *   'gameEnd'   { number, rounds, ranking: [[pid, { nickname, points }]] }
 *   'status'    (cambia algo de live:status)
 */

'use strict';

const EventEmitter = require('events');

const VOTES_BROADCAST_MS = 500;
const MAX_WINNERS_SENT = 500;   // la tabla de acertantes de la pantalla de resultados los enseña todos
const POSITION_POINTS = [10, 8, 6, 5, 4, 3, 2];
const MIN_POINTS = 1;
const RANKING_SIZE = 10;
const MAX_TOTAL_ROUNDS = 2000;
const LETTERS = ['A', 'B', 'C', 'D'];
const ANSWER_RE = /^\s*([abcd])\s*$/i;

function pointsForPosition(pos) {
  return pos < POSITION_POINTS.length ? POSITION_POINTS[pos] : MIN_POINTS;
}

function sanitizeTotalRounds(n) {
  n = Math.floor(Number(n));
  return Number.isFinite(n) && n > 0 ? Math.min(n, MAX_TOTAL_ROUNDS) : 0;
}

function newStats() {
  return { answers: 0, correct: 0, participants: new Set(), hardest: null };
}

function createGame({ emit, buildQuestion, answerSeconds, resultsSeconds }) {
  const events = new EventEmitter();
  const scores = new Map();   // pid -> { nickname, points, reachedAt }   (ranking de la partida)
  const game = {
    number: 0,
    running: false,
    round: 0,
    totalRounds: 0,
    finished: false,
    stats: null,
    lastGameOver: null,
    phase: 'idle',          // 'idle' | 'answer' | 'results' | 'over'
    remaining: 0,
    question: null,
    roundStartedAt: 0,
    votes: new Map(),       // pid -> { index, nickname, handle, at }
    lastResults: null,
    timer: null,
    votesDirty: false,
  };

  function addPoints(pid, nickname, at, points) {
    const s = scores.get(pid) || { nickname, points: 0, reachedAt: 0 };
    s.nickname = nickname;    // el nick puede cambiar durante el directo
    s.points += points;
    s.reachedAt = at;
    scores.set(pid, s);
  }

  function sortedScores() {
    return [...scores.entries()].sort((a, b) => b[1].points - a[1].points || a[1].reachedAt - b[1].reachedAt);
  }

  // gained: Map pid -> puntos ganados en la ronda (para el "+N" del ranking)
  function topRanking(gained) {
    return sortedScores().slice(0, RANKING_SIZE)
      .map(([id, s]) => ({ nickname: s.nickname, points: s.points, gained: (gained && gained.get(id)) || 0 }));
  }

  function rankingPayload(gained) {
    return { ranking: topRanking(gained), players: scores.size };
  }

  function voteCounts() {
    const counts = [0, 0, 0, 0];
    for (const v of game.votes.values()) counts[v.index]++;
    return counts;
  }

  function questionPayload() {
    return {
      round: game.round,
      totalRounds: game.totalRounds,
      mode: game.question.mode,
      correct: game.question.correct,
      options: game.question.options,
      duration: answerSeconds,
      remaining: game.remaining,
    };
  }

  function startRound() {
    game.round++;
    game.phase = 'answer';
    game.remaining = answerSeconds;
    game.question = buildQuestion();
    game.roundStartedAt = Date.now();
    game.votes.clear();
    game.lastResults = null;
    emit('round:question', questionPayload());
    console.log(`❓ Ronda ${game.round} [${game.question.mode}]: ${game.question.correct.flag} ${game.question.correct.names.es} → ${LETTERS[game.question.correctIndex]}`);
  }

  function finishRound() {
    const correctIndex = game.question.correctIndex;
    const all = [...game.votes.values()];
    const winnerEntries = [...game.votes.entries()]
      .filter(([, v]) => v.index === correctIndex)
      .sort((a, b) => a[1].at - b[1].at);
    const winners = winnerEntries.map(([, v], pos) => ({ nickname: v.nickname, points: pointsForPosition(pos) }));
    const gained = new Map();
    winnerEntries.forEach(([id, v], pos) => {
      gained.set(id, winners[pos].points);
      addPoints(id, v.nickname, v.at, winners[pos].points);
    });
    const total = all.length;
    const correctPct = total ? Math.round((winners.length / total) * 100) : 0;

    // Estadísticas de la partida para la pantalla final
    const st = game.stats;
    st.answers += total;
    st.correct += winners.length;
    game.votes.forEach((v, id) => st.participants.add(id));
    if (total && (!st.hardest || correctPct < st.hardest.pct || (correctPct === st.hardest.pct && total > st.hardest.votes))) {
      const c = game.question.correct;
      st.hardest = { flag: c.flag, names: c.names, pct: correctPct, votes: total };
    }

    events.emit('roundEnd', {
      number: game.number,
      round: game.round,
      question: game.question,
      startedAt: game.roundStartedAt,
      votes: [...game.votes.entries()],
      gained,
    });

    game.phase = 'results';
    game.remaining = resultsSeconds;
    game.lastResults = {
      round: game.round,
      totalRounds: game.totalRounds,
      correctIndex,
      correctLetter: LETTERS[correctIndex],
      counts: voteCounts(),
      totalVotes: total,
      correctCount: winners.length,
      correctPct,
      wrongPct: total ? 100 - correctPct : 0,
      winners: winners.slice(0, MAX_WINNERS_SENT),
      ...rankingPayload(gained),
      duration: resultsSeconds,
      remaining: resultsSeconds,
    };
    emit('round:results', game.lastResults);
    console.log(`📊 Ronda ${game.round}: ${winners.length}/${total} aciertos (${correctPct}%)`);
  }

  function tick() {
    game.remaining--;
    if (game.remaining <= 0) {
      if (game.phase === 'answer') finishRound();
      else if (game.totalRounds && game.round >= game.totalRounds) endGame();
      else startRound();
      return;
    }
    emit('round:tick', { round: game.round, phase: game.phase, remaining: game.remaining });
  }

  /* opts.totalRounds: duración de una partida nueva. opts.fresh: descarta la partida en pausa.
   * Sin fresh y con una partida en pausa, la reanuda donde se quedó (misma ronda, total y ranking). */
  function start(opts) {
    if (game.running) return;
    opts = opts || {};
    const resume = !opts.fresh && !game.finished && game.round > 0 &&
      (!game.totalRounds || game.round < game.totalRounds);
    if (!resume) {
      game.number++;
      game.round = 0;
      game.totalRounds = sanitizeTotalRounds(opts.totalRounds);
      game.finished = false;
      game.lastGameOver = null;
      game.stats = newStats();
      scores.clear();   // partida nueva = ranking nuevo
      emit('ranking:update', rankingPayload());
      events.emit('gameStart', { number: game.number, totalRounds: game.totalRounds });
    }
    game.running = true;
    startRound();
    game.timer = setInterval(tick, 1000);
    events.emit('status');
    console.log(`▶️  ${resume ? 'Partida reanudada' : 'Partida nueva'}: ${game.totalRounds ? `${game.totalRounds} rondas` : 'sin límite de rondas'}`);
  }

  function gameOverPayload() {
    const st = game.stats || newStats();
    return {
      rounds: game.round,
      totalRounds: game.totalRounds,
      players: scores.size,
      participants: st.participants.size,
      answers: st.answers,
      correct: st.correct,
      accuracy: st.answers ? Math.round((st.correct / st.answers) * 100) : 0,
      hardest: st.hardest,
      ranking: topRanking(),
    };
  }

  /* Fin de partida: al acabar la última ronda o a petición de quien emite (también desde pausa) */
  function end() {
    if (game.finished || game.round === 0) return;
    clearInterval(game.timer);
    // Terminar en plena votación: esa ronda no cuenta (nadie ha visto la respuesta)
    const rounds = game.phase === 'answer' ? game.round - 1 : game.round;
    game.running = false;
    game.finished = true;
    game.phase = 'over';
    game.question = null;
    game.votes.clear();
    game.lastGameOver = gameOverPayload();
    emit('game:over', game.lastGameOver);
    events.emit('gameEnd', { number: game.number, rounds, ranking: sortedScores() });
    events.emit('status');
    console.log(`🏁 Fin de la partida tras ${game.round} rondas · ${game.lastGameOver.participants} participantes`);
  }
  const endGame = end;

  function stop() {
    if (!game.running) return;
    // Parar durante los resultados de la última ronda: la partida ya está jugada, se cierra
    if (game.phase === 'results' && game.totalRounds && game.round >= game.totalRounds) return end();
    clearInterval(game.timer);
    game.running = false;
    game.phase = 'idle';
    game.question = null;
    game.votes.clear();
    events.emit('status');
    console.log('⏹️  Juego detenido');
  }

  /* Un voto por usuario y ronda: cuenta el primero. Devuelve true si el comentario era un voto. */
  function vote(player, comment) {
    if (game.phase !== 'answer' || !player) return false;
    const match = ANSWER_RE.exec(String(comment || ''));
    if (!match) return false;
    if (game.votes.has(player.pid)) return true;
    game.votes.set(player.pid, {
      index: LETTERS.indexOf(match[1].toUpperCase()),
      nickname: player.nickname,
      handle: player.handle,
      at: Date.now(),
    });
    game.votesDirty = true;
    return true;
  }

  /* Envía el recuento como mucho cada VOTES_BROADCAST_MS (el chat puede ir muy rápido) */
  setInterval(() => {
    if (!game.votesDirty || game.phase !== 'answer') return;
    game.votesDirty = false;
    emit('round:votes', { round: game.round, counts: voteCounts(), total: game.votes.size });
  }, VOTES_BROADCAST_MS);

  /* Un cliente que entra a mitad de ronda recibe el estado actual */
  function syncSocket(socket) {
    socket.emit('ranking:update', rankingPayload());
    if (game.phase === 'answer') {
      socket.emit('round:question', questionPayload());
      socket.emit('round:votes', { round: game.round, counts: voteCounts(), total: game.votes.size });
    } else if (game.phase === 'results' && game.lastResults) {
      socket.emit('round:question', { ...questionPayload(), remaining: 0 });
      socket.emit('round:results', { ...game.lastResults, remaining: game.remaining });
    } else if (game.phase === 'over' && game.lastGameOver) {
      socket.emit('game:over', game.lastGameOver);
    }
  }

  function status() {
    return {
      running: game.running,
      round: game.round,
      totalRounds: game.totalRounds,
      finished: game.finished,
      paused: !game.running && !game.finished && game.round > 0,
      answerSeconds,
      resultsSeconds,
    };
  }

  function resetRanking() {
    scores.clear();
    emit('ranking:update', rankingPayload());
  }

  return { events, start, stop, end, vote, syncSocket, status, resetRanking, isRunning: () => game.running, phase: () => game.phase };
}

module.exports = { createGame, pointsForPosition };
