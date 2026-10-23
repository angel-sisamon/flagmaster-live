/**
 * js/update-checker.js — Comprobación de versión al inicio de la app
 *
 * Lee app_config/current de Firestore y compara con window.AppConfig.version.
 *   · maintenance === true              → modal mantenimiento (bloquea)
 *   · version local < minVersion        → modal actualización obligatoria (bloquea)
 *   · forceUpdate === true              → modal actualización obligatoria (bloquea)
 *   · version local < latestVersion     → banner suave (no bloquea, cerrable)
 *   · todo OK                           → resuelve sin hacer nada
 *   · Firestore falla / timeout 3s      → fail-open (resuelve y la app arranca)
 *
 * check() SIEMPRE resuelve con {status, blocked, data}:
 *   status: 'ok' | 'soft-update' | 'force-update' | 'maintenance' | 'fail-open'
 *   blocked: boolean (true para 'force-update' y 'maintenance')
 *   data: objeto de Firestore o null
 *
 * Caché: guarda la respuesta en localStorage (TTL 1 hora) para reducir
 * lecturas de Firestore en cada apertura.
 *
 * ORDEN DE CARGA: después de config.js, i18n.js, storage.js y antes de main.js
 * Patrón: IIFE global, ES5, sin dependencias nuevas.
 */

