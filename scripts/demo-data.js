#!/usr/bin/env node
/**
 * scripts/demo-data.js — Directos simulados para probar la web sin estar en TikTok.
 *
 * Usa el grabador real (server/src/recorder.js) con un reloj falso: genera varios directos en los
 * dos últimos meses con jugadores que repiten, likes, regalos y follows, en .demo/sessions/.
 *
 *   npm run demo          → genera .demo/, agrega en site/data/ y abre la web en http://localhost:8080
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { createRecorder } = require('../server/src/recorder');
const { fromTikTokUser } = require('../server/src/identity');
const { pointsForPosition } = require('../server/src/game');
const config = require('../server/src/config');

const DEMO_DIR = path.join(__dirname, '..', '.demo');
const LIVES = 9;
const ROUNDS_PER_LIVE = 40;
const POOL = 140;
const MODES = ['guess-country', 'guess-flag', 'guess-capital', 'guess-country-from-capital'];

// Números reproducibles: la misma demo cada vez
let seed = 42;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pickOne = arr => arr[Math.floor(rand() * arr.length)];

function countries() {
  try {
    return require('../server/src/questions').loadGameData(config.GAME_DIR).countries;
  } catch (e) {
    return [
      { code: 'es', flag: '🇪🇸', names: { es: 'España', en: 'Spain' } },
      { code: 'fr', flag: '🇫🇷', names: { es: 'Francia', en: 'France' } },
      { code: 'jp', flag: '🇯🇵', names: { es: 'Japón', en: 'Japan' } },
      { code: 'br', flag: '🇧🇷', names: { es: 'Brasil', en: 'Brazil' } },
      { code: 'bt', flag: '🇧🇹', names: { es: 'Bután', en: 'Bhutan' } },
    ];
  }
}

const NAMES = ['luna', 'mateo', 'sofia', 'leo', 'valen', 'nico', 'emma', 'hugo', 'mia', 'alex', 'sara', 'dani', 'paula',
  'marco', 'julia', 'iker', 'noa', 'bruno', 'alma', 'pablo', 'vera', 'lucas', 'zoe', 'adri'];
const players = Array.from({ length: POOL }, (_, i) => {
  const base = NAMES[i % NAMES.length];
  const handle = `${base}_${(i * 37 % 900) + 100}`;
  return { user: fromTikTokUser({ userId: String(7e18 + i * 7919), uniqueId: handle, nickname: base[0].toUpperCase() + base.slice(1) + (i % 3 ? '' : ' 🌍') }),
    skill: 0.35 + rand() * 0.6, speed: 1500 + rand() * 9000, loyalty: rand() };
});

function main() {
  fs.rmSync(DEMO_DIR, { recursive: true, force: true });
  const list = countries();
  const now = Date.now();
  for (let live = 0; live < LIVES; live++) {
    // Repartidos entre el mes pasado y este, a las 21:30
    const day = new Date(now - (LIVES - live) * 5.5 * 864e5);
    day.setHours(21, 30, 0, 0);
    let t = day.getTime();
    const rec = createRecorder({ enabled: true, dataDir: DEMO_DIR, stateDir: path.join(DEMO_DIR, 'state'),
      timeZone: config.TIME_ZONE, host: 'demo', resumeWindowMs: 0, clock: () => new Date(t) });
    const audience = players.filter(p => rand() < 0.25 + p.loyalty * 0.6);
    audience.forEach(p => rec.onJoin(p.user));
    rec.onGameStart({ totalRounds: ROUNDS_PER_LIVE });
    for (let r = 0; r < ROUNDS_PER_LIVE; r++) {
      const c = pickOne(list);
      const startedAt = t;
      const votes = [];
      for (const p of audience) {
        if (rand() > 0.7) continue;
        const okAnswer = rand() < p.skill;
        votes.push([p.user.pid, { index: okAnswer ? 0 : 1 + Math.floor(rand() * 3), nickname: p.user.nickname,
          handle: p.user.handle, at: startedAt + Math.round(p.speed * (0.4 + rand())) }]);
      }
      const gained = new Map();
      votes.filter(([, v]) => v.index === 0).sort((a, b) => a[1].at - b[1].at)
        .forEach(([pid], pos) => gained.set(pid, pointsForPosition(pos)));
      votes.forEach(([pid]) => rec.onChat(audience.find(p => p.user.pid === pid).user));
      audience.forEach(p => { if (rand() < 0.15) rec.onChat(p.user); });   // charla que no es un voto
      rec.onRoundEnd({ question: { mode: pickOne(MODES), correct: c, correctIndex: 0 }, startedAt, votes, gained });
      if (rand() < 0.3) rec.onLike(pickOne(audience).user, 5 + Math.floor(rand() * 40));
      if (rand() < 0.05) rec.onGift(pickOne(audience).user, pickOne([1, 1, 5, 10, 99]));
      if (rand() < 0.04) rec.onFollow(pickOne(audience).user);
      if (rand() < 0.03) rec.onShare(pickOne(audience).user);
      rec.onViewers(audience.length + Math.floor(rand() * 30));
      t += 30000;
    }
    rec.onGameEnd({ ranking: [] });
    rec.finish('demo');
  }
  fs.rmSync(path.join(DEMO_DIR, 'state'), { recursive: true, force: true });
  console.log(`🎭 ${LIVES} directos de demostración en ${path.relative(process.cwd(), DEMO_DIR)}/sessions`);
}

main();
