/**
 * scripts/studio-test.js — Prueba el pegado en el chat de TikTok LIVE Studio SIN enviar nada.
 *
 *   probar_studio.bat   (o npm run studio:test)
 *
 * Usa CHAT_X / CHAT_Y, el margen CHAT_SPREAD_X / CHAT_SPREAD_Y (y CHAT_INPUT_METHOD) del .env y los ajustes de escritura guardados desde el panel /bot: comprueba qué ventana hay en ese punto, hace el clic,
 * mira si Studio queda activo y pega un texto de prueba. No pulsa Enter: si el texto aparece en la caja de
 * chat, funciona (bórralo a mano).
 */

'use strict';

const config = require('../server/src/config');
const fs = require('fs');
const path = require('path');
const { createStudioPaster } = require('../server/src/chatbot/studio');
const win32 = require('../server/src/chatbot/win32');

const savedSettings = () => {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, '../server/.chatbot-studio.json'), 'utf8')); } catch { return {}; }
};

const WAIT_S = 5;
const TEXT = 'FlagMaster test ✍️ (no enviar)';

(async () => {
  const spreadCfg = { x: config.CHAT_SPREAD_X, y: config.CHAT_SPREAD_Y };
  const studio = createStudioPaster({ x: config.CHAT_X, y: config.CHAT_Y, spread: spreadCfg, settings: { method: config.CHAT_INPUT_METHOD, ...savedSettings() }, log: () => {} });
  const sp = studio.getSpread();
  console.log(`🧪 Prueba del chat de Studio en (${config.CHAT_X}, ${config.CHAT_Y}) ±${sp.x}/±${sp.y} px · método: ${studio.getSettings().method}`);
  console.log('   Deja Studio visible, en su sitio, y NO toques el ratón.\n');
  for (let s = WAIT_S; s > 0; s--) {
    process.stdout.write(`\r   Empieza en ${s} s... `);
    await new Promise(r => setTimeout(r, 1000));
  }
  console.log('\n');
  // Las cuatro esquinas del margen tienen que caer en Studio (y, mirándolo tú, dentro de la caja de chat)
  const w = win32.load();
  if (w && Number.isFinite(config.CHAT_X) && Number.isFinite(config.CHAT_Y)) {
    for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const px = config.CHAT_X + dx * sp.x, py = config.CHAT_Y + dy * sp.y;
      const win = w.windowAt(px, py);
      console.log(`${win32.isStudio(win) ? '✅' : '❌'} Esquina (${px}, ${py}): ${win32.label(win)}`);
    }
    console.log('');
  }
  try {
    const r = await studio.dryRun(TEXT);
    console.log(`✅ Clic en (${r.click.x}, ${r.click.y}) · ventana en el punto: ${r.target || '(no comprobado)'}`);
    if (r.focus && r.focus.checked) {
      console.log(`✅ Ventana activa tras el clic: ${r.focus.active}${r.retried ? ' (hizo falta un 2º clic)' : ''}`);
      console.log(`   Control con el foco: ${r.focus.focusClass || '?'} · cursor de texto: ${r.focus.caret ? 'sí' : 'no detectado (normal en Studio)'}`);
    }
    console.log(`\n👀 Mira la caja de chat de Studio: ¿pone "${TEXT}"?`);
    console.log('   · SÍ → funciona. Bórralo a mano (no se ha enviado).');
    console.log('   · NO → prueba CHAT_INPUT_METHOD=type en .env y repite; si tampoco, pásale este texto a Claude.');
  } catch (err) {
    console.log(`❌ Falló en "${err.stage || 'error'}": ${err.message}`);
  }
})();
