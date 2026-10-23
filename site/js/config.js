/**
 * site/js/config.js — Ajustes de la web de clasificaciones (lo único que hay que tocar a mano).
 */
var SITE_CONFIG = {
  // Ficha de Google Play con UTM: en Play Console → Adquisición se ve cuántas descargas llegan desde aquí
  playStoreUrl: 'https://play.google.com/store/apps/details?id=com.sisapicasso.flagmaster' +
    '&referrer=utm_source%3Dtiktok_live%26utm_medium%3Dleaderboard%26utm_campaign%3Dmonthly',
  // Vacío = "Próximamente" (botón desactivado)
  appStoreUrl: '',
  // Cuenta de TikTok que emite (sin @). Vacío = no se muestra el enlace
  tiktokUser: 'flagmaster_quiz',
  // Mínimos para las tablas de precisión y rapidez (evita que gane quien respondió 2 veces)
  minAnswersAccuracy: 30,
  minCorrectSpeed: 15,
  pageSize: 20,
  // Visitas: código de tu cuenta de goatcounter.com (lo que va antes de .goatcounter.com). Vacío = no se mide
  goatcounter: 'flagmaster-live'
};
