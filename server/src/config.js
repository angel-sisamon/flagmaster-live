/**
 * server/src/config.js — Configuración del servidor LIVE (variables de entorno, ver .env.example).
 */

'use strict';

const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

function flag(value, fallback) {
  if (value == null || value === '') return fallback;
  return !/^(0|false|no|off)$/i.test(String(value).trim());
}

const TIKTOK_USERNAME = (process.argv[2] || process.env.TIKTOK_USERNAME || '').replace(/^@/, '').trim();

module.exports = {
  ROOT,
  PORT: Number(process.env.PORT) || 3000,
  TIKTOK_USERNAME,
  EULER_API_KEY: process.env.EULER_API_KEY || '',

  // Copia del juego que usa el directo (game/, se actualiza con "npm run sync:game"): se sirve tal cual
  // y de ahí salen países y modos. FLAGMASTER_WWW permite probar con otra carpeta del juego.
  GAME_DIR: process.env.FLAGMASTER_WWW || path.join(ROOT, 'game'),
  CLIENT_DIR: path.join(ROOT, 'client'),

  // Datos: data/ va al repo (fuente de la web); server/.live/ es estado local (copia de seguridad del directo)
  // (LIVE_DATA_DIR / LIVE_STATE_DIR solo para pruebas: grabar fuera del repo)
  DATA_DIR: process.env.LIVE_DATA_DIR || path.join(ROOT, 'data'),
  STATE_DIR: process.env.LIVE_STATE_DIR || path.join(ROOT, 'server', '.live'),

  // Zona horaria que decide a qué mes pertenece un directo
  TIME_ZONE: process.env.LIVE_TZ || 'Europe/Madrid',
  // Web de clasificaciones: si no está vacía, el directo anuncia "link en la bio" (la URL no se pinta)
  SITE_URL: process.env.LIVE_SITE_URL != null ? process.env.LIVE_SITE_URL : 'angel-sisamon.github.io/flagmaster-live',

  // Sin usuario de TikTok (modo prueba) no se graba nada salvo que se pida con LIVE_RECORD=1
  RECORD: flag(process.env.LIVE_RECORD, !!TIKTOK_USERNAME),
  // Al cerrar el directo: commit + push de data/ para que GitHub Actions publique la web
  AUTOPUBLISH: flag(process.env.LIVE_AUTOPUBLISH, true),

  // Bot del chat (server/src/chatbot): saluda, recuerda que se vota con la letra y anima el chat cuando está parado.
  // 'suggest' lo propone en el panel http://localhost:3000/bot para copiarlo y pegarlo; 'console' solo a la consola.
  CHATBOT: flag(process.env.CHATBOT, false),
  CHATBOT_SENDER: process.env.CHATBOT_SENDER === 'console' ? 'console' : 'suggest',
  CHATBOT_LANG: process.env.CHATBOT_LANG || 'en',
  CHATBOT_ACCOUNT: (process.env.CHATBOT_ACCOUNT || TIKTOK_USERNAME).replace(/^@/, '').trim(),
  CHATBOT_IDLE_SECONDS: [Number(process.env.CHATBOT_IDLE_MIN) || 45, Number(process.env.CHATBOT_IDLE_MAX) || 90],
  // Abre el panel de sugerencias en el navegador al arrancar (solo Windows)
  CHATBOT_OPEN_PANEL: flag(process.env.CHATBOT_OPEN_PANEL, true),
  // Botón "Enviar a Studio" del panel: pega el mensaje en el chat de TikTok LIVE Studio con ratón y teclado.
  // CHAT_X / CHAT_Y = la caja de chat de Studio en pantalla (coordenadas_chat.bat)
  CHATBOT_STUDIO: flag(process.env.CHATBOT_STUDIO, false),
  CHAT_X: process.env.CHAT_X === undefined || process.env.CHAT_X === '' ? NaN : Number(process.env.CHAT_X),
  CHAT_Y: process.env.CHAT_Y === undefined || process.env.CHAT_Y === '' ? NaN : Number(process.env.CHAT_Y),
  // 'paste' (Ctrl+V) o 'type' (teclea el texto), por si Studio no acepta el pegado
  CHAT_INPUT_METHOD: process.env.CHAT_INPUT_METHOD === 'type' ? 'type' : 'paste',

  // Avatar VTuber (server/src/vtuber): reacciona al juego y al chat en VTube Studio (API WebSocket).
  // La boca la mueve VTube Studio con su lip-sync de micrófono (cable virtual), no este servidor.
  VTUBER: flag(process.env.VTUBER, false),
  VTUBER_URL: process.env.VTUBER_URL || 'ws://127.0.0.1:8001',

  ANSWER_SECONDS: 20,
  RESULTS_SECONDS: 10,
  RECONNECT_MS: 15000,
  // Un directo caído (cierre o cuelgue) se retoma si se vuelve a arrancar antes de este margen
  RESUME_WINDOW_MS: 30 * 60 * 1000,
};