var UpdateChecker = (function () {

  var CACHE_KEY    = 'update_checker_cache';
  var CACHE_TTL_MS = 60 * 60 * 1000; // 1 hora
  var TIMEOUT_MS   = 3000;            // 3 segundos

  var _blocked = false;
  var _softUpdateShownThisSession = false;

  /* ── Comparación semver ─────────────────────────────── */

  function _parseSemver(v) {
    var parts = String(v || '0.0.0').split('.');
    return {
      major: parseInt(parts[0], 10) || 0,
      minor: parseInt(parts[1], 10) || 0,
      patch: parseInt(parts[2], 10) || 0
    };
  }

  /** Devuelve negativo si a < b, 0 si iguales, positivo si a > b */
  function _compareSemver(a, b) {
    var av = _parseSemver(a);
    var bv = _parseSemver(b);
    if (av.major !== bv.major) return av.major - bv.major;
    if (av.minor !== bv.minor) return av.minor - bv.minor;
    return av.patch - bv.patch;
  }

  /* ── Caché localStorage ─────────────────────────────── */

  function _loadCache() {
    try {
      var cached = storageLoad(CACHE_KEY, null);
      if (!cached || typeof cached.ts !== 'number' || !cached.data) return null;
      if (Date.now() - cached.ts > CACHE_TTL_MS) return null;
      return cached.data;
    } catch (e) { return null; }
  }

  function _saveCache(data) {
    try { storageSave(CACHE_KEY, { ts: Date.now(), data: data }); } catch (e) {}
  }

  /* ── Modales y banner ───────────────────────────────── */

  function _showUpdateModal(data) {
    var modal   = document.getElementById('modal-update');
    var titleEl = document.getElementById('update-title');
    var bodyEl  = document.getElementById('update-body');
    var btnEl   = document.getElementById('btn-update');
    if (!modal) return;

    if (titleEl) titleEl.textContent = (typeof t === 'function') ? t('update_required_title') : 'Update required';
    if (bodyEl)  bodyEl.textContent  = (typeof t === 'function') ? t('update_required_body')  : 'Please update the app to continue.';
    if (btnEl) {
      btnEl.textContent = (typeof t === 'function') ? t('update_button') : 'Update';
      var url = '';
      if (data && data.updateUrl && typeof data.updateUrl === 'object') {
        var platform = (window.Capacitor && typeof window.Capacitor.getPlatform === 'function')
          ? window.Capacitor.getPlatform()
          : 'web';
        url = (platform === 'ios')
          ? (data.updateUrl.ios || '')
          : (data.updateUrl.android || '');
      }
      if (!url) {
        btnEl.style.display = 'none';
      } else {
        btnEl.onclick = function () {
          try {
            if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Browser) {
              window.Capacitor.Plugins.Browser.open({ url: url });
            } else {
              window.open(url, '_blank');
            }
          } catch (e) { window.open(url, '_blank'); }
        };
      }
    }
    modal.style.display = 'flex';
  }

  function _showMaintenanceModal(data) {
    var modal   = document.getElementById('modal-maintenance');
    var titleEl = document.getElementById('maintenance-title');
    var bodyEl  = document.getElementById('maintenance-body');
    var retryBtn = document.getElementById('btn-maintenance-retry');
    if (!modal) return;

    var lang = (typeof getLang === 'function') ? getLang() : 'es';
    var customMsg = (data && data.maintenanceMessage && data.maintenanceMessage[lang])
      ? data.maintenanceMessage[lang]
      : null;

    if (titleEl) titleEl.textContent = (typeof t === 'function') ? t('maintenance_title') : 'Under maintenance';
    if (bodyEl)  bodyEl.textContent  = customMsg || ((typeof t === 'function') ? t('maintenance_body') : 'We are updating. Please come back soon.');
    if (retryBtn) {
      retryBtn.textContent = (typeof t === 'function') ? t('retry_button') : 'Retry';
      retryBtn.onclick = function () {
        var originalText = retryBtn.textContent;
        retryBtn.disabled = true;
        retryBtn.textContent = '⏳';
        UpdateChecker.recheck().then(function (result) {
          if (!result.blocked) {
            window.location.reload();
          } else {
            /* Sigue en mantenimiento: restaurar botón y actualizar mensaje */
            retryBtn.disabled = false;
            retryBtn.textContent = originalText;
            if (bodyEl) {
              var lang2 = (typeof getLang === 'function') ? getLang() : 'es';
              var freshMsg = (result.data && result.data.maintenanceMessage && result.data.maintenanceMessage[lang2])
                ? result.data.maintenanceMessage[lang2]
                : null;
              bodyEl.textContent = freshMsg || ((typeof t === 'function') ? t('maintenance_body') : 'We are updating. Please come back soon.');
            }
          }
        });
      };
    }
    modal.style.display = 'flex';
  }

  function _showSoftUpdateBanner() {
    if (_softUpdateShownThisSession) return;
    _softUpdateShownThisSession = true;

    var banner   = document.getElementById('banner-soft-update');
    var msgEl    = document.getElementById('banner-soft-update-msg');
    var closeBtn = document.getElementById('btn-banner-soft-close');
    if (!banner) return;

    if (msgEl) msgEl.textContent = (typeof t === 'function') ? t('update_available_body') : 'A new version is available.';
    banner.style.display = 'flex';

    if (closeBtn) {
      closeBtn.onclick = function () { banner.style.display = 'none'; };
    }
  }

  /* ── Fetch de Firestore con timeout ─────────────────── */

  function _fetchFromFirestore() {
    return new Promise(function (resolve, reject) {
      var done = false;

      var timer = setTimeout(function () {
        if (!done) { done = true; reject(new Error('timeout')); }
      }, TIMEOUT_MS);

      try {
        var db = firebase.firestore();
        db.collection('app_config').doc('current').get().then(function (doc) {
          if (!done) {
            done = true;
            clearTimeout(timer);
            if (doc.exists) {
              resolve(doc.data());
            } else {
              reject(new Error('no_doc'));
            }
          }
        }).catch(function (err) {
          if (!done) { done = true; clearTimeout(timer); reject(err); }
        });
      } catch (e) {
        if (!done) { done = true; clearTimeout(timer); reject(e); }
      }
    });
  }

  /* ── Lógica de evaluación ───────────────────────────── */

  function _evaluate(data, resolve) {
    /* Reenviar URLs de tienda a ShareLinks para que los mensajes
       compartidos puedan usar URLs actualizadas remotamente sin
       desplegar versión nueva. Admite los dos nombres documentados:
       storeUrls (plan share-links) y updateUrl (esquema legacy). */
    try {
      if (window.ShareLinks && typeof window.ShareLinks.setRemoteUrls === 'function') {
        if (data && data.storeUrls) window.ShareLinks.setRemoteUrls(data.storeUrls);
        else if (data && data.updateUrl) window.ShareLinks.setRemoteUrls(data.updateUrl);
      }
    } catch (e) {}

    var appVersion = (window.AppConfig && window.AppConfig.version)
      ? window.AppConfig.version
      : '0.0.0';

    // 1. Mantenimiento → bloquea
    if (data.maintenance === true) {
      _blocked = true;
      console.log('[UpdateChecker] ✋ Modo mantenimiento activo — bloqueando app.');
      _showMaintenanceModal(data);
      resolve({ status: 'maintenance', blocked: true, data: data });
      return;
    }

    // 2. Actualización obligatoria → bloquea
    var minVersion = data.minVersion || '0.0.0';
    if (data.forceUpdate === true || _compareSemver(appVersion, minVersion) < 0) {
      _blocked = true;
      console.log('[UpdateChecker] 🚫 Actualización obligatoria — local:', appVersion, 'min:', minVersion, 'forceUpdate:', data.forceUpdate);
      _showUpdateModal(data);
      resolve({ status: 'force-update', blocked: true, data: data });
      return;
    }

    // 3. Actualización suave → banner no bloqueante
    var latestVersion = data.latestVersion || '0.0.0';
    if (latestVersion && _compareSemver(appVersion, latestVersion) < 0) {
      console.log('[UpdateChecker] ℹ️ Actualización suave disponible — local:', appVersion, 'latest:', latestVersion);
      _showSoftUpdateBanner();
      console.log('[UpdateChecker] ✅ App puede continuar.');
      resolve({ status: 'soft-update', blocked: false, data: data });
      return;
    }

    // 4. Todo OK → continuar
    console.log('[UpdateChecker] ✅ App puede continuar.');
    resolve({ status: 'ok', blocked: false, data: data });
  }

  /* ── API pública ────────────────────────────────────── */

  /**
   * Comprueba la versión. Devuelve una Promise que SIEMPRE resuelve con:
   *   { status: 'ok'|'soft-update'|'force-update'|'maintenance'|'fail-open',
   *     blocked: boolean,
   *     data: object|null }
   *
   * Estrategia fetch-first: siempre intenta leer Firestore para obtener
   * datos frescos. Solo usa la caché como fallback si la lectura falla
   * (sin internet, timeout, etc.).
   */
  function check() {
    return new Promise(function (resolve) {
      console.log('[UpdateChecker] Iniciando comprobación… versión local:', (window.AppConfig && window.AppConfig.version) || '?');

      _fetchFromFirestore().then(function (data) {
        console.log('[UpdateChecker] Datos obtenidos de Firestore:', JSON.stringify(data));
        _saveCache(data);
        _evaluate(data, resolve);
      }).catch(function (err) {
        console.warn('[UpdateChecker] No se pudo leer Firestore:', err && err.message);
        var cached = _loadCache();
        if (cached) {
          console.log('[UpdateChecker] Usando caché local como fallback.');
          _evaluate(cached, resolve);
        } else {
          console.log('[UpdateChecker] Sin caché disponible — fail-open, la app arranca normal.');
          resolve({ status: 'fail-open', blocked: false, data: null });
        }
      });
    });
  }

  /**
   * Limpia la caché y vuelve a ejecutar check() desde cero.
   * Útil para el botón "Reintentar" del modal de mantenimiento.
   */
  function recheck() {
    clearCache();
    _blocked = false;
    return check();
  }

  /** Devuelve true si la app está bloqueada por actualización o mantenimiento */
  function isBlocked() { return _blocked; }

  /** Borra la caché local (útil para testing) */
  function clearCache() {
    try { storageSave(CACHE_KEY, null); } catch (e) {}
    console.log('[UpdateChecker] Caché borrada.');
  }

  return {
    check: check,
    recheck: recheck,
    isBlocked: isBlocked,
    clearCache: clearCache
  };

})();
