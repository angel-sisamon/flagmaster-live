/**
 * scripts/studio-coords.js — Muestra dónde está el ratón para rellenar CHAT_X / CHAT_Y del .env.
 *
 *   coordenadas_chat.bat   (o npm run studio:coords)
 *
 * Abre TikTok LIVE Studio, pon el ratón encima de la caja donde se escribe en el chat y espera:
 * la última posición que se muestre es la buena.
 */

'use strict';

let robot;
try { robot = require('@jitsi/robotjs'); } catch {
  console.error('❌ Falta @jitsi/robotjs: ejecuta "npm install"');
  process.exit(1);
}

const SECONDS = 15;
console.log(`🖱️  Pon el ratón sobre la caja de chat de TikTok LIVE Studio y no lo muevas (${SECONDS} s)...\n`);
let last = null;
let left = SECONDS * 2;
const timer = setInterval(() => {
  last = robot.getMousePos();
  process.stdout.write(`\r   CHAT_X=${last.x}   CHAT_Y=${last.y}      `);
  if (--left > 0) return;
  clearInterval(timer);
  console.log(`\n\n✅ Copia estas dos líneas en tu .env:\n\nCHAT_X=${last.x}\nCHAT_Y=${last.y}\n`);
}, 500);
