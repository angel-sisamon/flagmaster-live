/**
 * js/profile-ui.js — Pantalla "Perfil de jugador" (sustituye a "Tus estadísticas")
 *
 *   ┌──────────────────────────────────────────┐
 *   │ [avatar]  Nickname                       │
 *   │           🇪🇸 España · Miembro desde …    │
 *   │           ☁️ Guardado en la nube          │
 *   │   ⭐ Estrellas   🔥 Racha   👥 Amigos      │
 *   │   Código de amigo  K7M2QX  [📋] [👤+]     │
 *   ├──────────────────────────────────────────┤
 *   │ 📊 Estadísticas │ 👥 Amigos │ 🏆 Trofeos   │
 *   └──────────────────────────────────────────┘
 *
 * Solo lee la copia local (PlayerProfile.getProfile()): abrir el perfil NO
 * genera lecturas en Firestore.
 *
 * Depende de: player-profile.js, stats-renderer.js, achievements.js, i18n.js (t, getLang),
 *             countries-data.js (COUNTRIES_BY_CODE), utils.js (cn, escHtml),
 *             ui.js (showScreen, _showCopyToast)
 */

var ProfileUI = (function () {

  var TABS             = ['stats', 'friends', 'trophies'];
  var COPY_FEEDBACK_MS = 1800;

  var _bound               = false;
  var _activeTab           = 'stats';
  var _copyTimer           = null;
  var _avatarFailedUrl     = null;
  var _lastFocus           = null;
  var _removeFriendId      = null;
  var _returnFromAchievements = false;

  function _el(id) { return document.getElementById(id); }

  function _esc(s) {
    return (typeof escHtml === 'function') ? escHtml(s) : String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* ══════════════════════════════════════════════════════
   * PANTALLA
   * ══════════════════════════════════════════════════════ */

  /** Abre el perfil en la pestaña indicada ('stats' | 'friends' | 'trophies'). */
  function open(tab) {
    _bind();
    _renderHeader();
    _selectTab(TABS.indexOf(tab) !== -1 ? tab : 'stats');
    showScreen('stats');
  }

  function _isVisible() {
    var s = _el('screen-stats');
    return !!(s && s.classList.contains('active'));
  }

  /**
   * Repinta la cabecera si el perfil está visible.
   * @param {{data?:boolean}} [opts]  data=true → también el panel activo (p. ej. tras
   *                                  descargar progreso remoto en el Caso C).
   */
  function refresh(opts) {
    if (!_isVisible()) return;
    _renderHeader();
    if (opts && opts.data) _renderPanel(_activeTab);
  }

  /* ══════════════════════════════════════════════════════
   * CABECERA
   * ══════════════════════════════════════════════════════ */

  function _flagEmoji(code) {
    if (typeof COUNTRIES_BY_CODE !== 'undefined' && COUNTRIES_BY_CODE[code]) return COUNTRIES_BY_CODE[code].flag;
    try {
      return String.fromCodePoint(0x1F1E6 + code.charCodeAt(0) - 65, 0x1F1E6 + code.charCodeAt(1) - 65);
    } catch (e) { return '🏳️'; }
  }

  function _countryLabel(code) {
    if (!code) return '';
    var c = (typeof COUNTRIES_BY_CODE !== 'undefined') ? COUNTRIES_BY_CODE[code] : null;
    var name = (c && typeof cn === 'function') ? cn(c) : code;
    return _flagEmoji(code) + ' ' + name;
  }

  function _fmtMonthYear(ms) {
    try {
      return new Date(ms).toLocaleDateString(getLang(), { month: 'short', year: 'numeric' });
    } catch (e) {
      var d = new Date(ms);
      return (d.getMonth() + 1) + '/' + d.getFullYear();
    }
  }

  function _initial(name) {
    var chars = Array.from(String(name || '').trim());
    return chars.length ? chars[0].toUpperCase() : '👤';
  }

  function _renderAvatar(p) {
    var img = _el('profile-avatar-img');
    var initial = _el('profile-avatar-initial');
    if (!img || !initial) return;
    var url = p.avatarUrl;
    if (url && url !== _avatarFailedUrl) {
      if (img.getAttribute('src') !== url) {
        img.onerror = function () {
          _avatarFailedUrl = url;
          img.style.display = 'none';
          initial.style.display = 'flex';
        };
        img.src = url;
      }
      img.style.display = 'block';
      initial.style.display = 'none';
    } else {
      img.style.display = 'none';
      initial.style.display = 'flex';
    }
    initial.textContent = p.nickname ? _initial(p.nickname) : '👤';
  }

  function _renderHeader() {
    if (typeof PlayerProfile === 'undefined') return;
    var p = PlayerProfile.getProfile();

    _renderAvatar(p);

    var nick = _el('profile-nickname');
    if (nick) nick.textContent = p.nickname || t('profile_guest');

    var meta = _el('profile-meta');
    if (meta) {
      var parts = [];
      if (p.country) parts.push(_countryLabel(p.country));
      if (p.createdAt) parts.push(t('profile_member_since', { date: _fmtMonthYear(p.createdAt) }));
      meta.textContent = parts.join(' · ');
      meta.style.display = parts.length ? '' : 'none';
    }

    var badge = _el('profile-sync-badge');
    if (badge) {
      badge.className = 'profile-sync-badge profile-sync-badge--' + p.syncState;
      badge.textContent = t('profile_sync_' + p.syncState);
    }

    var stars = _el('profile-stars');
    if (stars) stars.textContent = '⭐ ' + (p.stars || 0);
    var streak = _el('profile-streak');
    if (streak) streak.textContent = '🔥 ' + (p.streakDays || 0);
    var friends = _el('profile-friends-count');
    if (friends) friends.textContent = '👥 ' + p.friends.length;

    _renderFriendCode(p);
  }

  function _renderFriendCode(p) {
    var codeEl  = _el('profile-friend-code');
    var copyBtn = _el('btn-copy-friend-code');
    var addBtn  = _el('btn-add-friend');
    var hint    = _el('profile-code-hint');
    var hasCode = PlayerProfile.isValidFriendCode(p.friendCode);

    if (codeEl) {
      codeEl.textContent = hasCode ? p.friendCode : '······';
      codeEl.classList.toggle('profile-code--empty', !hasCode);
    }
    if (copyBtn) {
      copyBtn.disabled = !hasCode;
      if (!copyBtn.classList.contains('profile-code-btn--done')) {
        copyBtn.setAttribute('aria-label', t('profile_copy_code'));
        copyBtn.title = t('profile_copy_code');
      }
    }
    if (addBtn) {
      addBtn.setAttribute('aria-label', t('profile_add_friend'));
      addBtn.title = t('profile_add_friend');
    }
    if (hint) {
      if (hasCode) {
        hint.style.display = 'none';
      } else {
        /* Sin código: invitado (necesita PGS) o pendiente del primer alta en Firestore */
        hint.textContent = t(p.signedIn ? 'profile_code_pending' : 'profile_code_guest');
        hint.style.display = '';
      }
    }
  }

  /* ══════════════════════════════════════════════════════
   * PESTAÑAS
   * ══════════════════════════════════════════════════════ */

  function _selectTab(tab) {
    _activeTab = tab;
    TABS.forEach(function (name) {
      var btn = _el('profile-tab-' + name);
      var panel = _el('profile-panel-' + name);
      var on = name === tab;
      if (btn) {
        btn.classList.toggle('profile-tab--active', on);
        btn.setAttribute('aria-selected', on ? 'true' : 'false');
        btn.tabIndex = on ? 0 : -1;
      }
      if (panel) panel.hidden = !on;
    });
    _renderPanel(tab);
  }

  function _renderPanel(tab) {
    if (tab === 'stats') {
      if (typeof StatsRenderer !== 'undefined') StatsRenderer.render();
    } else if (tab === 'friends') {
      _renderFriends();
    } else {
      _renderTrophies();
    }
  }

  /** Flechas izquierda/derecha, Inicio y Fin entre pestañas (patrón WAI-ARIA tabs). */
  function _onTabKeydown(e) {
    var idx = TABS.indexOf(_activeTab);
    var next = -1;
    if (e.key === 'ArrowRight') next = (idx + 1) % TABS.length;
    else if (e.key === 'ArrowLeft') next = (idx - 1 + TABS.length) % TABS.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = TABS.length - 1;
    if (next === -1) return;
    e.preventDefault();
    _selectTab(TABS[next]);
    var btn = _el('profile-tab-' + TABS[next]);
    if (btn) btn.focus();
  }

  function _emptyState(icon, text, ctaId, ctaText) {
    return '<div class="profile-empty">' +
      '<span class="profile-empty-icon" aria-hidden="true">' + icon + '</span>' +
      '<p class="profile-empty-text">' + _esc(text) + '</p>' +
      (ctaId ? '<button class="btn btn-primary profile-empty-cta" type="button" id="' + ctaId + '">' + _esc(ctaText) + '</button>' : '') +
      '</div>';
  }

  /* ── Amigos ─────────────────────────────────────────── */

  function _renderFriends() {
    var panel = _el('profile-panel-friends');
    if (!panel) return;
    var p = PlayerProfile.getProfile();

    if (!p.friends.length) {
      panel.innerHTML = _emptyState('👥', t('profile_friends_empty'), 'btn-add-friend-empty', t('profile_add_friend'));
      return;
    }

    /* Cada entrada denormalizada permite pintar la lista sin lecturas adicionales. */
    var html = '<ul class="profile-friend-list">';
    p.friends.forEach(function (f) {
      var entry = (f && typeof f === 'object') ? f : { id: String(f) };
      var name = entry.nickname || entry.id || '?';
      var id = String(entry.id || '');
      html += '<li class="profile-friend card">' +
        '<span class="profile-friend-avatar" aria-hidden="true">' + _esc(_initial(name)) + '</span>' +
        '<span class="profile-friend-info">' +
          '<span class="profile-friend-name">' + _esc(name) + '</span>' +
          (entry.friendCode ? '<span class="profile-friend-code">' + _esc(entry.friendCode) + '</span>' : '') +
        '</span>' +
        (entry.country && /^[A-Z]{2}$/.test(entry.country)
          ? '<span class="profile-friend-flag" aria-hidden="true">' + _flagEmoji(entry.country) + '</span>' : '') +
        '<button class="profile-friend-remove" type="button" data-friend-id="' + _esc(id) +
          '" aria-label="' + _esc(t('friend_remove_aria')) + '">✕</button>' +
        '</li>';
    });
    html += '</ul>';
    panel.innerHTML = html;
  }

  /* ── Trofeos ────────────────────────────────────────── */

  function _renderTrophies() {
    var panel = _el('profile-panel-trophies');
    if (!panel) return;
    var p = PlayerProfile.getProfile();
    var unlocked = (typeof loadAchievements === 'function') ? loadAchievements().unlocked.length : 0;
    var total = (typeof ACHIEVEMENT_IDS !== 'undefined') ? ACHIEVEMENT_IDS.length : 0;

    /* Acceso a los logros locales existentes mientras llegan los trofeos */
    var html = '<button class="profile-ach-link card" type="button" id="btn-profile-achievements">' +
      '<span class="profile-ach-icon" aria-hidden="true">🏅</span>' +
      '<span class="profile-ach-text">' + _esc(t('home_achievements')) + '</span>' +
      '<span class="profile-ach-count">' + _esc(t('ach_progress', { n: unlocked, total: total })) + '</span>' +
      '<span class="profile-ach-arrow" aria-hidden="true">›</span>' +
      '</button>';

    if (!p.trophies.length) {
      html += _emptyState('🏆', t('profile_trophies_empty'));
    } else {
      /* FUTURO: trofeos otorgados por el servidor (torneos, temporadas, eventos):
         { id, icon, name, earnedAt }. */
      html += '<div class="profile-trophy-grid">';
      p.trophies.forEach(function (tr) {
        var entry = (tr && typeof tr === 'object') ? tr : { id: String(tr) };
        html += '<div class="profile-trophy card">' +
          '<span class="profile-trophy-icon" aria-hidden="true">' + _esc(entry.icon || '🏆') + '</span>' +
          '<span class="profile-trophy-name">' + _esc(entry.name || entry.id || '') + '</span>' +
          '</div>';
      });
      html += '</div>';
    }
    panel.innerHTML = html;
  }

  /* ══════════════════════════════════════════════════════
   * CÓDIGO DE AMIGO: COPIAR
   * ══════════════════════════════════════════════════════ */

  function _legacyCopy(text) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed'; ta.style.top = '0'; ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return !!ok;
    } catch (e) { return false; }
  }

  /** Copia al portapapeles. @returns {Promise<boolean>} */
  function _copyText(text) {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      return navigator.clipboard.writeText(text)
        .then(function () { return true; }, function () { return _legacyCopy(text); });
    }
    return Promise.resolve(_legacyCopy(text));
  }

  function _copyFriendCode() {
    var code = PlayerProfile.getProfile().friendCode;
    if (!PlayerProfile.isValidFriendCode(code)) return;
    _copyText(code).then(function (ok) {
      var btn = _el('btn-copy-friend-code');
      if (!ok) {
        if (typeof _showCopyToast === 'function') _showCopyToast(t('profile_code_copy_error'));
        return;
      }
      if (btn) {
        btn.classList.add('profile-code-btn--done');
        btn.setAttribute('aria-label', t('profile_code_copied'));
        if (_copyTimer) clearTimeout(_copyTimer);
        _copyTimer = setTimeout(function () {
          _copyTimer = null;
          btn.classList.remove('profile-code-btn--done');
          btn.setAttribute('aria-label', t('profile_copy_code'));
        }, COPY_FEEDBACK_MS);
      }
      if (typeof FeedbackManager !== 'undefined' && FeedbackManager.onButtonTap) FeedbackManager.onButtonTap();
      if (typeof _showCopyToast === 'function') _showCopyToast(t('profile_code_copied'));
    });
  }

  /* ══════════════════════════════════════════════════════
   * MODAL: AÑADIR AMIGO
   * ══════════════════════════════════════════════════════ */

  function _setFeedback(msg, kind) {
    var fb = _el('add-friend-feedback');
    if (!fb) return;
    fb.textContent = msg || '';
    fb.className = 'profile-add-friend-feedback' + (kind ? ' profile-add-friend-feedback--' + kind : '');
  }

  function openAddFriendModal() {
    _bind();
    var modal = _el('modal-add-friend');
    var input = _el('add-friend-input');
    if (!modal || !input) return;
    _lastFocus = document.activeElement;
    input.value = '';
    _setFeedback('', '');
    var submit = _el('btn-add-friend-submit');
    submit.disabled = true;
    submit.textContent = t('friend_add_submit');
    modal.style.display = 'flex';
    setTimeout(function () { try { input.focus(); } catch (e) {} }, 60);
  }

  function isAddFriendOpen() {
    var modal = _el('modal-add-friend');
    return !!(modal && modal.style.display !== 'none');
  }

  function closeAddFriendModal() {
    if (!isAddFriendOpen()) return;
    _el('modal-add-friend').style.display = 'none';
    if (_lastFocus && typeof _lastFocus.focus === 'function') {
      try { _lastFocus.focus(); } catch (e) {}
    }
    _lastFocus = null;
  }

  function _onCodeInput() {
    var input = _el('add-friend-input');
    var norm = PlayerProfile.normalizeFriendCode(input.value);
    if (input.value !== norm) input.value = norm;
    _el('btn-add-friend-submit').disabled = norm.length !== PlayerProfile.FRIEND_CODE_LENGTH;
    _setFeedback('', '');
  }

  function _submitAddFriend() {
    var code = PlayerProfile.normalizeFriendCode(_el('add-friend-input').value);
    var me = PlayerProfile.getProfile();

    if (!PlayerProfile.isValidFriendCode(code)) {
      _setFeedback(t('friend_add_invalid'), 'error');
      return;
    }
    if (me.friendCode && code === me.friendCode) {
      _setFeedback(t('friend_add_self'), 'error');
      return;
    }
    if (!me.signedIn) {
      _setFeedback(t('friend_add_signin'), 'error');
      return;
    }

    var submit = _el('btn-add-friend-submit');
    submit.disabled = true;
    submit.textContent = t('friend_add_loading');
    _setFeedback(t('friend_add_loading'), 'info');

    PlayerProfile.addFriendByCode(code).then(function () {
      submit.textContent = t('friend_add_submit');
      closeAddFriendModal();
      refresh({ data: true });
      if (typeof _showCopyToast === 'function') _showCopyToast(t('friend_add_ok'));
    }).catch(function (err) {
      var key = {
        invalid: 'friend_add_invalid',
        self: 'friend_add_self',
        not_found: 'friend_add_not_found',
        already: 'friend_add_already',
        signin: 'friend_add_signin'
      }[err && err.code] || 'friend_add_error';
      _setFeedback(t(key), 'error');
      submit.disabled = false;
      submit.textContent = t('friend_add_submit');
    });
  }

  function _setRemoveFeedback(msg, kind) {
    var fb = _el('remove-friend-feedback');
    if (!fb) return;
    fb.textContent = msg || '';
    fb.className = 'profile-add-friend-feedback' + (kind ? ' profile-add-friend-feedback--' + kind : '');
  }

  function openRemoveFriendModal(friendId, name) {
    _bind();
    var modal = _el('modal-remove-friend');
    var confirm = _el('btn-remove-friend-confirm');
    if (!modal || !confirm) return;
    _lastFocus = document.activeElement;
    _removeFriendId = String(friendId || '');
    _el('remove-friend-text').textContent = t('friend_remove_confirm', { name: name || _removeFriendId });
    _setRemoveFeedback('', '');
    confirm.disabled = false;
    confirm.textContent = t('friend_remove_submit');
    modal.style.display = 'flex';
    setTimeout(function () { try { confirm.focus(); } catch (e) {} }, 60);
  }

  function closeRemoveFriendModal() {
    var modal = _el('modal-remove-friend');
    if (!modal || modal.style.display === 'none') return;
    modal.style.display = 'none';
    _removeFriendId = null;
    if (_lastFocus && typeof _lastFocus.focus === 'function') {
      try { _lastFocus.focus(); } catch (e) {}
    }
    _lastFocus = null;
  }

  function _submitRemoveFriend() {
    if (!_removeFriendId) return;
    var confirm = _el('btn-remove-friend-confirm');
    confirm.disabled = true;
    confirm.textContent = t('friend_remove_loading');
    _setRemoveFeedback('', '');
    PlayerProfile.removeFriendById(_removeFriendId).then(function () {
      closeRemoveFriendModal();
      refresh({ data: true });
      if (typeof _showCopyToast === 'function') _showCopyToast(t('friend_remove_ok'));
    }).catch(function () {
      _setRemoveFeedback(t('friend_remove_error'), 'error');
      confirm.disabled = false;
      confirm.textContent = t('friend_remove_submit');
    });
  }

  /* ══════════════════════════════════════════════════════
   * EVENTOS (se enlazan una sola vez)
   * ══════════════════════════════════════════════════════ */

  function _bind() {
    if (_bound) return;
    _bound = true;

    TABS.forEach(function (name) {
      var btn = _el('profile-tab-' + name);
      if (!btn) return;
      btn.addEventListener('click', function () { _selectTab(name); });
      btn.addEventListener('keydown', _onTabKeydown);
    });

    var copyBtn = _el('btn-copy-friend-code');
    if (copyBtn) copyBtn.addEventListener('click', _copyFriendCode);
    var addBtn = _el('btn-add-friend');
    if (addBtn) addBtn.addEventListener('click', openAddFriendModal);

    /* Botones creados dinámicamente dentro de los paneles (delegación) */
    var friendsPanel = _el('profile-panel-friends');
    if (friendsPanel) friendsPanel.addEventListener('click', function (e) {
      if (!e.target || !e.target.closest) return;
      var removeBtn = e.target.closest('.profile-friend-remove');
      if (removeBtn) {
        var row = removeBtn.closest('.profile-friend');
        var name = row && row.querySelector('.profile-friend-name');
        openRemoveFriendModal(removeBtn.getAttribute('data-friend-id'), name ? name.textContent : '');
        return;
      }
      if (e.target.closest('#btn-add-friend-empty')) openAddFriendModal();
    });
    var trophiesPanel = _el('profile-panel-trophies');
    if (trophiesPanel) trophiesPanel.addEventListener('click', function (e) {
      if (e.target && e.target.closest && e.target.closest('#btn-profile-achievements')) {
        _returnFromAchievements = true;
        renderAchievementsScreen();
        showScreen('achievements');
      }
    });

    var modal = _el('modal-add-friend');
    if (modal) {
      modal.addEventListener('click', function (e) { if (e.target === modal) closeAddFriendModal(); });
      _el('btn-add-friend-close').addEventListener('click', closeAddFriendModal);
      _el('btn-add-friend-cancel').addEventListener('click', closeAddFriendModal);
      _el('add-friend-input').addEventListener('input', _onCodeInput);
      _el('add-friend-form').addEventListener('submit', function (e) {
        e.preventDefault();
        _submitAddFriend();
      });
    }

    var removeModal = _el('modal-remove-friend');
    if (removeModal) {
      removeModal.addEventListener('click', function (e) {
        if (e.target === removeModal) closeRemoveFriendModal();
      });
      _el('btn-remove-friend-close').addEventListener('click', closeRemoveFriendModal);
      _el('btn-remove-friend-cancel').addEventListener('click', closeRemoveFriendModal);
      _el('btn-remove-friend-confirm').addEventListener('click', _submitRemoveFriend);
    }
  }

  /**
   * true (una sola vez) si la pantalla de logros se abrió desde el perfil,
   * para que su botón "volver" regrese aquí en lugar de a la home.
   */
  function consumeAchievementsReturn() {
    var r = _returnFromAchievements;
    _returnFromAchievements = false;
    return r;
  }

  /* ── API pública ─────────────────────────────────────── */

  return {
    open:                      open,
    refresh:                   refresh,
    openAddFriendModal:        openAddFriendModal,
    closeAddFriendModal:       closeAddFriendModal,
    isAddFriendOpen:           isAddFriendOpen,
    openRemoveFriendModal:     openRemoveFriendModal,
    closeRemoveFriendModal:    closeRemoveFriendModal,
    consumeAchievementsReturn: consumeAchievementsReturn
  };

})();
