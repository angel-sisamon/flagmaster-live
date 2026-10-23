/**
 * js/share-links.js — Centralización de URLs de tienda y enlaces compartidos
 *
 * Toda la lógica de "qué URL pongo en un mensaje compartido / botón de
 * descarga" vive aquí, para no tener strings hardcodeados por toda la app.
 *
 * Expone window.ShareLinks con:
 *   · BUNDLE_ID       — identificador único de la app (Android/iOS).
 *   · PLAY_STORE_URL  — URL real de la ficha en Google Play.
 *   · APP_STORE_URL   — null hasta que exista build de iOS publicada.
 *   · getPlatform()       → 'android' | 'ios' | 'web'
 *   · getStoreUrl()       → URL de descarga adecuada para la plataforma actual.
 *   · getShareUrl(opts)   → URL canónica a poner dentro de un mensaje
 *                           ({type:'app'} o {type:'duel', code}).
 *   · getShareFooter()    → "{texto «¿Puedes superarme?»} <url>" listo para
 *                           pegar al final del mensaje.
 *   · setRemoteUrls(obj)  → permite que UpdateChecker sobrescriba las URLs
 *                           con valores recibidos de Firestore (app_config).
 *
 * ORDEN DE CARGA: justo después de i18n.js y antes de cualquier módulo que
 * comparta resultados (ui.js, leaderboard-ui.js, duels.js, duels-ui.js,
 * app-review.js).
 * Patrón: IIFE global, ES5, sin dependencias nuevas.
 */

var ShareLinks = (function () {

  /* ── Constantes ──────────────────────────────────────── */

  var BUNDLE_ID      = 'com.sisapicasso.flagmaster';
  var PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=' + BUNDLE_ID;
  /* TODO: rellenar cuando la build de iOS esté publicada en App Store. */
  var APP_STORE_URL  = null;

  /* Overrides remotos (Firestore app_config/current).
     Si están presentes, ganan sobre las constantes anteriores. */
  var _remote = {
    android: null,
    ios:     null
  };

  /* ── Detección de plataforma ─────────────────────────── */

  /**
   * getPlatform() → 'android' | 'ios' | 'web'
   *
   * Prioridad:
   *   1) Capacitor (build nativa): valor fiable.
   *   2) navigator.userAgentData.platform (Chromium moderno).
   *   3) navigator.userAgent (heurística clásica).
   */
  function getPlatform() {
    try {
      if (window.Capacitor && typeof window.Capacitor.getPlatform === 'function') {
        var p = window.Capacitor.getPlatform();
        if (p === 'android' || p === 'ios') return p;
        /* 'web' → seguir con la heurística por si estamos en un navegador móvil */
      }
    } catch (e) {}

    var uad = (typeof navigator !== 'undefined') ? navigator.userAgentData : null;
    if (uad && typeof uad.platform === 'string') {
      var pl = uad.platform.toLowerCase();
      if (pl.indexOf('android') !== -1) return 'android';
      /* userAgentData no expone iOS aún, cae al UA tradicional */
    }

    var ua = (typeof navigator !== 'undefined' && navigator.userAgent) ? navigator.userAgent : '';
    if (/android/i.test(ua)) return 'android';
    if (/iphone|ipad|ipod/i.test(ua)) return 'ios';
    /* iPadOS 13+ se presenta como Mac con touch */
    if (ua && /macintosh/i.test(ua) &&
        navigator.maxTouchPoints && navigator.maxTouchPoints > 1) {
      return 'ios';
    }

    return 'web';
  }

  /* ── URLs efectivas (con override remoto) ───────────── */

  function _effectiveAndroidUrl() {
    return _remote.android || PLAY_STORE_URL;
  }
  function _effectiveIosUrl() {
    return _remote.ios || APP_STORE_URL; /* puede ser null */
  }

  /**
   * getStoreUrl() → URL de descarga según plataforma del emisor.
   *
   * Política actual (sin landing redirectora propia):
   *   · android  → Play Store
   *   · ios      → App Store si existe, si no Play Store (mejor un link
   *                que ninguno; el usuario verá "no disponible" si pincha
   *                desde un dispositivo sin ficha publicada).
   *   · web/?    → Play Store por defecto (caso mayoritario hoy).
   *
   * Nota: la decisión correcta es la de la plataforma del RECEPTOR del
   * mensaje, no la del emisor. Cuando exista landing en dominio propio
   * con detección por User-Agent (Parte 3 del plan), esta función debería
   * devolver esa URL universal en lugar de la URL directa de la tienda.
   */
  function getStoreUrl() {
    var platform = getPlatform();
    if (platform === 'ios') {
      return _effectiveIosUrl() || _effectiveAndroidUrl();
    }
    return _effectiveAndroidUrl();
  }

  /**
   * getShareUrl({type, code}) → URL a incrustar en un mensaje compartido.
   *
   *   · type 'app'  → URL de descarga (getStoreUrl()).
   *   · type 'duel' → URL del duelo. Cuando exista Universal/App Link
   *                   (Parte 3 del plan), aquí se devolverá
   *                   'https://flagmaster.app/duel/{code}' para que el SO
   *                   abra la app si está instalada y la web redirija a
   *                   la store si no. Hasta entonces se devuelve la URL
   *                   de la store como fallback seguro.
   */
  function getShareUrl(opts) {
    opts = opts || {};
    /* TODO Parte 3: cuando los Universal/App Links estén operativos en el
       dominio propio, devolver 'https://flagmaster.app/duel/' + opts.code
       para opts.type === 'duel'. */
    return getStoreUrl();
  }

  /**
   * getShareFooter() → string "{texto reto}\n{url}" listo para concatenar
   * al final del mensaje compartido (sustituye al "🌍 flagmaster.app" mock).
   */
  function getShareFooter() {
    var msg = (typeof t === 'function') ? t('share_challenge') : '';
    var url = getStoreUrl();
    if (!msg) return url;
    return msg + '\n' + url;
  }

  /* ── Override remoto desde Firestore (UpdateChecker) ── */

  /**
   * setRemoteUrls({android, ios}) — admite ambos nombres documentados:
   *   · data.storeUrls   (nombre nuevo, plan de implementación)
   *   · data.updateUrl   (nombre ya usado en update-checker.js)
   *
   * Solo se aplican valores http(s) válidos; cualquier otra cosa se ignora
   * para no romper si el documento llega con datos inesperados.
   */
  function setRemoteUrls(obj) {
    if (!obj || typeof obj !== 'object') return;
    if (typeof obj.android === 'string' && /^https?:\/\//i.test(obj.android)) {
      _remote.android = obj.android;
    }
    if (typeof obj.ios === 'string' && /^https?:\/\//i.test(obj.ios)) {
      _remote.ios = obj.ios;
    }
  }

  /* ── API pública ─────────────────────────────────────── */
  return {
    BUNDLE_ID:      BUNDLE_ID,
    PLAY_STORE_URL: PLAY_STORE_URL,
    APP_STORE_URL:  APP_STORE_URL,
    getPlatform:    getPlatform,
    getStoreUrl:    getStoreUrl,
    getShareUrl:    getShareUrl,
    getShareFooter: getShareFooter,
    setRemoteUrls:  setRemoteUrls
  };
})();

if (typeof window !== 'undefined') {
  window.ShareLinks = ShareLinks;
}
