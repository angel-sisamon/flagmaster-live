/**
 * shared/stats.js — Clasificaciones a partir de las sesiones grabadas.
 *
 * Las sesiones (data/sessions/AAAA-MM/<id>.json, una por directo) son la fuente de verdad:
 * meses, histórico y récords se recalculan siempre desde ellas, nunca se suman a mano.
 * Si mañana cambia la fórmula o se banea a alguien, basta con volver a agregar.
 *
 * Sin dependencias. Lo usan:
 *   - server/src/standings.js  → TOP del mes durante el directo y respuesta a "!yo",
 *   - scripts/aggregate.js     → JSON de la web (site/data/).
 *
 *   aggregate(sessions, opts)        → { totals, players, lives, countries, modes }
 *   monthKey(date, timeZone)         → 'AAAA-MM' en la zona horaria del directo
 *   compareRank(a, b)                → orden del ranking de puntos
 *   createModeration(json)           → { isHidden(player) } a partir de data/moderation.json
 */

'use strict';

const SCHEMA = 1;

// Contadores que se suman tal cual entre sesiones (ver newPlayer)
const COUNTERS = ['pts', 'ans', 'ok', 'first', 'wins', 'games', 'tms', 'likes', 'gifts', 'follows', 'shares'];
const TOTALS = ['games', 'rounds', 'answers', 'correct', 'likes', 'gifts', 'follows', 'shares', 'joins'];

/**
 * Jugador dentro de una sesión (y, sumado, dentro de un mes):
 *   u: @usuario · n: nick · pts: puntos · ans/ok: respuestas/aciertos · first: veces 1º en acertar
 *   wins: partidas ganadas · games: partidas jugadas · streak: mejor racha de aciertos seguidos
 *   fast: acierto más rápido (ms) · tms: suma de ms de los aciertos (media = tms / ok)
 *   likes · gifts (diamantes) · follows · shares · modes: { modo: [respuestas, aciertos] }
 */
function newPlayer() {
  return { u: '', n: '', pts: 0, ans: 0, ok: 0, first: 0, wins: 0, games: 0, streak: 0, fast: 0, tms: 0,
    likes: 0, gifts: 0, follows: 0, shares: 0, modes: {} };
}

function monthKey(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit' })
    .formatToParts(new Date(date));
  const get = type => parts.find(p => p.type === type).value;
  return `${get('year')}-${get('month')}`;
}

const num = v => (Number.isFinite(v) ? v : 0);
const pct = (part, total) => (total ? Math.round((part / total) * 100) : 0);
const avgMs = p => (p.ok ? Math.round(p.tms / p.ok) : 0);

