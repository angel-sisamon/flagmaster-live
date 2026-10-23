/**
 * js/back-nav.js — Navegación "atrás" unificada (botón/gesto de Android, gesto de borde en iOS,
 * botón atrás del navegador y tecla Escape)
 *
 * Todas las entradas acaban en BackNav.back(), que resuelve QUÉ cerrar mirando el DOM visible
 * (sin pila propia que pueda desincronizarse):
 *
 *   1. Capa superior visible (.modal-overlay, .duel-modal-overlay, onboarding, banner de nombre):
 *        · [data-back-block] → no se cierra (actualización obligatoria, mantenimiento) → raíz
 *        · [data-back] visible dentro → se pulsa (mismo efecto que Cancelar / ✕)
 *        · si no, clic en el fondo de la capa (los modales se cierran con e.target === overlay)
 *   2. Pantalla activa: su botón [data-back] (volver, abandonar partida, ir a inicio).
 *   3. Inicio → raíz: en Android "Pulsa atrás otra vez para salir" (2 s) y App.exitApp().
 *      En iOS una app no puede cerrarse sola (Apple lo rechaza) y en web se deja al navegador.
 *
 * Marcado: añade data-back al botón que debe "pulsarse" al ir atrás, o data-back-block a la capa
 * que no debe cerrarse. Ningún módulo necesita registrarse.
 *
 * ORDEN DE CARGA: después de ui.js (showInfoToast) e i18n.js; antes de main.js.
 */

var BackNav = (function () {

  var EXIT_WINDOW_MS = 2000;  /* segundo "atrás" para salir */
  var THROTTLE_MS    = 250;   /* evita saltarse dos niveles con una doble pulsación */
  var EDGE_PX        = 24;    /* iOS: zona del borde izquierdo donde empieza el gesto */
  var EDGE_MIN_DX    = 70;

  var LAYER_SELECTOR = '.modal-overlay, .duel-modal-overlay, #onboarding-overlay';

  var _lastBack   = 0;
  var _exitArmed  = 0;
  var _inited     = false;

  function _platform() {
    try {
      if (window.Capacitor && typeof window.Capacitor.getPlatform === 'function') return window.Capacitor.getPlatform();
    } catch (e) {}
    return 'web';
  }

  function _appPlugin() {
    try { return (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App) || null; }
    catch (e) { return null; }
  }

  function _isVisible(el) {
    if (!el || !el.isConnected) return false;
    var cs = getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden' && el.getClientRects().length > 0;
  }

  /** Capa visible más alta: mayor z-index y, a igualdad, la última en el DOM. */
  function _topLayer() {
    var top = null, topZ = -Infinity;
    document.querySelectorAll(LAYER_SELECTOR).forEach(function (el) {
      if (!_isVisible(el)) return;
      var z = parseInt(getComputedStyle(el).zIndex, 10);
      if (isNaN(z)) z = 0;
      if (z >= topZ) { top = el; topZ = z; }
    });
    return top;
  }

  function _visibleBackBtn(root) {
    var btns = root.querySelectorAll('[data-back]');
    for (var i = 0; i < btns.length; i++) {
      if (_isVisible(btns[i]) && !btns[i].disabled) return btns[i];
    }
    return null;
  }

  /** @returns {boolean} true si la capa se ha cerrado (o se ha iniciado su cierre) */
  function _closeLayer(layer) {
    if (layer.hasAttribute('data-back-block')) return false;
    var btn = _visibleBackBtn(layer);
    if (btn) { btn.click(); return true; }
    /* Fondo de la capa: target === overlay, igual que tocar fuera del panel */
    layer.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    return !_isVisible(layer);
  }

  function _atRoot() {
    var active = document.querySelector('.screen.active');
    return !active || active.id === 'screen-home';
  }

  /**
   * Raíz (Inicio o capa no cerrable). Solo Android puede salir.
   * @returns {string} 'exit-armed' | 'exit' | 'root'
   */
  function _handleRoot() {
    var app = _appPlugin();
    if (_platform() !== 'android' || !app) return 'root';
    var now = Date.now();
    if (now - _exitArmed < EXIT_WINDOW_MS) {
      _exitArmed = 0;
      try { app.exitApp(); } catch (e) {}
      return 'exit';
    }
    _exitArmed = now;
    if (typeof showInfoToast === 'function') showInfoToast('👋', t('back_exit_hint'), EXIT_WINDOW_MS);
    return 'exit-armed';
  }

  /**
   * Ejecuta un paso "atrás".
   * @returns {string} 'layer' | 'screen' | 'root' | 'exit-armed' | 'exit' | 'ignored'
   */
  function back() {
    var now = Date.now();
    if (now - _lastBack < THROTTLE_MS) return 'ignored';
    /* Durante la transición de pantalla (450 ms) se ignora: el destino aún no es interactivo */
    if (document.querySelector('.screen.entering')) return 'ignored';
    _lastBack = now;

    var layer = _topLayer();
    if (layer) {
      if (_closeLayer(layer)) { _exitArmed = 0; return 'layer'; }
      return _handleRoot();
    }

    var active = document.querySelector('.screen.active');
    if (!active || active.id === 'screen-splash') return 'ignored';
    if (_atRoot()) return _handleRoot();

    var btn = _visibleBackBtn(active);
    if (btn) { _exitArmed = 0; btn.click(); return 'screen'; }
    return 'ignored';
  }

  /* ── Entradas ─────────────────────────────────────────── */

  /* Android: botón/gesto atrás del sistema (el listener anula el cierre por defecto) */
  function _bindAndroid() {
    var app = _appPlugin();
    if (!app || typeof app.addListener !== 'function') return;
    try { app.addListener('backButton', function () { back(); }); } catch (e) {}
  }

  /* iOS: no hay botón atrás de sistema; gesto de deslizar desde el borde izquierdo */
  function _bindIosEdgeSwipe() {
    var sx = 0, sy = 0, st = 0, tracking = false;
    document.addEventListener('touchstart', function (e) {
      var tch = e.touches[0];
      tracking = e.touches.length === 1 && tch.clientX <= EDGE_PX;
      if (tracking) { sx = tch.clientX; sy = tch.clientY; st = Date.now(); }
    }, { passive: true });
    document.addEventListener('touchend', function (e) {
      if (!tracking) return;
      tracking = false;
      var tch = e.changedTouches[0];
      var dx = tch.clientX - sx, dy = Math.abs(tch.clientY - sy);
      if (dx >= EDGE_MIN_DX && dy < dx * 0.6 && Date.now() - st < 700) back();
    }, { passive: true });
    document.addEventListener('touchcancel', function () { tracking = false; }, { passive: true });
  }

  /* Web: el botón atrás del navegador navega dentro de la app; en Inicio sale de la página */
  function _bindBrowserHistory() {
    try {
      history.pushState({ fmBack: true }, '');
      window.addEventListener('popstate', function () {
        var r = back();
        if (r === 'root') history.back();
        else history.pushState({ fmBack: true }, '');
      });
    } catch (e) {}
  }

  function init() {
    if (_inited) return;
    _inited = true;
    var p = _platform();
    if (p === 'android') _bindAndroid();
    else if (p === 'ios') _bindIosEdgeSwipe();
    else _bindBrowserHistory();
  }

  return { init: init, back: back };

})();
