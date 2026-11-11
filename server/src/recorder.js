/**
 * server/src/recorder.js — Graba lo que pasa en cada directo.
 *
 * Una sesión = un directo. Empieza con la primera actividad (partida, voto, like, regalo…) y se
 * cierra cuando TikTok avisa de que el directo ha terminado o cuando se para el servidor.
 * Al cerrarla se escribe data/sessions/AAAA-MM/<id>.json (formato en shared/stats.js), que es lo
 * que se sube al repo y alimenta la web.
 *
 * Para no perder nada si el PC o Node se caen a mitad del directo, el estado se guarda en
 * server/.live/current-session.json tras cada ronda y cada pocos segundos (escritura atómica).
 * Al arrancar, recover() retoma esa sesión si es reciente o la cierra si es de otro día.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { SCHEMA, newPlayer, monthKey } = require('../../shared/stats');

const SNAPSHOT_DEBOUNCE_MS = 5000;

const sleepSync = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/* Escribe en .tmp y renombra: un corte a mitad nunca deja el JSON a medias. En Windows el antivirus o el
 * indexador pueden bloquear el destino unos milisegundos (EPERM/EBUSY): se reintenta y, si no, se escribe directo. */
function writeJsonAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const text = JSON.stringify(data, null, 1) + '\n';
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, text);
  for (let attempt = 0; ; attempt++) {
    try {
      fs.renameSync(tmp, file);
      return;
    } catch (e) {
      if (!['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) throw e;
      if (attempt >= 4) break;
      sleepSync(25 * (attempt + 1));
    }
  }
  fs.writeFileSync(file, text);
  fs.rmSync(tmp, { force: true });
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return null; }
}