/* Puntos ↓, aciertos ↓, tiempo medio ↑ (sin datos va al final), id para que el orden sea estable */
function compareRank(a, b) {
  return b.pts - a.pts || b.ok - a.ok ||
    (avgMs(a) || Infinity) - (avgMs(b) || Infinity) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

function normHandle(s) {
  return String(s || '').trim().replace(/^@/, '').toLowerCase();
}

/* data/moderation.json: { "optout": [id | "@usuario"], "banned": [...] } */
function createModeration(json) {
  const hidden = new Set();
  for (const list of [json && json.optout, json && json.banned]) {
    if (Array.isArray(list)) list.forEach(v => { if (v) hidden.add(normHandle(v)); });
  }
  return {
    isHidden: p => hidden.has(normHandle(p.id)) || (!!p.u && hidden.has(normHandle(p.u))),
  };
}

function addPlayerStats(into, p) {
  for (const k of COUNTERS) into[k] += num(p[k]);
  into.streak = Math.max(into.streak, num(p.streak));
  if (p.fast > 0 && (!into.fast || p.fast < into.fast)) into.fast = p.fast;
  for (const [mode, v] of Object.entries(p.modes || {})) {
    const m = into.modes[mode] || (into.modes[mode] = [0, 0]);
    m[0] += num(v[0]);
    m[1] += num(v[1]);
  }
  // El @ y el nick pueden cambiar: se queda el más reciente (las sesiones llegan en orden)
  if (p.u) into.u = p.u;
  if (p.n) into.n = p.n;
}

function isValidSession(s) {
  return s && s.schema === SCHEMA && typeof s.id === 'string' && s.players && typeof s.players === 'object' &&
    Array.isArray(s.questions);
}

function sortSessions(sessions) {
  return sessions.filter(isValidSession).sort((a, b) => String(a.startedAt).localeCompare(String(b.startedAt)));
}

/**
 * Agrega varias sesiones (un mes, o todas para el histórico).
 *   opts.moderation  → createModeration(): los ocultos no salen en la lista (sí cuentan en los totales)
 *   opts.seenBefore  → Set de ids vistos en meses anteriores, para contar jugadores nuevos
 */
function aggregate(sessions, opts) {
  opts = opts || {};
  const moderation = opts.moderation || createModeration(null);
  const seenBefore = opts.seenBefore || new Set();
  const list = sortSessions(sessions);

  const totals = { lives: list.length, minutes: 0, players: 0, newPlayers: 0, peakViewers: 0, accuracy: 0 };
  TOTALS.forEach(k => { totals[k] = 0; });
  const players = new Map();
  const countries = new Map();
  const modes = {};
  const lives = [];

  list.forEach((s, liveIdx) => {
    const t = s.totals || {};
    TOTALS.forEach(k => { totals[k] += num(t[k]); });
    totals.peakViewers = Math.max(totals.peakViewers, num(t.peakViewers));
    const minutes = s.endedAt ? Math.max(0, Math.round((Date.parse(s.endedAt) - Date.parse(s.startedAt)) / 60000)) : 0;
    totals.minutes += minutes;

    let winner = null;
    for (const [id, p] of Object.entries(s.players)) {
      const agg = players.get(id) || Object.assign(newPlayer(), { id, lives: 0, best: 0, bestLive: '', hist: [] });
      addPlayerStats(agg, p);
      if (num(p.ans) > 0) {
        agg.lives++;
        agg.hist.push([liveIdx, num(p.pts)]);
      }
      if (num(p.pts) > agg.best) { agg.best = num(p.pts); agg.bestLive = s.id; }
      players.set(id, agg);
      const cand = Object.assign({ id }, p);
      if (num(p.pts) > 0 && !moderation.isHidden(cand) && (!winner || compareRank(cand, winner) < 0)) winner = cand;
    }

    for (const q of s.questions) {
      const c = countries.get(q.code) || { code: q.code, flag: q.flag || '', es: q.es || q.code, en: q.en || q.code, asked: 0, votes: 0, ok: 0 };
      c.asked++;
      c.votes += num(q.votes);
      c.ok += num(q.ok);
      countries.set(q.code, c);
      const m = modes[q.mode] || (modes[q.mode] = { asked: 0, votes: 0, ok: 0 });
      m.asked++;
      m.votes += num(q.votes);
      m.ok += num(q.ok);
    }

    lives.push({
      id: s.id, startedAt: s.startedAt, endedAt: s.endedAt || null, minutes,
      games: num(t.games), rounds: num(t.rounds), answers: num(t.answers), accuracy: pct(num(t.correct), num(t.answers)),
      players: Object.values(s.players).filter(p => num(p.ans) > 0).length,
      peakViewers: num(t.peakViewers), likes: num(t.likes),
      winner: winner ? { id: winner.id, u: winner.u, n: winner.n, pts: winner.pts } : null,
    });
  });

  const visible = [];
  for (const p of players.values()) {
    if (p.ans > 0) {
      totals.players++;
      if (!seenBefore.has(p.id)) totals.newPlayers++;
    }
    if (moderation.isHidden(p) || (p.ans === 0 && p.likes === 0 && p.gifts === 0)) continue;
    p.acc = pct(p.ok, p.ans);
    p.avg = avgMs(p);
    visible.push(p);
  }
  visible.sort(compareRank);
  let pos = 0;
  visible.forEach(p => { p.pos = p.pts > 0 ? ++pos : 0; });
  totals.accuracy = pct(totals.correct, totals.answers);

  return {
    schema: SCHEMA,
    totals,
    players: visible,
    lives,
    countries: [...countries.values()].map(c => Object.assign(c, { pct: pct(c.ok, c.votes) }))
      .sort((a, b) => b.asked - a.asked || a.code.localeCompare(b.code)),
    modes,
  };
}

module.exports = { SCHEMA, newPlayer, monthKey, compareRank, createModeration, normHandle, aggregate, avgMs, pct };
