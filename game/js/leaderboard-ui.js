/**
 * js/leaderboard-ui.js — UI del ranking global
 *
 * Pantalla completa (#screen-daily-ranking, POC: antes era un modal) con
 * navegación entre días/semanas (flechas + swipe), lista con el mismo estilo
 * que "Mejores rachas" de la maratón, filtros por período y geografía,
 * tarjeta del jugador actual y compartir resultado.
 *
 * ORDEN DE CARGA: después de firebase-leaderboard.js y week-utils.js, antes de main.js
 * Depende de: FirebaseLeaderboard, WeekUtils, COUNTRIES, t(), getLang(), delay()
 */

var LeaderboardUI = (function () {

  /* ── Estado ────────────────────────────────────────── */
  var _currentDate  = null;    /* Date object del día que se muestra (modo daily) */
  var _period       = 'daily'; /* 'daily' | 'weekly' */
  var _geoFilter    = 'global';/* 'global' | 'eu' | 'am' | 'as' | 'af' | 'oc' */
  var _currentWeekId = null;   /* Semana actual en modo weekly, ej: '2026-W15' */
  var _isOpen      = false;
  var _isLoading   = false;
  var _touchStartX = 0;
  var _touchDeltaX = 0;
  var _swiping     = false;
  var _onRecoveryRequested = null; /* Callback registrado por main.js para el flujo de recovery */
  var _returnTo    = 'home';     /* Pantalla a la que vuelve el botón atrás */

  var SWIPE_THRESHOLD      = 50;
  var MAX_VISIBLE_ENTRIES  = 100; /* Máximo de entradas visibles en el ranking */
  var DAYS_PER_WEEK        = 7;  /* Días por semana para el badge de días jugados */
  var FADE_DURATION_MS     = 150; /* Duración del fade al cambiar de pestaña (ms) */
  var MEDALS = ['🥇', '🥈', '🥉'];

  /* ── Abrir modal ───────────────────────────────────── */

  function open(opts) {
    opts = opts || {};
    if (!FirebaseLeaderboard.isReady()) {
      /* Fallback PGS nativo */
      if (typeof PlayGamesService !== 'undefined' && PlayGamesService.isSignedIn()) {
        PlayGamesService.showLeaderboard('daily_challenge');
      }
      return;
    }

    /* Inicializar estado */
    _period    = opts.period    || 'daily';
    _geoFilter = opts.geoFilter || 'global';
    _currentDate    = opts.dateOverride ? new Date(opts.dateOverride) : new Date();
    _currentWeekId  = (typeof WeekUtils !== 'undefined') ? WeekUtils.getWeekId() : null;

    var screen = document.getElementById('screen-daily-ranking');
    if (!screen) return;

    /* Volver a la pantalla desde la que se abrió (home o resultados) */
    var active = document.querySelector('.screen.active');
    _returnTo = (active && active.id !== 'screen-daily-ranking')
      ? active.id.replace('screen-', '') : 'home';
    _isOpen = true;

    _updateTabs();
    _updateGeoFilters();
    _updateDateDisplay();
    _bindEvents();
    _bindFilters();
    _renderMe(null, null, true);
    showScreen('daily-ranking');

    _loadRanking();
  }

  /* ── Cerrar pantalla ───────────────────────────────── */

  function close() {
    /* main.js lo llama en cada Escape/Back: solo actuar si está abierta */
    if (!_isOpen) return;
    _isOpen = false;
    showScreen(_returnTo);
  }

  function isOpen() { return _isOpen; }

  /* ── Eventos base ──────────────────────────────────── */

  function _bindEvents() {
    var modal   = document.getElementById('screen-daily-ranking');
    var content = document.getElementById('lb-swipe-area');
    var btnPrev = document.getElementById('lb-prev');
    var btnNext = document.getElementById('lb-next');
    var btnClose1 = document.getElementById('btn-close-leaderboard');
    var btnShare  = document.getElementById('btn-lb-share');

    /* Evitar duplicados */
    if (modal._lbBound) return;
    modal._lbBound = true;

    /* Cerrar */
    if (btnClose1) btnClose1.addEventListener('click', close);

    /* Navegación flechas */
    if (btnPrev) btnPrev.addEventListener('click', function () { _navigate(-1); });
    if (btnNext) btnNext.addEventListener('click', function () { _navigate(1); });

    /* Swipe táctil */
    if (content) {
      content.addEventListener('touchstart', _onTouchStart, { passive: true });
      content.addEventListener('touchmove',  _onTouchMove,  { passive: false });
      content.addEventListener('touchend',   _onTouchEnd,   { passive: true });
    }

    /* Compartir */
    if (btnShare) btnShare.addEventListener('click', _shareRanking);

    /* Botón "jugar día perdido" de la tarjeta */
    var meCard = document.getElementById('lb-me');
    if (meCard) meCard.addEventListener('click', function (e) {
      if (e.target.closest('#btn-lb-play-missed')) _onPlayMissed();
    });
  }

  /* ── Filtros de período y geografía ────────────────── */

  function _bindFilters() {
    /* Evitar duplicar handlers usando flag en el contenedor de tabs */
    var tabContainer = document.getElementById('lb-period-tabs');
    if (tabContainer && tabContainer._lbFiltersBound) return;
    if (tabContainer) tabContainer._lbFiltersBound = true;

    /* Pestañas Diario / Semanal — con animación de transición */
    var tabs = document.querySelectorAll('#lb-period-tabs .lb-tab');
    tabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        if (_period === tab.dataset.period) return;
        _period = tab.dataset.period;
        _updateTabs();
        _updateDateDisplay();
        _fadeAndLoad();
      });
    });

    /* Select de filtro geográfico */
    var geoSelect = document.getElementById('lb-geo-select');
    if (geoSelect) {
      geoSelect.addEventListener('change', function () {
        _geoFilter = geoSelect.value;
        _loadRanking();
      });
    }
  }

  /* ── Helpers de estado de UI ───────────────────────── */

  function _updateTabs() {
    var tabs = document.querySelectorAll('#lb-period-tabs .lb-tab');
    tabs.forEach(function (tab) {
      tab.classList.toggle('lb-tab--active', tab.dataset.period === _period);
    });
  }

  function _updateGeoFilters() {
    var geoSelect = document.getElementById('lb-geo-select');
    if (geoSelect) geoSelect.value = _geoFilter;
  }

  /* ── Swipe ─────────────────────────────────────────── */

  function _onTouchStart(e) {
    if (_isLoading) return;
    _touchStartX = e.touches[0].clientX;
    _touchDeltaX = 0;
    _swiping = true;
  }

  function _onTouchMove(e) {
    if (!_swiping) return;
    _touchDeltaX = e.touches[0].clientX - _touchStartX;

    /* Pequeño desplazamiento visual del contenido */
    var area = document.getElementById('lb-swipe-area');
    if (area) {
      var clamp = Math.max(-80, Math.min(80, _touchDeltaX * 0.4));
      area.style.transform = 'translateX(' + clamp + 'px)';
      area.style.opacity = String(1 - Math.abs(clamp) / 200);
    }

    /* Evitar scroll vertical mientras swipe horizontal */
    if (Math.abs(_touchDeltaX) > 15) { e.preventDefault(); }
  }

  function _onTouchEnd() {
    if (!_swiping) return;
    _swiping = false;

    var area = document.getElementById('lb-swipe-area');
    if (area) { area.style.transform = ''; area.style.opacity = ''; }

    if (Math.abs(_touchDeltaX) >= SWIPE_THRESHOLD) {
      _navigate(_touchDeltaX < 0 ? 1 : -1);
    }
  }

  /* ── Navegación entre días / semanas ───────────────── */

  function _navigate(direction) {
    if (_isLoading) return;

    if (_period === 'weekly') {
      /* Navegar entre semanas */
      if (!_currentWeekId || typeof WeekUtils === 'undefined') return;

      var nextWeekId = direction > 0
        ? WeekUtils.getNextWeekId(_currentWeekId)
        : WeekUtils.getPreviousWeekId(_currentWeekId);

      /* No permitir ir a semanas futuras */
      if (direction > 0 && nextWeekId > WeekUtils.getWeekId()) return;

      /* No permitir ir antes de la semana 1 del año en curso */
      var minWeekId = new Date().getFullYear() + '-W01';
      if (direction < 0 && nextWeekId < minWeekId) return;

      _slideAndLoad(direction, function () { _currentWeekId = nextWeekId; });

    } else {
      /* Navegar entre días */
      var next = new Date(_currentDate);
      next.setDate(next.getDate() + direction);

      /* No permitir ir al futuro */
      var today = new Date();
      today.setHours(23, 59, 59, 999);
      if (next > today) return;

      /* No permitir ir antes del 1 de enero del año en curso */
      var yearStart = new Date(new Date().getFullYear(), 0, 1);
      yearStart.setHours(0, 0, 0, 0);
      if (next < yearStart) return;

      _slideAndLoad(direction, function () { _currentDate = next; });
    }
  }

  /* ── Animación de transición entre períodos ────────── */

  function _slideAndLoad(direction, applyChange) {
    var swipeArea = document.getElementById('lb-swipe-area');
    var slideOut  = direction > 0 ? '-100%' : '100%';
    var slideIn   = direction > 0 ? '100%'  : '-100%';

    if (swipeArea) {
      swipeArea.style.transition = 'transform .2s ease, opacity .2s ease';
      swipeArea.style.transform  = 'translateX(' + slideOut + ')';
      swipeArea.style.opacity    = '0';

      setTimeout(function () {
        applyChange();
        _updateDateDisplay();
        swipeArea.style.transition = 'none';
        swipeArea.style.transform  = 'translateX(' + slideIn + ')';
        swipeArea.style.opacity    = '0';

        requestAnimationFrame(function () {
          swipeArea.style.transition = 'transform .2s ease, opacity .2s ease';
          swipeArea.style.transform  = 'translateX(0)';
          swipeArea.style.opacity    = '1';
        });

        _loadRanking();
      }, 200);
    } else {
      applyChange();
      _updateDateDisplay();
      _loadRanking();
    }
  }

  /* ── Animación de transición entre tabs (fade vertical) ── */

  function _fadeAndLoad() {
    var swipeArea = document.getElementById('lb-swipe-area');
    if (swipeArea) {
      swipeArea.style.transition = 'opacity ' + (FADE_DURATION_MS / 1000) + 's ease';
      swipeArea.style.opacity    = '0';

      setTimeout(function () {
        swipeArea.style.transition = 'none';
        requestAnimationFrame(function () {
          swipeArea.style.transition = 'opacity ' + (FADE_DURATION_MS / 1000) + 's ease';
          swipeArea.style.opacity    = '1';
        });
        _loadRanking();
      }, FADE_DURATION_MS);
    } else {
      _loadRanking();
    }
  }

  /* ── Fecha / Semana ────────────────────────────────── */

  function _isToday(d) {
    var n = new Date();
    return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
  }

  function _isYesterday(d) {
    var y = new Date(); y.setDate(y.getDate() - 1);
    return d.getFullYear() === y.getFullYear() && d.getMonth() === y.getMonth() && d.getDate() === y.getDate();
  }

  function _formatDateLabel(d) {
    if (_isToday(d))     return t('date_today');
    if (_isYesterday(d)) return t('date_yesterday');
    var lang = typeof getLang === 'function' ? getLang() : 'es';
    var opts = { day: 'numeric', month: 'short' };
    if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
    return d.toLocaleDateString(lang === 'en' ? 'en-GB' : 'es-ES', opts);
  }

  function _updateDateDisplay() {
    var label   = document.getElementById('lb-date-label');
    var btnPrev = document.getElementById('lb-prev');
    var btnNext = document.getElementById('lb-next');
    var badge   = document.getElementById('lb-today-badge');
    var hint    = document.getElementById('lb-swipe-hint');

    if (_period === 'weekly') {
      /* Modo semanal: mostrar etiqueta de semana */
      if (_currentWeekId && label) {
        var weekNum = parseInt(_currentWeekId.split('-W')[1], 10);
        label.textContent = t('lb_week_label', { n: weekNum });
      }

      /* Badge "EN VIVO" solo si es la semana actual */
      var isCurrentWeek = _currentWeekId &&
        typeof WeekUtils !== 'undefined' &&
        _currentWeekId === WeekUtils.getWeekId();
      if (badge) badge.style.display = isCurrentWeek ? 'inline-flex' : 'none';

      /* Deshabilitar flecha derecha si estamos en la semana actual */
      if (btnNext) {
        btnNext.disabled = !!isCurrentWeek;
        btnNext.style.opacity = isCurrentWeek ? '0.25' : '1';
      }

      /* Deshabilitar flecha izquierda si estamos en la primera semana del año */
      if (btnPrev) {
        var atFirstWeek = _currentWeekId === (new Date().getFullYear() + '-W01');
        btnPrev.disabled = atFirstWeek;
        btnPrev.style.opacity = atFirstWeek ? '0.25' : '1';
      }

      /* Hint de swipe semanal */
      if (hint) hint.textContent = t('lb_swipe_hint_weekly');

    } else {
      /* Modo diario: comportamiento original */
      if (label) label.textContent = _formatDateLabel(_currentDate);

      /* Deshabilitar flecha derecha si estamos en hoy */
      if (btnNext) {
        var atToday = _isToday(_currentDate);
        btnNext.disabled = atToday;
        btnNext.style.opacity = atToday ? '0.25' : '1';
      }

      /* Badge "hoy" */
      if (badge) badge.style.display = _isToday(_currentDate) ? 'inline-flex' : 'none';

      /* Deshabilitar flecha izquierda si estamos en el 1 de enero del año en curso */
      if (btnPrev) {
        var atYearStart = _currentDate.getFullYear() === new Date().getFullYear()
          && _currentDate.getMonth() === 0 && _currentDate.getDate() === 1;
        btnPrev.disabled = atYearStart;
        btnPrev.style.opacity = atYearStart ? '0.25' : '1';
      }

      /* Hint de swipe diario */
      if (hint) hint.textContent = t('lb_swipe_hint');
    }
  }

  /* ── Cargar ranking ────────────────────────────────── */

  function _loadRanking() {
    _isLoading = true;
    _showState('loading');
    _renderMe(null, null, true);

    var opts = {
      period:  _period,
      dateKey: (_period === 'weekly')
        ? _currentWeekId
        : FirebaseLeaderboard.formatDate(_currentDate),
      limit: MAX_VISIBLE_ENTRIES
    };

    /* Aplicar filtro geográfico */
    if (_geoFilter !== 'global') {
      opts.continent = _geoFilter;
    }

    FirebaseLeaderboard.getFilteredRanking(opts).then(function (entries) {
      _isLoading = false;
      if (!entries || !entries.length) {
        _showState('empty');
        _renderMe(null, 0);
        _updateShareButton(null);
        _updateMyPosition([]);
        return;
      }
      _renderEntries(entries);
      _showState('list');

      /* Actualizar botón compartir */
      var me = null;
      for (var i = 0; i < entries.length; i++) {
        if (entries[i].isMe) { me = entries[i]; me._total = entries.length; break; }
      }
      _renderMe(me, entries.length);
      _updateShareButton(me);
      _updateMyPosition(entries);

    }).catch(function (err) {
      _isLoading = false;
      _showState('error', err);
      _updateShareButton(null);
      _updateMyPosition([]);
    });
  }

  /* ── Estados del contenido ─────────────────────────── */

  function _showState(state, err) {
    var loading = document.getElementById('lb-loading');
    var list    = document.getElementById('lb-list');
    var empty   = document.getElementById('lb-empty');
    var error   = document.getElementById('lb-error');

    if (loading) loading.style.display = state === 'loading' ? 'flex' : 'none';
    if (list)    list.style.display    = state === 'list'    ? 'flex' : 'none';
    if (empty) {
      empty.style.display = state === 'empty' ? 'block' : 'none';
      if (state === 'empty') {
        var emptyIcon, emptyKey;
        if (_period === 'weekly') {
          emptyIcon = '📅';
          emptyKey  = 'lb_empty_weekly';
        } else if (_isToday(_currentDate)) {
          emptyIcon = '🌍';
          emptyKey  = 'lb_empty_today';
        } else {
          emptyIcon = '📭';
          emptyKey  = 'lb_empty_past';
        }
        empty.innerHTML = '<span class="lb-empty-icon">' + emptyIcon + '</span><br>' + t(emptyKey);
      }
    }
    if (error) {
      error.style.display = state === 'error' ? 'block' : 'none';
      if (state === 'error') {
        error.innerHTML = '⚠️ ' + t('lb_error');
        if (err && err.message) {
          console.error('[Leaderboard UI]', err.code, err.message);
        }
      }
    }
  }

  /* ── Renderizar entradas ───────────────────────────── */

  function _renderEntries(entries) {
    var list = document.getElementById('lb-list');
    if (!list) return;

    /* Mismo marcado que las filas de "Mejores rachas" (marathon-rank-ui.js):
       posición/medalla · avatar con inicial · nombre + país · puntos */
    list.innerHTML = entries.map(function (entry, idx) {
      var pos = idx + 1;
      var c   = (entry.country && typeof COUNTRIES_BY_CODE !== 'undefined') ? COUNTRIES_BY_CODE[entry.country] : null;
      var sub = c ? (c.flag + ' ' + (typeof cn === 'function' ? cn(c) : entry.country)) : '';
      if (_period === 'weekly' && entry.daysPlayed) {
        sub += (sub ? ' · ' : '') + t('lb_days_played', { n: entry.daysPlayed });
      }
      return '<li class="profile-friend card marathon-rank-row' +
          (entry.isMe ? ' marathon-rank-row--me lb-entry--me' : '') +
          (pos <= 3 ? ' marathon-rank-row--top' : '') + '">' +
        '<span class="marathon-rank-pos">' + (pos <= 3 ? MEDALS[idx] : pos) + '</span>' +
        _rowAvatarHtml(entry) +
        '<span class="profile-friend-info">' +
          '<span class="profile-friend-name">' + _esc(entry.playerName) +
            (entry.isMe ? ' <span class="lb-badge-you">' + t('lb_you') + '</span>' : '') + '</span>' +
          (sub ? '<span class="profile-friend-code">' + _esc(sub) + '</span>' : '') +
        '</span>' +
        '<span class="marathon-rank-streak">' + entry.score + '<small> pts</small></span>' +
      '</li>';
    }).join('');

    /* Scroll al jugador actual */
    requestAnimationFrame(function () {
      var myRow = list.querySelector('.lb-entry--me');
      if (myRow) {
        setTimeout(function () {
          myRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 300);
      }
    });
  }

  /* Avatar circular de fila (igual que marathon-rank-ui.js): foto si hay URL,
     inicial si no o si falla. Mi fila usa mi avatar de perfil si falta. */
  function _rowAvatarHtml(entry) {
    var url = entry.avatarUrl;
    if (!url && entry.isMe && typeof PlayerProfile !== 'undefined') url = PlayerProfile.getProfile().avatarUrl;
    return '<span class="profile-friend-avatar" aria-hidden="true">' +
      (url ? '<img class="marathon-rank-avatar-img" src="' + _esc(url) + '" alt="" referrerpolicy="no-referrer" ' +
             'onerror="this.remove()"/>' : '') +
      _esc(_initial(entry.playerName)) + '</span>';
  }

  function _initial(name) {
    var chars = Array.from(String(name || '').trim());
    return chars.length ? chars[0].toUpperCase() : '👤';
  }

  /* ── Mi tarjeta (estilo .profile-card de la maratón) ── */

  /* ¿Jugué el día que se muestra? Ranking (si salgo) o registro local
     (cubre filtros geográficos o quedar fuera del top visible). */
  function _playedShownDay(myEntry) {
    if (myEntry) return true;
    var st = (typeof loadDailyStatus === 'function') ? loadDailyStatus() : {};
    return !!st[FirebaseLeaderboard.formatDate(_currentDate)];
  }

  /* ¿Jugué algún día de la semana que se muestra? (mismo criterio, semanal) */
  function _playedShownWeek(myEntry) {
    if (myEntry) return true;
    if (typeof WeekUtils === 'undefined' || typeof loadDailyStatus !== 'function') return false;
    return Object.keys(loadDailyStatus()).some(function (k) {
      var p = k.split('-');
      return p.length === 3 && WeekUtils.getWeekId(new Date(+p[0], +p[1] - 1, +p[2])) === _currentWeekId;
    });
  }

  /* Día anterior de la semana en curso sin jugar → botón "ver vídeo y jugar" */
  function _canPlayMissedDay(myEntry) {
    if (_period !== 'daily' || _isToday(_currentDate) || _playedShownDay(myEntry)) return false;
    if (_currentDate > new Date()) return false;
    if (typeof WeekUtils === 'undefined') return false;
    return WeekUtils.getWeekId(_currentDate) === WeekUtils.getWeekId();
  }

  function _renderMe(myEntry, total, loading) {
    var box = document.getElementById('lb-me');
    if (!box) return;
    var p    = (typeof PlayerProfile !== 'undefined') ? PlayerProfile.getProfile() : {};
    var name = p.nickname || t('profile_guest');
    var url  = p.avatarUrl;

    var played = loading || (_period === 'weekly' ? _playedShownWeek(myEntry) : _playedShownDay(myEntry));
    var meta = (played && !loading && _period === 'daily') ? t('home_daily_done') : '';

    var body;
    if (played) {
      body =
        '<div class="profile-badges">' +
          '<div class="profile-badge"><span class="profile-badge-val">⭐ ' + (myEntry ? myEntry.score : '—') + '</span>' +
            '<span class="profile-badge-label">pts</span></div>' +
          '<div class="profile-badge"><span class="profile-badge-val">' + (myEntry ? '#' + myEntry.position : '—') + '</span>' +
            '<span class="profile-badge-label">' + _esc(t('lb_your_position')) + '</span></div>' +
          '<div class="profile-badge"><span class="profile-badge-val">👥 ' + (total || '—') + '</span>' +
            '<span class="profile-badge-label">' + _esc(t('lb_participants')) + '</span></div>' +
        '</div>';
    } else {
      var key = _period === 'weekly' ? 'lb_not_played_week'
              : (_isToday(_currentDate) ? 'lb_not_played_today' : 'lb_not_played_day');
      body =
        '<div class="lb-me-notice" role="status">' +
          '<span class="lb-me-notice-icon" aria-hidden="true">📭</span>' +
          '<span class="lb-me-notice-text">' + _esc(t(key)) + '</span>' +
        '</div>' +
        (_canPlayMissedDay(myEntry)
          ? '<button class="btn-lb-play-missed" id="btn-lb-play-missed" type="button">' +
              _esc(t('lb_play_missed_btn')) + '</button>'
          : '');
    }

    box.innerHTML =
      '<div class="profile-identity">' +
        '<div class="profile-avatar" aria-hidden="true">' +
          (url ? '<img class="profile-avatar-img" src="' + _esc(url) + '" alt="" referrerpolicy="no-referrer" ' +
                 'onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'"/>' : '') +
          '<span class="profile-avatar-initial"' + (url ? ' style="display:none"' : '') + '>' +
            _esc(_initial(name)) + '</span>' +
        '</div>' +
        '<div class="profile-identity-text">' +
          '<h3 class="profile-nickname">' + _esc(name) + '</h3>' +
          (meta ? '<p class="profile-meta">' + _esc(meta) + '</p>' : '') +
        '</div>' +
      '</div>' + body;
  }

  /* Botón "ver vídeo y jugar este día". La lógica para cualquier día de la
     semana llegará en un desarrollo posterior. Mientras tanto, si el día es
     ayer y la recuperación por vídeo es elegible, se lanza (flujo de main.js
     registrado con onRecovery); si no, "Próximamente". */
  function _onPlayMissed() {
    var check = (_isYesterday(_currentDate) && typeof AdRewardService !== 'undefined')
      ? AdRewardService.canRecoverMissedDay() : null;
    if (check && check.eligible && typeof _onRecoveryRequested === 'function') {
      var btn = document.getElementById('btn-lb-play-missed');
      if (btn) btn.disabled = true; /* prevenir doble-tap */
      close();
      _onRecoveryRequested();
      return;
    }
    _showShareToast(t('home_coming_soon'));
  }

  /* ── Posición fija del jugador ─────────────────────── */

  function _updateMyPosition(entries) {
    var container = document.getElementById('lb-my-position');
    if (!container) return;

    /* Buscar si el jugador está en las entries */
    var myEntry = null;
    for (var i = 0; i < entries.length; i++) {
      if (entries[i].isMe) { myEntry = entries[i]; break; }
    }

    /* Si está en la lista visible (top MAX_VISIBLE_ENTRIES) o no ha jugado
       (lo avisa la tarjeta de arriba), ocultar el sticky */
    if (!myEntry || myEntry.position <= MAX_VISIBLE_ENTRIES) {
      container.style.display = 'none';
      return;
    }

    /* Si no está en la lista visible, mostrar sticky con su posición */
    container.style.display = 'block';
    var rankEl  = document.getElementById('lb-my-pos-rank');
    var nameEl  = document.getElementById('lb-my-pos-name');
    var scoreEl = document.getElementById('lb-my-pos-score');

    if (myEntry) {
      if (rankEl)  rankEl.textContent  = '#' + myEntry.position;
      if (nameEl)  nameEl.textContent  = myEntry.playerName;
      if (scoreEl) scoreEl.textContent = myEntry.score + ' pts';
    } else {
      if (rankEl)  rankEl.textContent  = '#\u2014'; /* — em dash: sin posición */
      if (nameEl)  nameEl.textContent  = t('lb_not_ranked');
      if (scoreEl) scoreEl.textContent = '';
    }
  }

  /* ── Botón compartir ───────────────────────────────── */

  function _updateShareButton(myEntry) {
    var btn = document.getElementById('btn-lb-share');
    if (!btn) return;
    btn.style.display = myEntry ? 'flex' : 'none';
    btn._entry = myEntry;
  }

  function _shareRanking() {
    var btn = document.getElementById('btn-lb-share');
    var entry = btn && btn._entry;
    if (!entry) return;

    var posEmoji = entry.position <= 3 ? MEDALS[entry.position - 1] : '🏅';
    var text;
    /* URL de descarga/share centralizada (fallback a Play Store si el
       módulo no estuviera cargado). */
    var _shareUrl = (window.ShareLinks && typeof window.ShareLinks.getShareUrl === 'function')
      ? window.ShareLinks.getShareUrl({ type: 'app' })
      : 'https://play.google.com/store/apps/details?id=com.sisapicasso.flagmaster';

    if (_period === 'weekly') {
      /* Texto adaptado para ranking semanal */
      var weekNum = (_currentWeekId && _currentWeekId.indexOf('-W') !== -1)
        ? parseInt(_currentWeekId.split('-W')[1], 10) : '';
      var daysInfo = entry.daysPlayed ? ' ' + t('share_ranking_days_info', { n: entry.daysPlayed, total: DAYS_PER_WEEK }) : '';

      text = 'FlagMaster ' + posEmoji + '\n' +
        t('share_ranking_weekly_title', { n: weekNum }) + '\n' +
        t('share_ranking_score', { score: entry.score }) + daysInfo + '\n' +
        t('share_ranking_position', { pos: entry.position, total: (entry._total || '?') }) + '\n' +
        t('share_ranking_challenge') + '\n' +
        _shareUrl;

    } else {
      /* Texto para ranking diario */
      var dateLabel = _formatDateLabel(_currentDate);

      text = 'FlagMaster ' + posEmoji + '\n' +
        t('share_ranking_daily_title', { date: dateLabel }) + '\n' +
        t('share_ranking_score', { score: entry.score }) + '\n' +
        t('share_ranking_position', { pos: entry.position, total: (entry._total || '?') }) + '\n' +
        t('share_ranking_challenge') + '\n' +
        _shareUrl;
    }

    /* Capacitor Share → clipboard fallback */
    if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Share) {
      window.Capacitor.Plugins.Share.share({
        title: 'FlagMaster ' + posEmoji,
        text: text,
        dialogTitle: t('share_ranking_dialog')
      }).catch(function () {});
      return;
    }

    /* Fallback: copiar al portapapeles */
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        _showShareToast(t('share_ranking_copied'));
      }).catch(function () {});
    } else {
      try {
        var ta = document.createElement('textarea');
        ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        _showShareToast(t('share_ranking_copied'));
      } catch (e) {}
    }
  }

  function _showShareToast(msg) {
    var toastEl = document.getElementById('achievement-toast');
    var icon    = document.getElementById('achievement-toast-icon');
    var name    = document.getElementById('achievement-toast-name');
    var label   = document.getElementById('achievement-toast-label');
    if (!toastEl) return;
    if (icon)  icon.textContent  = '📋';
    if (name)  name.textContent  = msg;
    if (label) label.textContent = '';
    toastEl.style.display = 'flex';
    toastEl.classList.remove('toast-hide');
    toastEl.classList.add('toast-show');
    setTimeout(function () {
      toastEl.classList.add('toast-hide');
      setTimeout(function () {
        toastEl.style.display = 'none';
        toastEl.classList.remove('toast-show', 'toast-hide');
      }, 400);
    }, 2000);
  }

  function _esc(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  /* ── Registrar callback de recovery ───────────────── */

  function onRecovery(cb) {
    _onRecoveryRequested = cb;
  }

  /* ── API pública ───────────────────────────────────── */

  return {
    open:       open,
    close:      close,
    isOpen:     isOpen,
    onRecovery: onRecovery
  };
})();
