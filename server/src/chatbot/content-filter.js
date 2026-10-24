/**
 * server/src/chatbot/content-filter.js — Lo que el bot NUNCA dice.
 *
 * Nada de pedir likes / tap tap, follows, compartir, regalos o enlaces: el bot anima el chat, no hace marketing.
 * Se aplica al cargar las frases (una frase que no pasa se descarta con aviso) y otra vez justo antes de
 * enviar cada mensaje, así que tampoco se cuela por un {user} o por un idioma nuevo.
 * Los patrones cubren inglés y español; al añadir un idioma, añade aquí sus equivalentes.
 */

'use strict';

const BLOCKED = [
  // likes / tap tap
  /\blik(e|es|ing)\s+(the|this|my|our)\s+(live|stream|video)\b/i, /\b(drop|leave|send|give|smash|hit)\s+(a\s+|some\s+|the\s+)?likes?\b/i,
  /\btap(\s|-)?tap\b/i, /\btap\s+(the\s+)?screen\b/i, /\blikes?\s+(goal|target)\b/i, /\b\d+k?\s+likes\b/i,
  /\bme\s+gusta\b/i, /\bdale\s+(like|amor)\b/i, /\btoca(d)?\s+(la\s+)?pantalla\b/i,
  // seguir / suscribirse
  /\bfollow(ers?|ing)?\b/i, /\bsubscri(be|bed|ption)\b/i, /\bsub\s+to\b/i,
  /\bs[ií]gue(me|nos)?\b/i, /\bseguidores?\b/i, /\bsuscr[ií]b/i,
  // compartir / invitar
  /\bshar(e|ing)\b/i, /\b(invite|tag|bring|send\s+this\s+to)\s+(your\s+)?(friends?|mates?|everyone)\b/i,
  /\bcompart(e|id|ir)/i, /\binvita\s+a\b/i, /\bmanda(lo|selo)?\s+a\b/i,
  // regalos / dinero / ventas / enlaces
  /\bgifts?\b/i, /\bdonat/i, /\bcoins?\b/i, /\broses?\b/i, /\bregalo/i, /\bmonedas\b/i,
  /\b(buy|sale|discount|promo|download|install)\b/i, /\b(compra|descarga|oferta)/i,
  /\blink\s+in\s+(my\s+)?bio\b/i, /https?:\/\//i, /www\./i, /\.(com|net|io|app)\b/i,
];

function blockedReason(text) {
  const re = BLOCKED.find(r => r.test(String(text || '')));
  return re ? re.source : null;
}

const isAllowed = text => !blockedReason(text);

module.exports = { isAllowed, blockedReason };
