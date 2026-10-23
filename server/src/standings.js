/**
 * server/src/standings.js — Clasificación del mes durante el directo.
 *
 * Suma las sesiones ya guardadas del mes (data/sessions/AAAA-MM/) y la sesión en curso con la misma
 * lógica que la web (shared/stats.js), así "!yo" y el TOP de la sala coinciden con lo que luego
 * se publica. Las sesiones guardadas se leen una vez y se recargan al cerrar una sesión o cambiar de mes.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { aggregate, monthKey } = require('../../shared/stats');
const { readJson } = require('./recorder');

const TOP_SIZE = 3;

function createStandings({ dataDir, timeZone, recorder, moderation }) {
  let cache = { month: null, sessions: [] };
  let result = null;

  function loadMonth(month) {
    const dir = path.join(dataDir, 'sessions', month);
    let files = [];
    try { files = fs.readdirSync(dir).filter(f => f.endsWith('.json')); } catch (e) { /* mes sin directos aún */ }
    cache = { month, sessions: files.map(f => readJson(path.join(dir, f))).filter(Boolean) };
  }

  /* Recalcula; month: el de la sesión en curso o, si no hay, el actual */
  function refresh() {
    const live = recorder.current();
    const month = live ? live.month : monthKey(new Date(), timeZone);
    if (cache.month !== month) loadMonth(month);
    const sessions = cache.sessions.filter(s => !live || s.id !== live.id);
    if (live) sessions.push(live);
    result = { month, agg: aggregate(sessions, { moderation: moderation.rules() }) };
    return result;
  }

  function reload() {
    cache.month = null;
    return refresh();
  }

  /* Payload de month:update para la sala de espera */
  function payload() {
    const r = result || refresh();
    const ranked = r.agg.players.filter(p => p.pos > 0);
    return {
      month: r.month,
      players: ranked.length,
      top: ranked.slice(0, TOP_SIZE).map(p => ({ nickname: p.n || p.u, points: p.pts, gained: 0 })),
    };
  }

  /* Puesto del mes de un jugador (para "!yo"); 0 si aún no ha puntuado */
  function positionOf(pid) {
    const r = result || refresh();
    const p = r.agg.players.find(x => x.id === pid);
    return p ? { position: p.pos, points: p.pts } : { position: 0, points: 0 };
  }

  return { refresh, reload, payload, positionOf };
}

module.exports = { createStandings };
