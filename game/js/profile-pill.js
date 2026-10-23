/**
 * js/profile-pill.js — Pill de perfil con estado PGS
 *
 * Muestra el estado de conexión a Google Play Games Services
 * en la topbar del home. Gestiona:
 *   - Avatar + nombre del jugador (conectado) o icono genérico (invitado)
 *   - Dot de estado verde/gris
 *   - Click: logros nativos PGS (conectado) o intento de sign-in (invitado)
 *   - Toast al conectar
 *   - Nombre del jugador en pantalla de resultados
 *
 * ★ FIX: Se añade el mecanismo onSignIn(callback) para que main.js pueda
 *   registrar un callback que refresca el home completo (botón JUGAR,
 *   estado del reto diario, streak) después de un sign-in manual exitoso
 *   desde la pill. Antes, solo se actualizaba la pill y el toast.
 *
 * ORDEN DE CARGA: después de play-games.js, antes de main.js
 * Depende de: PlayGamesService, t() (i18n), delay() (utils)
 */

var ProfilePill = (function () {

  /* ── Elementos DOM (cacheados en init) ────────────── */
  var _elBtn     = null;
  var _elAvatar  = null;
  var _elIcon    = null;
  var _elName    = null;
  var _elDot     = null;

  /* ── Estado ────────────────────────────────────────── */
  var _connected        = false;
  var _loading          = false;
  var _onSignInCallback = null; /* ★ FIX: callback registrado por main.js */

  /* ── Inicializar pill ──────────────────────────────── */

  function init() {
    _elBtn    = document.getElementById('btn-profile');
    _elAvatar = document.getElementById('profile-avatar');
    _elIcon   = document.getElementById('profile-icon');
    _elName   = document.getElementById('profile-name');
    _elDot    = document.getElementById('profile-status-dot');

    if (!_elBtn) return;

    _elBtn.addEventListener('click', _handleClick);

    /* Estado inicial: invitado */
    _setGuestState();
  }

  /* ── Registrar callback de sign-in exitoso ─────────── */

  /**
   * Permite que main.js registre una función que se ejecutará
   * inmediatamente después de que un sign-in manual sea exitoso.
   * Se usa para refrescar el estado completo del home (botón JUGAR,
   * estado del reto diario, streak, botón de logros PGS, etc.)
   *
   * @param {Function} fn
   */
  function onSignIn(fn) {
    _onSignInCallback = fn;
  }

  /* ── Actualizar pill tras init de PGS ──────────────── */

  /**
   * Llamado desde main.js tras PlayGamesService.init().
   * Actualiza visualmente la pill según el resultado del init automático.
   * No dispara _onSignInCallback (ese es solo para sign-in manual).
   *
   * @param {boolean} signedIn
   */
  function updateFromPGS(signedIn) {
    _connected = signedIn;

    if (signedIn) {
      var info = PlayGamesService.getPlayerInfo();
      _setConnectedState(info);
      _showConnectedToast(info);
    } else {
      _setGuestState();
    }
  }

  /* ── Estados visuales ──────────────────────────────── */

  function _setGuestState() {
    if (!_elBtn) return;
    _connected = false;

    /* Ocultar avatar, mostrar icono genérico */
    if (_elAvatar) _elAvatar.style.display = 'none';
    if (_elIcon)   { _elIcon.style.display = 'flex'; _elIcon.textContent = '👤'; }
    if (_elName)   _elName.textContent = t('profile_guest');
    if (_elDot)    { _elDot.className = 'profile-status-dot dot-offline'; }

    _elBtn.classList.remove('profile-pill--connected');
    _elBtn.classList.add('profile-pill--guest');
  }

  function _setConnectedState(info) {
    if (!_elBtn) return;

    var name   = (info && info.displayName) ? info.displayName : 'Player';
    var avatar = (info && info.avatarUrl)   ? info.avatarUrl   : null;

    /* Mostrar avatar si hay URL, sino icono con inicial */
    if (avatar && _elAvatar) {
      _elAvatar.src = avatar;
      _elAvatar.style.display = 'block';
      _elAvatar.onerror = function () {
        _elAvatar.style.display = 'none';
        if (_elIcon) { _elIcon.style.display = 'flex'; _elIcon.textContent = _getInitial(name); }
      };
      if (_elIcon) _elIcon.style.display = 'none';
    } else {
      if (_elAvatar) _elAvatar.style.display = 'none';
      if (_elIcon) { _elIcon.style.display = 'flex'; _elIcon.textContent = _getInitial(name); }
    }

    /* Nombre truncado */
    if (_elName) _elName.textContent = _truncName(name, 12);

    /* Dot verde */
    if (_elDot) { _elDot.className = 'profile-status-dot dot-online'; }

    _elBtn.classList.remove('profile-pill--guest');
    _elBtn.classList.add('profile-pill--connected');
  }

  function _setLoadingState() {
    if (!_elBtn) return;
    if (_elIcon) { _elIcon.style.display = 'flex'; _elIcon.textContent = '⏳'; }
    if (_elAvatar) _elAvatar.style.display = 'none';
    if (_elName) _elName.textContent = '...';
  }

  /* ── Click handler ─────────────────────────────────── */

  function _handleClick() {
    if (_loading) return;

    if (_connected && PlayGamesService.isSignedIn()) {
      /* Conectado → abrir logros nativos PGS */
      PlayGamesService.showAchievements();
      return;
    }

    /* Invitado → intentar sign-in */
    if (!PlayGamesService.isAvailable()) {
      /* En web no hay PGS, no hacer nada */
      console.log('[ProfilePill] PGS no disponible (modo web)');
      return;
    }

    _loading = true;
    _setLoadingState();

    PlayGamesService.signIn()
      .then(function (signedIn) {
        _loading = false;

        if (signedIn) {
          /* ── Sign-in exitoso ── */
          _connected = true;
          var info = PlayGamesService.getPlayerInfo();
          _setConnectedState(info);
          _showConnectedToast(info);

          /* ★ FIX: Notificar a main.js para que refresque el home completo.
             syncAllLocal, updateDailyCardUI, _updatePlayButton, etc.
             se ejecutan desde allí para mantener la separación de responsabilidades. */
          if (_onSignInCallback) {
            _onSignInCallback();
          }

        } else {
          /* Sign-in rechazado o fallido → volver a estado invitado */
          _setGuestState();
        }
      })
      .catch(function () {
        _loading = false;
        _setGuestState();
      });
  }

  /* ── Toast de conexión ─────────────────────────────── */

  function _showConnectedToast(info) {
    var name = (info && info.displayName) ? info.displayName : 'Player';
    var msg  = t('profile_connected_toast', { name: name });

    /* Reutilizar el sistema de toasts existente del juego */
    var toast = document.createElement('div');
    toast.className = 'profile-toast toast-show';
    toast.innerHTML =
      '<span class="profile-toast-icon">🎮</span>' +
      '<div class="profile-toast-body">' +
        '<span class="profile-toast-label">Google Play Games</span>' +
        '<span class="profile-toast-name">' + _escHtml(msg) + '</span>' +
      '</div>';

    document.body.appendChild(toast);

    setTimeout(function () {
      toast.classList.remove('toast-show');
      toast.classList.add('toast-hide');
      setTimeout(function () {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, 350);
    }, 3000);
  }

  /* ── Nombre del jugador en pantalla de resultados ──── */

  function renderResultsPlayerName() {
    var el = document.getElementById('results-player-name');
    if (!el) return;

    if (_connected) {
      var info = PlayGamesService.getPlayerInfo();
      var name = (info && info.displayName) ? info.displayName : 'Player';
      el.innerHTML =
        '<span class="results-player-icon">🎮</span>' +
        '<span class="results-player-text">' + _escHtml(name) + '</span>';
      el.style.display = 'flex';
    } else {
      el.innerHTML =
        '<span class="results-player-icon">👤</span>' +
        '<span class="results-player-text">' + t('profile_guest') + '</span>';
      el.style.display = 'flex';
    }
  }

  /* ── Helpers ────────────────────────────────────────── */

  function _getInitial(name) {
    if (!name) return '?';
    return name.charAt(0).toUpperCase();
  }

  function _truncName(name, max) {
    if (!name) return '';
    if (name.length <= max) return name;
    return name.substring(0, max - 1) + '…';
  }

  function _escHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* ── API pública ───────────────────────────────────── */
  return {
    init:                    init,
    onSignIn:                onSignIn,    /* ★ FIX: nuevo — para que main.js registre el callback */
    updateFromPGS:           updateFromPGS,
    renderResultsPlayerName: renderResultsPlayerName,
    isConnected:             function () { return _connected; }
  };
})();
