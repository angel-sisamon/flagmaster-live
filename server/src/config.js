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

  // Carpeta www del juego (repo flag-master): se sirve tal cual y de ahí salen países y modos
  GAME_DIR: process.env.FLAGMASTER_WWW || path.join(ROOT, '..', 'flagmaster-capacitor', 'www'),
  CLIENT_DIR: path.join(ROOT, 'client'),

  // Datos: data/ va al repo (fuente de la web); server/.live/ es estado local (copia de seguridad del directo)
  // (LIVE_DATA_DIR / LIVE_STATE_DIR solo para pruebas: grabar fuera del repo)
  DATA_DIR: process.env.LIVE_DATA_DIR || path.join(ROOT, 'data'),
  STATE_DIR: process.env.LIVE_STATE_DIR || path.join(ROOT, 'server', '.live'),

  // Zona horaria que decide a qué mes pertenece un directo
  TIME_ZONE: process.env.LIVE_TZ || 'Europe/Madrid',
  // Web de clasificaciones que se anuncia en el directo (sin https://, se lee en pantalla)
  SITE_URL: process.env.LIVE_SITE_URL != null ? process.env.LIVE_SITE_URL : 'angel-sisamon.github.io/flagmaster-live',

  // Sin usuario de TikTok (modo prueba) no se graba nada salvo que se pida con LIVE_RECORD=1
  RECORD: flag(process.env.LIVE_RECORD, !!TIKTOK_USERNAME),
  // Al cerrar el directo: commit + push de data/ para que GitHub Actions publique la web
  AUTOPUBLISH: flag(process.env.LIVE_AUTOPUBLISH, true),

  ANSWER_SECONDS: 20,
  RESULTS_SECONDS: 10,
  RECONNECT_MS: 15000,
  // Un directo caído (cierre o cuelgue) se retoma si se vuelve a arrancar antes de este margen
  RESUME_WINDOW_MS: 30 * 60 * 1000,
};
