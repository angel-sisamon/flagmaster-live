/**
 * scripts/vtuber-test.js — Prueba el avatar en VTube Studio sin directo ni juego.
 *
 *   probar_vtuber.bat   (o npm run vtuber:test)
 *
 * Se conecta a la API de VTube Studio (VTUBER_URL, por defecto ws://127.0.0.1:8001), la primera vez pide
 * permiso (pulsa "Permitir" en VTube Studio), lista los hotkeys y expresiones del modelo, dice cuáles ha
 * reconocido para cada intención y hace una tanda de reacciones para verlas en pantalla.
 */

'use strict';

const path = require('path');
const config = require('../server/src/config');
const { createVTuber } = require('../server/src/vtuber');

const DEMO = [
  ['greeting', {}, 'Saludo ("hola" en el chat)'],
  ['round:question', {}, 'Pregunta nueva'],
  ['round:results', { totalVotes: 10, correctPct: 10 }, 'Casi nadie acierta'],
  ['round:results', { totalVotes: 10, correctPct: 95 }, 'Aciertan casi todos'],
  ['round:results', { totalVotes: 10, correctPct: 45 }, 'Falla la mitad'],
  ['gift', { diamonds: 100 }, 'Regalo grande'],
  ['command', { text: '!love' }, 'Comando !love'],
  ['command', { text: '!laugh' }, 'Comando !laugh'],
  ['game:over', {}, 'Fin de la partida'],
];
const GAP_MS = 5500;
const CONNECT_TIMEOUT_MS = 130000;
const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  console.log(`🧪 Prueba del avatar en VTube Studio (${config.VTUBER_URL})`);
  console.log('   VTube Studio abierto, con un modelo cargado y la API activada (Ajustes → "Iniciar API").\n');
  const vtuber = createVTuber({
    url: config.VTUBER_URL,
    tokenFile: path.join(__dirname, '../server/.vtuber-token'),
    mapFile: path.join(__dirname, '../server/.vtuber-map.json'),
  });
  vtuber.start();

  const start = Date.now();
  while (!(vtuber.status().model) && Date.now() - start < CONNECT_TIMEOUT_MS) await wait(300);
  const st = vtuber.status();
  if (!st.model) {
    console.log(`\n❌ No se pudo conectar: ${st.message}`);
    console.log('   ¿Está VTube Studio abierto? ¿Ajustes → "Iniciar API" activado en el puerto 8001?');
    vtuber.stop();
    return setTimeout(() => process.exit(1), 300);
  }

  const m = st.model;
  console.log(`\n✅ Conectado. Modelo: ${m.model || '(ninguno cargado: carga uno en VTube Studio)'}`);
  console.log(`   Hotkeys (${m.hotkeys.length}): ${m.hotkeys.join(', ') || '-'}`);
  console.log(`   Expresiones (${m.expressions.length}): ${m.expressions.join(', ') || '-'}`);
  console.log('\n   Lo que usará el avatar:');
  const intents = [...new Set([...Object.keys(m.resolved.anim), ...Object.keys(m.resolved.face)])];
  for (const i of intents) {
    console.log(`     ${i.padEnd(10)} animación: ${m.resolved.anim[i] || '-'} · expresión: ${m.resolved.face[i] || '-'}`);
  }
  if (!intents.length) console.log('     (nada reconocido: solo moverá la cabeza. Ver README "Avatar VTuber" para el mapa a mano)');

  console.log('\n▶️  Tanda de reacciones (mira VTube Studio):');
  for (const [event, data, label] of DEMO) {
    console.log(`   · ${label}: ${vtuber.trigger(event, data)}`);
    await wait(GAP_MS);
  }
  console.log('\n✅ Hecho. Si la cabeza se movió, la conexión funciona.');
  vtuber.stop();
  setTimeout(() => process.exit(0), 400);
})();
