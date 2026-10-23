/**
 * js/app-review.js — Popup de valoración de la app
 *
 * Muestra un bottom-sheet con 5 estrellas interactivas tras completar partidas.
 * Solo actúa si el usuario selecciona 4 o 5 estrellas → abre Play Store.
 * Con ≤ 3 estrellas simplemente cierra sin hacer nada.
 *
 * LÓGICA DE DISPARO (todas deben cumplirse):
 *   · Partidas completadas ≥ THRESHOLD_SESSIONS
 *   · No ha pulsado "No volver a preguntar"
 *   · Han pasado ≥ COOLDOWN_DAYS días desde la última vez que se mostró
 *   · Se ha mostrado < MAX_PROMPTS veces en total
 *
 * ORDEN DE CARGA: después de i18n.js, antes de main.js
 * Depende de: t(), getLang()
 */

var AppReview = (function () {

  /* ── Configuración ─────────────────────────────────── */
  var STORAGE_KEY       = 'fm_review_state';
  /* URL real de Play Store (centralizada en ShareLinks; aquí dejamos un
     fallback hardcodeado por si share-links.js no se hubiera cargado). */
  var PLAY_STORE_URL_FALLBACK = 'https://play.google.com/store/apps/details?id=com.sisapicasso.flagmaster';
  var THRESHOLD_SESSIONS = 5;   // partidas completadas mínimas
  var COOLDOWN_DAYS      = 30;  // días entre apariciones
  var MAX_PROMPTS        = 3;   // veces máximas que puede aparecer

  /* ── Estado interno ────────────────────────────────── */
  var _selectedStars = 0;
  var _isOpen        = false;

  /* ── Persistencia ──────────────────────────────────── */

  function _loadState() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) { return {}; }
  }

  function _saveState(state) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) {}
  }

  /* ── Registrar partida completada ──────────────────── */

  function recordSession() {
    var s = _loadState();
    s.sessions = (s.sessions || 0) + 1;
    _saveState(s);
  }

  /* ── Comprobar si toca mostrar el popup ────────────── */

  function maybeShow() {
    var s = _loadState();

    /* 1. Usuario dijo "no volver a preguntar" */
    if (s.neverAsk) return;

    /* 2. Número máximo de prompts alcanzado */
    if ((s.promptCount || 0) >= MAX_PROMPTS) return;

    /* 3. Partidas insuficientes */
    if ((s.sessions || 0) < THRESHOLD_SESSIONS) return;

    /* 4. Cooldown: han pasado menos de COOLDOWN_DAYS desde la última vez */
    if (s.lastShown) {
      var daysSince = (Date.now() - s.lastShown) / 86400000;
      if (daysSince < COOLDOWN_DAYS) return;
    }

    /* ✅ Todas las condiciones OK → mostrar con pequeño delay */
    setTimeout(function () { _show(); }, 1200);
  }

  /* ── Mostrar modal ─────────────────────────────────── */

  function _show() {
    if (_isOpen) return;
    var modal = document.getElementById('modal-app-review');
    if (!modal) return;

    _isOpen        = true;
    _selectedStars = 0;

    /* Actualizar textos i18n */
    _updateTexts();

    /* Reset visual estrellas */
    _resetStars();

    /* Ocultar botón de valorar hasta que se elijan estrellas */
    var btnRate = document.getElementById('btn-review-rate');
    if (btnRate) btnRate.style.display = 'none';

    modal.style.display = 'flex';
    requestAnimationFrame(function () {
      modal.classList.add('review-visible');
    });

    /* Guardar timestamp de última aparición y contador */
    var s = _loadState();
    s.lastShown    = Date.now();
    s.promptCount  = (s.promptCount || 0) + 1;
    _saveState(s);

    _bindEvents();
  }

  /* ── Cerrar modal ──────────────────────────────────── */

  function _close() {
    _isOpen = false;
    var modal = document.getElementById('modal-app-review');
    if (!modal) return;
    modal.classList.remove('review-visible');
    setTimeout(function () { modal.style.display = 'none'; }, 300);
  }

  /* ── Lógica de estrellas ────────────────────────────── */

  function _resetStars() {
    var stars = document.querySelectorAll('.review-star');
    stars.forEach(function (s) {
      s.classList.remove('review-star--on', 'review-star--pop');
    });
  }

  function _highlightStars(n) {
    var stars = document.querySelectorAll('.review-star');
    stars.forEach(function (s, i) {
      if (i < n) {
        s.classList.add('review-star--on');
      } else {
        s.classList.remove('review-star--on');
      }
    });
  }

  function _popStar(index) {
    var stars = document.querySelectorAll('.review-star');
    if (stars[index]) {
      stars[index].classList.remove('review-star--pop');
      /* forzar reflow para rearmar la animación */
      void stars[index].offsetWidth;
      stars[index].classList.add('review-star--pop');
    }
  }

  function _onStarClick(n) {
    _selectedStars = n;
    _highlightStars(n);
    _popStar(n - 1);

    var btnRate = document.getElementById('btn-review-rate');
    if (!btnRate) return;

    if (n >= 4) {
      /* Mostrar botón de valorar */
      btnRate.style.display = 'block';
      btnRate.textContent = (typeof t === 'function')
        ? t('review_btn_rate')
        : '⭐ Valorar en Play Store';
    } else {
      /* ≤ 3 estrellas: ocultar botón, no hacer nada */
      btnRate.style.display = 'none';
    }
  }

  /* ── Abrir Play Store ──────────────────────────────── */

  function _openStore() {
    /* En Capacitor se puede usar el scheme market:// o la URL HTTPS */
    var url = (window.ShareLinks && typeof window.ShareLinks.getStoreUrl === 'function')
      ? window.ShareLinks.getStoreUrl()
      : PLAY_STORE_URL_FALLBACK;
    try {
      window.open(url, '_system');
    } catch (e) {
      window.location.href = url;
    }

    /* Marcar como "ya valoró": no volver a molestar */
    var s = _loadState();
    s.neverAsk = true;
    _saveState(s);

    _close();
  }

  /* ── "No volver a preguntar" ────────────────────────── */

  function _neverAsk() {
    var s = _loadState();
    s.neverAsk = true;
    _saveState(s);
    _close();
  }

  /* ── Textos i18n ────────────────────────────────────── */

  function _updateTexts() {
    var ids = {
      'review-title'       : 'review_title',
      'review-subtitle'    : 'review_subtitle',
      'review-btn-later'   : 'review_btn_later',
      'review-btn-never'   : 'review_btn_never'
    };
    Object.keys(ids).forEach(function (id) {
      var el = document.getElementById(id);
      if (el && typeof t === 'function') el.textContent = t(ids[id]);
    });
  }

  /* ── Bind de eventos ────────────────────────────────── */

  function _bindEvents() {
    /* Estrellas */
    var stars = document.querySelectorAll('.review-star');
    stars.forEach(function (star, i) {
      /* Limpiar listeners previos clonando el nodo */
      var fresh = star.cloneNode(true);
      star.parentNode.replaceChild(fresh, star);
      fresh.addEventListener('click', function () { _onStarClick(i + 1); });
      /* Hover preview */
      fresh.addEventListener('mouseenter', function () { _highlightStars(i + 1); });
    });
    var container = document.querySelector('.review-stars');
    if (container) {
      container.addEventListener('mouseleave', function () {
        _highlightStars(_selectedStars);
      });
    }

    /* Botón valorar */
    var btnRate = document.getElementById('btn-review-rate');
    if (btnRate) {
      var freshRate = btnRate.cloneNode(true);
      btnRate.parentNode.replaceChild(freshRate, btnRate);
      freshRate.addEventListener('click', _openStore);
    }

    /* Botón más tarde */
    var btnLater = document.getElementById('btn-review-later');
    if (btnLater) {
      var freshLater = btnLater.cloneNode(true);
      btnLater.parentNode.replaceChild(freshLater, btnLater);
      freshLater.addEventListener('click', _close);
    }

    /* Botón nunca */
    var btnNever = document.getElementById('btn-review-never');
    if (btnNever) {
      var freshNever = btnNever.cloneNode(true);
      btnNever.parentNode.replaceChild(freshNever, btnNever);
      freshNever.addEventListener('click', _neverAsk);
    }

    /* Cerrar tocando el overlay */
    var modal = document.getElementById('modal-app-review');
    if (modal) {
      modal.addEventListener('click', function (e) {
        if (e.target === modal) _close();
      });
    }
  }

  /* ── Dev helper ────────────────────────────────────── */

  function reset() {
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
    console.log('[AppReview] Estado reseteado.');
  }

  /* ── API pública ────────────────────────────────────── */
  return {
    recordSession : recordSession,
    maybeShow     : maybeShow,
    reset         : reset   /* solo para desarrollo */
  };

})();
