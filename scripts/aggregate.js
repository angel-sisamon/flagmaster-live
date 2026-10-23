#!/usr/bin/env node
/**
 * scripts/aggregate.js — Genera los datos de la web a partir de las sesiones grabadas.
 *
 *   data/sessions/AAAA-MM/*.json  +  data/moderation.json
 *        ↓
 *   site/data/index.json          meses disponibles, campeones y totales históricos
 *   site/data/months/AAAA-MM.json clasificación y estadísticas de cada mes
 *   site/data/alltime.json        histórico: jugadores, récords y salón de la fama
 *
 * Lo ejecuta GitHub Actions antes de publicar la web (los JSON generados no se suben al repo).
 * En local: npm run build:site  (opciones: --sessions <dir> --out <dir>)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { aggregate, createModeration } = require('../shared/stats');

const ROOT = path.join(__dirname, '..');
const TIME_ZONE = process.env.LIVE_TZ || 'Europe/Madrid';
const ALLTIME_PLAYERS = 500;     // el histórico solo lista a los mejores (cada mes va completo)

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i > -1 && process.argv[i + 1] ? path.resolve(process.argv[i + 1]) : fallback;
}

const SESSIONS_DIR = arg('--sessions', path.join(ROOT, 'data', 'sessions'));
const OUT_DIR = arg('--out', path.join(ROOT, 'site', 'data'));
const MODERATION_FILE = path.join(ROOT, 'data', 'moderation.json');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data));
}

function loadSessions() {
  const byMonth = new Map();
  let bad = 0;
  if (!fs.existsSync(SESSIONS_DIR)) return byMonth;
  for (const month of fs.readdirSync(SESSIONS_DIR).filter(d => /^\d{4}-\d{2}$/.test(d)).sort()) {
    const dir = path.join(SESSIONS_DIR, month);
    for (const f of fs.readdirSync(dir).filter(n => n.endsWith('.json'))) {
      try {
        const s = readJson(path.join(dir, f));
        if (!byMonth.has(month)) byMonth.set(month, []);
        byMonth.get(month).push(s);
      } catch (e) {
        bad++;
        console.warn(`⚠️  Sesión ilegible, se ignora: ${month}/${f} (${e.message})`);
      }
    }
  }
  if (bad) console.warn(`⚠️  ${bad} sesiones ignoradas`);
  return byMonth;
}

const pick = p => (p ? { id: p.id, u: p.u, n: p.n } : null);

function best(players, score, minOk) {
  let top = null;
  for (const p of players) {
    if ((minOk && p.ok < minOk) || !(score(p) > 0)) continue;
    if (!top || score(p) > score(top)) top = p;
  }
  return top;
}

function main() {
  const moderation = createModeration(fs.existsSync(MODERATION_FILE) ? readJson(MODERATION_FILE) : null);
  const byMonth = loadSessions();
  const generatedAt = new Date().toISOString();
  const seen = new Set();
  const months = [];
  const playerMonths = new Map();   // id -> { 'AAAA-MM': [pts, pos] }
  const all = [];

  fs.rmSync(path.join(OUT_DIR, 'months'), { recursive: true, force: true });

  for (const [month, sessions] of byMonth) {
    const agg = aggregate(sessions, { moderation, seenBefore: seen });
    for (const s of sessions) {
      if (!s || !s.players) continue;
      for (const [id, p] of Object.entries(s.players)) if (p.ans > 0) seen.add(id);
    }
    all.push(...sessions);
    for (const p of agg.players) {
      if (!playerMonths.has(p.id)) playerMonths.set(p.id, {});
      playerMonths.get(p.id)[month] = [p.pts, p.pos];
    }
    const champion = agg.players.find(p => p.pos === 1);
    months.push({ id: month, lives: agg.totals.lives, players: agg.totals.players,
      champion: champion ? { ...pick(champion), pts: champion.pts } : null });
    writeJson(path.join(OUT_DIR, 'months', `${month}.json`), { month, generatedAt, ...agg });
    console.log(`📅 ${month}: ${agg.totals.lives} directos · ${agg.totals.players} jugadores · ${agg.totals.answers} respuestas`);
  }

  const hist = aggregate(all, { moderation });
  const ps = hist.players;
  const record = (p, value, extra) => (p ? { ...pick(p), value, ...extra } : null);
  const bestLive = best(ps, p => p.best);
  const streak = best(ps, p => p.streak);
  const fastest = best(ps, p => (p.fast ? 1e9 - p.fast : 0));
  const fastestAvg = best(ps, p => (p.avg ? 1e9 - p.avg : 0), 30);
  const loyal = best(ps, p => p.lives);
  const supporter = best(ps, p => p.gifts);

  writeJson(path.join(OUT_DIR, 'alltime.json'), {
    generatedAt,
    totals: hist.totals,
    records: {
      bestLive: record(bestLive, bestLive && bestLive.best, { live: bestLive && bestLive.bestLive }),
      streak: record(streak, streak && streak.streak),
      fastest: record(fastest, fastest && fastest.fast),
      fastestAvg: record(fastestAvg, fastestAvg && fastestAvg.avg),
      loyal: record(loyal, loyal && loyal.lives),
      supporter: record(supporter, supporter && supporter.gifts),
    },
    champions: months.filter(m => m.champion).map(m => ({ month: m.id, ...m.champion })),
    countries: hist.countries,
    modes: hist.modes,
    players: ps.filter(p => p.pos > 0).slice(0, ALLTIME_PLAYERS).map(p => {
      const { hist: _h, modes: _m, tms: _t, bestLive: _b, ...rest } = p;
      return { ...rest, months: playerMonths.get(p.id) || {} };
    }),
  });

  writeJson(path.join(OUT_DIR, 'index.json'), {
    generatedAt,
    timeZone: TIME_ZONE,
    months: months.slice().reverse(),
    totals: hist.totals,
  });
  console.log(`✅ Web generada en ${path.relative(ROOT, OUT_DIR)}: ${months.length} meses · ${hist.totals.players} jugadores en total`);
}

main();
