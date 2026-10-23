/**
 * server/src/identity.js — Identificador estable de cada espectador.
 *
 * El @usuario se puede cambiar en TikTok; el id numérico no. Para acumular un mes entero se usa
 * el id numérico, pero cifrado (sha256 truncado): en el repo público y en la web nunca aparece
 * el id real, solo el @ y el nick, que ya son públicos en el chat.
 */

'use strict';

const crypto = require('crypto');

function playerId(key) {
  return 'p' + crypto.createHash('sha256').update('flagmaster-live:' + key).digest('hex').slice(0, 12);
}

/* Acepta el usuario de tiktok-live-connector v2 (protobuf: id / displayId) y v1 (userId / uniqueId) */
function fromTikTokUser(user) {
  if (!user) return null;
  const raw = [user.userId, user.id, user.idStr].map(v => (v == null ? '' : String(v))).find(v => v && v !== '0');
  const handle = String(user.uniqueId || user.displayId || '').trim();
  const key = raw || (handle ? '@' + handle.toLowerCase() : '');
  if (!key) return null;
  return { pid: playerId(key), handle, nickname: String(user.nickname || handle || 'anon') };
}

module.exports = { playerId, fromTikTokUser };
