/**
 * server/src/moderation.js — data/moderation.json: quién no sale en las clasificaciones públicas.
 *
 *   { "optout": ["p1a2b3c4d5e6", "@usuario"], "banned": ["@tramposo"] }
 *
 * "optout" lo rellena el propio espectador escribiendo !optout en el chat; "banned" se edita a mano.
 * Se admiten ids de jugador (los de data/sessions) o @usuarios. Los ocultos siguen contando en los
 * totales del directo, pero no aparecen en la web ni en el TOP del mes.
 */

'use strict';

const path = require('path');
const { createModeration, normHandle } = require('../../shared/stats');
const { readJson, writeJsonAtomic } = require('./recorder');

function createModerationStore(dataDir) {
  const file = path.join(dataDir, 'moderation.json');
  let json = readJson(file) || { optout: [], banned: [] };
  if (!Array.isArray(json.optout)) json.optout = [];
  if (!Array.isArray(json.banned)) json.banned = [];
  let rules = createModeration(json);

  /* Devuelve true si es una baja nueva (y la guarda en disco para publicarla con la sesión) */
  function optOut(user) {
    if (!user || rules.isHidden({ id: user.pid, u: user.handle })) return false;
    json.optout.push(user.pid);
    if (user.handle) json.optout.push('@' + normHandle(user.handle));
    writeJsonAtomic(file, json);
    rules = createModeration(json);
    return true;
  }

  return {
    optOut,
    isHidden: p => rules.isHidden(p),
    rules: () => rules,
  };
}

module.exports = { createModerationStore };
