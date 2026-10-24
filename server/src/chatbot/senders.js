/**
 * server/src/chatbot/senders.js — Adónde va lo que "dice" el bot.
 *
 *   'suggest'  al panel de sugerencias (http://localhost:3000/bot): quien emite lo copia y lo pega en el chat
 *   'console'  solo a la consola (pruebas)
 *
 * El bot no escribe solo en TikTok: los comentarios de un navegador automatizado TikTok los oculta al resto del
 * directo (comprobado), y saltarse ese filtro va contra sus normas. Pegarlos a mano sí llega a todo el mundo.
 * Todos los senders: { name, start(), send(text, item) → bool, close() }.
 */

'use strict';

const HISTORY = 30;   // lo que ve el panel al abrirse (o al recargarlo)

function createConsoleSender() {
  return {
    name: 'console',
    async start() {},
    async send(text) { console.log(`🤖 [chat] ${text}`); return true; },
    async close() {},
  };
}

/* emit(event, payload) hacia el panel. Eventos: bot:suggestion, bot:update { id, text }, bot:used { id } */
function createSuggestSender({ emit, now = Date.now }) {
  const history = [];
  let seq = 0;

  function send(text, item) {
    const s = { id: ++seq, text, kind: (item && item.kind) || 'misc', meta: (item && item.meta) || null, at: now(), used: false };
    history.push(s);
    if (history.length > HISTORY) history.shift();
    emit('bot:suggestion', s);
    return true;
  }

  const find = id => history.find(s => s.id === Number(id));

  return {
    name: 'suggest',
    async start() {},
    async send(text, item) { return send(text, item); },
    async close() {},
    history: () => history.slice(),
    find,
    /* Cambia el texto de una sugerencia (botón "Otra") */
    update(id, text) {
      const s = find(id);
      if (!s || !text) return false;
      s.text = text;
      emit('bot:update', { id: s.id, text });
      return true;
    },
    /* El texto ha vuelto por el chat: quien emite ya lo ha pegado */
    markUsed(text, norm) {
      const s = [...history].reverse().find(h => !h.used && norm(h.text) === norm(text));
      if (!s) return false;
      s.used = true;
      emit('bot:used', { id: s.id });
      return true;
    },
  };
}

function createSender(kind, opts) {
  return kind === 'suggest' ? createSuggestSender(opts) : createConsoleSender();
}

module.exports = { createSender, createConsoleSender, createSuggestSender };
