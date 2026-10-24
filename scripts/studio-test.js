/**
 * scripts/studio-test.js — Prueba el pegado en el chat de TikTok LIVE Studio SIN enviar nada.
 *
 *   probar_studio.bat   (o npm run studio:test)
 *
 * Usa CHAT_X / CHAT_Y (y CHAT_INPUT_METHOD) del .env y los ajustes de escritura guardados desde el panel /bot: comprueba qué ventana hay en ese punto, hace el clic,
 * mira si Studio queda activo y pega un texto de prueba. No pulsa Enter: si el texto aparece en la caja de
 * chat, funciona (bórralo a mano).
 */

'use strict';

const config = require('../server/src/config');
const fs = require('fs');
const path = require('path');
const { createStudioPaster } = require('../server/src/chatbot/studio');

const savedSettings = () => {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, '../server/.chatbot-studio.json'), 'utf8')); } catch { return {}; }
};

const WAIT_S = 5;
const TEXT = 'FlagMaster test ✍️ (no enviar)';

(async () => {
  const studio = createStudioPaster({ x: config.CHAT_X, y: config.CHAT_Y, settings: { method: config.CHAT_INPUT_METHOD, ...savedSettings() }, log: () => {} });
  console.log(`🧪 Prueba del chat de Studio en (${config.CHAT_X}, ${config.CHAT_Y}) · método: ${studio.getSettings().method}`);
  console.log('   Deja Studio visible, en su sitio, y NO toques el ratón.\n');
  for (let s = WAIT_S; s > 0; s--) {
    process.stdout.write(`\r   Empieza en ${s} s... `);
    await new Promise(r => setTimeout(r, 1000));
  }
  console.log('\n');
  try {
    const r = await studio.dryRun(TEXT);
    console.log(`✅ Ventana en el punto: ${r.target || '(no comprobado)'}`);
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
