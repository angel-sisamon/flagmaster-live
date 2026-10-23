/**
 * js/notifications.js — Recordatorio diario del Reto del Día
 *
 * Completamente automático y transparente para el usuario.
 * No hay ajustes visibles. La hora es fija internamente (20:00).
 *
 * Comportamiento:
 *  - Al abrir la app: programa el recordatorio si el reto aún no está completado
 *  - Al completar el reto: cancela la notif de hoy y programa la de mañana
 *  - En navegador / fuera de Capacitor: todas las funciones son no-op silencioso
 *
 * ORDEN DE CARGA: después de storage.js y daily.js, antes de main.js
 * Depende de: isDailyCompleted, getDailyStreak, t(), getLang()
 */

var NotificationService = (function () {

  var _cfg = (window.AppConfig && window.AppConfig.notifications) || {};
  var NOTIF_ID     = (typeof _cfg.id === 'number') ? _cfg.id : 1001;     /* ID fijo — siempre sobrescribimos la misma notif */
  var NOTIF_HOUR   = (typeof _cfg.hour === 'number') ? _cfg.hour : 20;   /* Hora fija del recordatorio: 20:00 */
  var NOTIF_MINUTE = (typeof _cfg.minute === 'number') ? _cfg.minute : 0;

  /* ── Acceso al plugin ──────────────────────────────── */

  function _getPlugin() {
    try {
      return (window.Capacitor &&
              window.Capacitor.Plugins &&
              window.Capacitor.Plugins.LocalNotifications)
        ? window.Capacitor.Plugins.LocalNotifications
        : null;
    } catch (e) { return null; }
  }

  function _isCapacitor() { return !!_getPlugin(); }

  /* ── Texto de la notificación ──────────────────────── */

  function _buildContent() {
    var streak = (typeof getDailyStreak === 'function') ? getDailyStreak() : 0;
    var title, body;

    if (typeof t === 'function') {
      /* Camino normal: usa el sistema i18n (es · en · fr · pt).
         Si el idioma del dispositivo no es ninguno de los 4, t() cae a 'en'. */
      title = t('notif_title');
      body  = streak >= 2
        ? t('notif_body_streak', { n: streak })
        : t('notif_body');
    } else {
      /* Fallback de emergencia (t() no disponible — no debería ocurrir).
         Usa inglés como idioma neutro, igual que el resto de la app. */
      title = '📅 FlagMaster';
      body  = 'Your Daily Challenge is waiting!';
    }

    return { title: title, body: body };
  }

  /* ── Calcular fecha de disparo ─────────────────────── */
  /*
   * - Si el reto de HOY ya está completado → dispara MAÑANA a las 20:00
   * - Si no está completado y las 20:00 aún no han pasado → dispara HOY
   * - Si no está completado y las 20:00 ya pasaron → dispara MAÑANA
   */
  function _nextFireDate() {
    var now  = new Date();
    var fire = new Date(
      now.getFullYear(), now.getMonth(), now.getDate(),
      NOTIF_HOUR, NOTIF_MINUTE, 0, 0
    );

    var todayDone = (typeof isDailyCompleted === 'function') && isDailyCompleted();

    if (todayDone || fire <= now) {
      fire.setDate(fire.getDate() + 1);
    }

    return fire;
  }

  /* ── Pedir permiso (silencioso, sin UI propia) ─────── */

  function _requestPermission() {
    var plugin = _getPlugin(); if (!plugin) return Promise.resolve(false);
    return plugin.requestPermissions()
      .then(function (result) {
        return result && result.display === 'granted';
      })
      .catch(function () { return false; });
  }

  /* ── Cancelar notificación pendiente ───────────────── */

  function _cancel() {
    var plugin = _getPlugin(); if (!plugin) return Promise.resolve();

    return plugin.getPending()
      .then(function (result) {
        var pending = (result && result.notifications) ? result.notifications : [];
        var toCancel = pending
          .filter(function (n) { return n.id === NOTIF_ID; })
          .map(function (n) { return { id: n.id }; });
        if (!toCancel.length) return Promise.resolve();
        return plugin.cancel({ notifications: toCancel });
      })
      .catch(function () {});
  }

  /* ── Programar notificación ────────────────────────── */

  function _schedule() {
    var plugin = _getPlugin(); if (!plugin) return Promise.resolve();

    var fireDate = _nextFireDate();
    var content  = _buildContent();

    console.log('[Notif] Programando para:', fireDate.toLocaleString());

    return plugin.schedule({
      notifications: [{
        id:           NOTIF_ID,
        title:        content.title,
        body:         content.body,
        schedule:     { at: fireDate },
        sound:        null,
        actionTypeId: '',
        extra:        null,
        smallIcon:    'ic_stat_flag',
        largeIcon:    'ic_launcher_round',
        iconColor:    '#4CAF50'
      }]
    }).then(function () {
      console.log('[Notif] Notificacion programada');
    }).catch(function (e) {
      console.warn('[Notif] Error programando:', e);
    });
  }

  /* API PUBLICA */

  function init() {
    if (!_isCapacitor()) return Promise.resolve();
    return _requestPermission();
  }

  function syncOnAppOpen() {
    if (!_isCapacitor()) return Promise.resolve();
    return _cancel().then(_schedule);
  }

  function onDailyCompleted() {
    if (!_isCapacitor()) return Promise.resolve();
    return _cancel().then(_schedule);
  }

  return {
    init:             init,
    syncOnAppOpen:    syncOnAppOpen,
    onDailyCompleted: onDailyCompleted
  };

})();