/* "2026-10-23_2130" en la zona horaria del directo; legible y ordenable en el repo */
function sessionId(date, timeZone) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}_${p.hour}${p.minute}`;
}

function createRecorder({ enabled, dataDir, stateDir, timeZone, host, resumeWindowMs, clock }) {
  const now = clock || (() => new Date());   // inyectable para tests y datos de demostración
  const snapshotFile = path.join(stateDir, 'current-session.json');
  let session = null;
  let joined = new Set();      // pids que han entrado (solo cuenta, no se publica quién)
  const streaks = new Map();   // pid -> racha actual de aciertos (la mejor va en player.streak)
  let snapshotTimer = null;

  function create() {
    const date = now();
    session = {
      schema: SCHEMA,
      id: sessionId(date, timeZone),
      month: monthKey(date, timeZone),
      host,
      startedAt: date.toISOString(),
      updatedAt: date.toISOString(),
      endedAt: null,
      roomId: null,
      totals: { games: 0, rounds: 0, answers: 0, correct: 0, likes: 0, gifts: 0, follows: 0, shares: 0, joins: 0, messages: 0, peakViewers: 0 },
      games: [],
      questions: [],
      players: {},
    };
    joined = new Set();
    streaks.clear();
    console.log(`🎬 Sesión ${session.id} iniciada`);
  }

  function ensure() {
    if (!enabled) return null;
    if (!session) create();
    return session;
  }

  function player(pid, handle, nickname) {
    const p = session.players[pid] || (session.players[pid] = newPlayer());
    if (handle) p.u = handle;
    if (nickname) p.n = nickname;
    return p;
  }

  function snapshotNow() {
    clearTimeout(snapshotTimer);
    snapshotTimer = null;
    if (!session) return;
    session.updatedAt = now().toISOString();
    try {
      writeJsonAtomic(snapshotFile, { session, joined: [...joined], streaks: [...streaks] });
    } catch (e) {
      console.error('⚠️  No se pudo guardar la copia del directo:', e.message);
    }
  }

  function snapshotSoon() {
    if (!snapshotTimer) snapshotTimer = setTimeout(snapshotNow, SNAPSHOT_DEBOUNCE_MS);
  }

  /* ── Eventos del juego ─────────────────────────────── */
  /* La numeración es la de la sesión (no la del juego): una sesión retomada tras reiniciar sigue contando */
  function onGameStart({ totalRounds }) {
    if (!ensure()) return;
    const prev = currentGame();
    if (prev && !prev.endedAt) prev.endedAt = now().toISOString();   // partida cortada por un reinicio
    session.totals.games++;
    session.games.push({ n: session.games.length + 1, startedAt: now().toISOString(), endedAt: null, totalRounds, rounds: 0, players: 0, winner: null });
    snapshotSoon();
  }

  function currentGame() {
    return session.games[session.games.length - 1] || null;
  }

  function onRoundEnd({ question, startedAt, votes, gained }) {
    if (!ensure()) return;
    // Partida reanudada tras recuperar una sesión: el juego sigue, pero el grabador no la tenía abierta
    if (!currentGame() || currentGame().endedAt) onGameStart({ totalRounds: 0 });
    const g = currentGame();
    g.rounds++;
    const c = question.correct;
    const correct = question.correctIndex;
    const counts = [0, 0, 0, 0];
    let ok = 0;
    let firstPid = null;
    let firstAt = Infinity;

    for (const [pid, v] of votes) {
      counts[v.index]++;
      const p = player(pid, v.handle, v.nickname);
      if (!p._g || p._g !== g.n) { p._g = g.n; p.games++; g.players++; }
      p.ans++;
      const m = p.modes[question.mode] || (p.modes[question.mode] = [0, 0]);
      m[0]++;
      if (v.index === correct) {
        ok++;
        const ms = Math.max(0, v.at - startedAt);
        p.ok++;
        m[1]++;
        p.pts += gained.get(pid) || 0;
        p.tms += ms;
        if (!p.fast || ms < p.fast) p.fast = ms;
        const run = (streaks.get(pid) || 0) + 1;
        streaks.set(pid, run);
        if (run > p.streak) p.streak = run;
        if (v.at < firstAt) { firstAt = v.at; firstPid = pid; }
      } else {
        streaks.set(pid, 0);
      }
    }
    if (firstPid) session.players[firstPid].first++;

    session.totals.rounds++;
    session.totals.answers += votes.length;
    session.totals.correct += ok;
    session.questions.push({ g: g.n, r: session.totals.rounds, mode: question.mode, code: c.code, flag: c.flag,
      es: c.names && c.names.es, en: c.names && c.names.en, votes: votes.length, ok, counts });
    snapshotNow();
  }

  function onGameEnd({ ranking }) {
    if (!session) return;
    const g = currentGame();
    if (!g || g.endedAt) return;
    g.endedAt = now().toISOString();
    const top = ranking[0];
    if (top && top[1].points > 0) {
      g.winner = top[0];
      if (session.players[top[0]]) session.players[top[0]].wins++;
    }
    snapshotNow();
  }

  /* ── Eventos de TikTok ─────────────────────────────── */
  function onJoin(user) {
    if (!user || !ensure() || joined.has(user.pid)) return;
    joined.add(user.pid);
    session.totals.joins = joined.size;
    snapshotSoon();
  }

  /* Cada mensaje del chat (votos y comandos incluidos). "|| 0": una sesión retomada de una versión anterior no tenía el campo */
  function onChat(user) {
    if (!ensure()) return;
    session.totals.messages = (session.totals.messages || 0) + 1;
    if (user) {
      const p = player(user.pid, user.handle, user.nickname);
      p.msgs = (p.msgs || 0) + 1;
    }
    snapshotSoon();
  }

  function onLike(user, count) {
    if (!ensure()) return;
    session.totals.likes += count;
    if (user) player(user.pid, user.handle, user.nickname).likes += count;
    snapshotSoon();
  }

  function onGift(user, diamonds) {
    if (!ensure() || !(diamonds > 0)) return;
    session.totals.gifts += diamonds;
    if (user) player(user.pid, user.handle, user.nickname).gifts += diamonds;
    snapshotSoon();
  }

  function onFollow(user) {
    if (!ensure()) return;
    session.totals.follows++;
    if (user) player(user.pid, user.handle, user.nickname).follows++;
    snapshotSoon();
  }

  function onShare(user) {
    if (!ensure()) return;
    session.totals.shares++;
    if (user) player(user.pid, user.handle, user.nickname).shares++;
    snapshotSoon();
  }

  function onViewers(count) {
    if (!session || !(count > session.totals.peakViewers)) return;   // solo dentro de una sesión ya empezada
    session.totals.peakViewers = count;
    snapshotSoon();
  }

  function setRoom(roomId) {
    if (session && roomId && !session.roomId) session.roomId = String(roomId);
  }

  /* Sesión en curso con el formato publicado (sin campos internos), para la clasificación en directo */
  function publicSession(s) {
    s = s || session;
    if (!s) return null;
    const players = {};
    for (const [pid, p] of Object.entries(s.players)) {
      const { _g, ...rest } = p;
      players[pid] = rest;
    }
    return { ...s, players };
  }

  /* Cierra la sesión: escribe data/sessions/AAAA-MM/<id>.json y devuelve la ruta (o null si estaba vacía) */
  function finish(reason) {
    clearTimeout(snapshotTimer);
    if (!session) return null;
    const s = session;
    session = null;
    const g = s.games[s.games.length - 1];
    if (g && !g.endedAt) g.endedAt = now().toISOString();
    s.endedAt = s.endedAt || now().toISOString();
    try { fs.rmSync(snapshotFile, { force: true }); } catch (e) { /* se reintenta en el próximo arranque */ }
    if (!s.totals.answers) {
      console.log(`🗑️  Sesión ${s.id} descartada: nadie respondió (${reason})`);
      return null;
    }
    const file = path.join(dataDir, 'sessions', s.month, `${s.id}.json`);
    writeJsonAtomic(file, publicSession(s));
    console.log(`💾 Sesión ${s.id} guardada (${reason}): ${s.totals.rounds} rondas · ${Object.keys(s.players).length} jugadores → ${path.relative(path.join(dataDir, '..'), file)}`);
    return file;
  }

  /* Al arrancar: retoma el directo interrumpido o, si es antiguo, lo cierra y lo guarda */
  function recover() {
    const snap = readJson(snapshotFile);
    if (!snap || !snap.session) return null;
    const age = Date.now() - Date.parse(snap.session.updatedAt);
    session = snap.session;
    joined = new Set(snap.joined || []);
    streaks.clear();
    (snap.streaks || []).forEach(([pid, n]) => streaks.set(pid, n));
    if (enabled && age < resumeWindowMs) {
      console.log(`♻️  Retomando la sesión ${session.id} (interrumpida hace ${Math.round(age / 60000)} min)`);
      return { resumed: true, file: null };
    }
    return { resumed: false, file: finish('recuperada de una ejecución anterior') };
  }

  return {
    onGameStart, onRoundEnd, onGameEnd, onJoin, onChat, onLike, onGift, onFollow, onShare, onViewers, setRoom,
    finish, recover, flush: snapshotNow,
    current: () => publicSession(),
    info: () => (session ? { id: session.id, month: session.month, startedAt: session.startedAt, totals: session.totals } : null),
    enabled,
  };
}

module.exports = { createRecorder, sessionId, writeJsonAtomic, readJson };
