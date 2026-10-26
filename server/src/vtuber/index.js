/**
 * server/src/vtuber/index.js — Avatar VTuber en VTube Studio que reacciona al juego, al chat y a los regalos.
 *
 * Piezas: vts-client.js (conexión y autenticación) → avatar.js (qué sabe hacer el modelo) → behavior.js
 * (prioridades, sin solaparse) ← rules.js (qué hacer con cada evento).
 *
 * La boca NO se mueve desde aquí: VTube Studio la mueve con su lip-sync de micrófono, escuchando el audio del
 * navegador por el cable virtual (micrófono "CABLE Output" de VB-Audio). Ver README "Avatar VTuber".
 *
 *   onEmit(evento, datos)   todo lo que el servidor manda a la pantalla del directo (round:*, game:over, live:*)
 *   onChat(user, text)      saludos y comandos del público
 *   onGift(user, diamonds)  onFollow(user)
 *   trigger(evento, datos)  reacción a mano (endpoints de prueba)
 */

'use strict';

const fs = require('fs');
const { createVTSClient } = require('./vts-client');
const { createAvatar } = require('./avatar');
const { createBehavior } = require('./behavior');
const { INTENTS, reactionFor, commandFor } = require('./rules');
const { detectGreeting } = require('../chatbot/brain');

const COMMAND_COOLDOWN_MS = 20000;   // por persona
const SCREEN_EVENTS = new Set(['round:question', 'round:tick', 'round:results', 'game:over', 'live:join', 'live:like']);

function readMap(file) {
  if (!file) return {};
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (err) {
    if (err.code !== 'ENOENT') console.error(`⚠️  VTuber: ${file} no es un JSON válido: ${err.message}`);
    return {};
  }
}

function createVTuber({ url, tokenFile, mapFile, client: injectedClient, log = console.log }) {
  const client = injectedClient || createVTSClient({ url, tokenFile });
  const avatar = createAvatar({ client, intents: INTENTS, map: readMap(mapFile), log });
  const behavior = createBehavior({ avatar });
  const lastCommand = new Map();   // pid -> ms
  let model = null;

  // Sin VTube Studio abierto se reintenta sin parar: se avisa una vez, no en cada intento
  let saidDisconnected = false;
  client.on('state', (state, message) => {
    if (state === 'disconnected') {
      if (!saidDisconnected) log(`🎭 ${message} (el directo sigue sin avatar)`);
      saidDisconnected = true;
    } else if (state === 'connected' || state === 'waiting-approval') {
      log(`🎭 ${message}`);
      if (state === 'connected') saidDisconnected = false;
    }
  });
  client.on('ready', async () => {
    try {
      model = await avatar.refresh();
      const found = [...Object.keys(model.resolved.anim).map(k => `${k}→${model.resolved.anim[k]}`),
        ...Object.keys(model.resolved.face).map(k => `${k}→${model.resolved.face[k]}`)];
      log(`🎭 Modelo "${model.model || '(ninguno cargado)'}": ${found.length ? found.join(', ') : 'sin animaciones ni expresiones reconocidas (solo gestos de cabeza)'}`);
    } catch (err) {
      log(`⚠️  VTuber: no se pudo leer el modelo: ${err.message}`);
    }
  });

  function trigger(event, data) {
    const r = reactionFor(event, data);
    return r ? behavior.request(r) : 'none';
  }

  return {
    start() {
      client.start();
      avatar.start();
      behavior.start();
    },
    stop() {
      behavior.stop();
      avatar.clearFaces();
      avatar.stop();
      // Un momento para que salga el "quitar expresiones" antes de cerrar
      setTimeout(() => client.stop(), 150);
    },
    onEmit(event, data) {
      if (SCREEN_EVENTS.has(event)) trigger(event, data);
    },
    onChat(user, text) {
      if (commandFor(text)) {
        const now = Date.now();
        if (user && now - (lastCommand.get(user.pid) || 0) < COMMAND_COOLDOWN_MS) return 'cooldown';
        if (user) lastCommand.set(user.pid, now);
        return trigger('command', { text });
      }
      return detectGreeting(text) ? trigger('greeting') : 'none';
    },
    onGift: (user, diamonds) => trigger('gift', { diamonds }),
    onFollow: () => trigger('follow'),
    trigger,
    refresh: () => avatar.refresh().then(m => (model = m)),
    pause: () => behavior.pause(),
    resume: () => behavior.resume(),
    status: () => ({ enabled: true, ...client.status(), model, behavior: behavior.status() }),
  };
}

module.exports = { createVTuber };
