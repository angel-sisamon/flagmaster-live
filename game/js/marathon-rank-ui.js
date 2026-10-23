/**
 * js/marathon-rank-ui.js — Pantalla "Mejores rachas" de la Maratón (#screen-marathon-ranking)
 *
 * Reutiliza el lenguaje visual del perfil de jugador y de la lista de amigos
 * (css/profile.css: .profile-card, .profile-tabs, .profile-friend*): tarjetas,
 * avatares, tipografía y paleta. Solo añade lo propio del ranking (posición y racha).
 *
 *   Pestaña Global → marathon_scores (MarathonLeaderboard.getTop) + indicador de
 *                    puestos subidos/bajados respecto al último cierre diario
 *   Pestaña Top 1  → marathon_top1 (días como nº1 al cierre diario, estilo tenis)
 *   Pestaña Mis rachas / fallback sin red → getMarathonRuns() (top-20 local)
 *
 * Depende de: storage.js, marathon.js, firebase-marathon-leaderboard.js,
 *             player-profile.js, i18n.js, utils.js, ui.js (showScreen)
 */

var MarathonRankUI = (function () {

  var TOP_LIMIT = 50;
  var _tab      = 'global';
  var _bound    = false;
  var _returnTo = 'home';
  var _reqId    = 0;
  var _myGlobal = null; /* { position, deltaHtml } de la última carga del Global */

  function _el(id) { return document.getElementById(id); }
  function _esc(s) { return escHtml(s == null ? '' : s); }

  function _initial(name) {
    var chars = Array.from(String(name || '').trim());
    return chars.length ? chars[0].toUpperCase() : '👤';
  }

  function _flag(code) {
    if (typeof COUNTRIES_BY_CODE !== 'undefined' && COUNTRIES_BY_CODE[code]) return COUNTRIES_BY_CODE[code].flag;
    return '';
  }

  function _countryName(code) {
    var c = (typeof COUNTRIES_BY_CODE !== 'undefined') ? COUNTRIES_BY_CODE[code] : null;
    return (c && typeof cn === 'function') ? cn(c) : (code || '');
  }

  /* Avatar circular de fila (estilo lista de amigos): foto si hay URL, inicial si no o si falla */
  function _avatarHtml(name, url) {
    return '<span class="profile-friend-avatar" aria-hidden="true">' +
      (url ? '<img class="marathon-rank-avatar-img" src="' + _esc(url) + '" alt="" referrerpolicy="no-referrer" ' +
             'onerror="this.remove()"/>' : '') +
      _esc(_initial(name)) + '</span>';
  }

  /* Avatar de la cabecera: mismo marcado que la cabecera del perfil (anillo dorado de 72 px) */
  function _headerAvatarHtml(name, url) {
    return '<div class="profile-avatar" aria-hidden="true">' +
      (url ? '<img class="profile-avatar-img" src="' + _esc(url) + '" alt="" referrerpolicy="no-referrer" ' +
             'onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'"/>' : '') +
      '<span class="profile-avatar-initial"' + (url ? ' style="display:none"' : '') + '>' +
        _esc(_initial(name)) + '</span>' +
    '</div>';
  }

  function _fmtDate(dk) {
    try {
      var p = dk.split('-');
      return new Date(+p[0], +p[1] - 1, +p[2]).toLocaleDateString(getLang(), { day: 'numeric', month: 'short', year: 'numeric' });
    } catch (e) { return dk; }
  }

  /* ── Cabecera: mi tarjeta (estilo .profile-card) ── */

  function _renderMe(position, deltaHtml) {
    var box = _el('marathon-rank-me');
    if (!box) return;
    var p  = (typeof PlayerProfile !== 'undefined') ? PlayerProfile.getProfile() : {};
    var st = loadMarathonStatus();
    var name = p.nickname || t('profile_guest');
    var today = isMarathonCompletedToday()
      ? (getMarathonTodayStreak() !== null ? t('marathon_status_done', { n: getMarathonTodayStreak() }) : t('home_daily_done'))
      : t('marathon_rank_available');

    box.innerHTML =
      '<div class="profile-identity">' +
        _headerAvatarHtml(name, p.avatarUrl) +
        '<div class="profile-identity-text">' +
          '<h3 class="profile-nickname">' + _esc(name) + '</h3>' +
          '<p class="profile-meta">' + _esc(today) + '</p>' +
        '</div>' +
      '</div>' +
      '<div class="profile-badges">' +
        '<div class="profile-badge"><span class="profile-badge-val">🔥 ' + st.bestStreak + '</span>' +
          '<span class="profile-badge-label">' + _esc(t('marathon_rank_my_best')) + '</span></div>' +
        '<div class="profile-badge"><span class="profile-badge-val">🏃 ' + st.games + '</span>' +
          '<span class="profile-badge-label">' + _esc(t('stats_games')) + '</span></div>' +
        '<div class="profile-badge"><span class="profile-badge-val">' + (position ? '#' + position : '—') +
          (position && deltaHtml ? ' ' + deltaHtml : '') + '</span>' +
          '<span class="profile-badge-label">' + _esc(t('marathon_rank_position')) + '</span></div>' +
      '</div>';
  }

  /* ── Lista ── */

  function _setNote(text) {
    var note = _el('marathon-rank-note');
    if (!note) return;
    note.textContent = text || '';
    note.hidden = !text;
  }

  /**
   * Indicador de movimiento respecto al último cierre diario:
   * ▲ +3 (verde) · – (sin cambios) · ▼ -2 (rojo) · NUEVO (no estaba en la foto).
   * Sin foto (aún no hubo ningún cierre) no se muestra nada.
   */
  function _deltaHtml(snapshot, playerId, pos) {
    if (!snapshot) return '';
    var prev = snapshot.positions[playerId];
    if (typeof prev !== 'number') {
      return '<span class="marathon-rank-delta marathon-rank-delta--new">' + _esc(t('marathon_delta_new')) + '</span>';
    }
    var d = prev - pos;
    if (d === 0) {
      return '<span class="marathon-rank-delta marathon-rank-delta--same" role="img" aria-label="' +
        _esc(t('marathon_delta_same')) + '">–</span>';
    }
    var up = d > 0;
    return '<span class="marathon-rank-delta marathon-rank-delta--' + (up ? 'up' : 'down') + '" role="img" aria-label="' +
      _esc(t(up ? 'marathon_delta_up' : 'marathon_delta_down', { n: Math.abs(d) })) + '">' +
      '<span class="marathon-rank-delta-arrow" aria-hidden="true">' + (up ? '▲' : '▼') + '</span>' +
      (up ? '+' : '-') + Math.abs(d) + '</span>';
  }

  /**
   * @param {{isMe?:boolean, crown?:boolean, deltaHtml?:string}} [opts]
   */
  function _rowHtml(pos, avatarName, avatarUrl, title, subtitle, valueHtml, opts) {
    var o = opts || {};
    return '<li class="profile-friend card marathon-rank-row' + (o.isMe ? ' marathon-rank-row--me' : '') +
        (o.crown ? ' marathon-rank-row--crown' : '') + (pos <= 3 ? ' marathon-rank-row--top' : '') + '">' +
      '<span class="marathon-rank-pos-col">' +
        '<span class="marathon-rank-pos">' + (pos <= 3 ? ['🥇', '🥈', '🥉'][pos - 1] : pos) + '</span>' +
        (o.deltaHtml || '') +
      '</span>' +
      _avatarHtml(avatarName, avatarUrl) +
      '<span class="profile-friend-info">' +
        '<span class="profile-friend-name">' + _esc(title) + '</span>' +
        (subtitle ? '<span class="profile-friend-code">' + _esc(subtitle) + '</span>' : '') +
      '</span>' +
      '<span class="marathon-rank-streak">' + valueHtml + '</span>' +
    '</li>';
  }

  function _streakHtml(n) { return n + '<small> 🔥</small>'; }

  function _countryLabel(code) { return code ? (_flag(code) + ' ' + _countryName(code)) : ''; }

  function _loadingList() {
    _renderList('<li class="profile-empty"><span class="lb-spinner"></span>' +
      '<p class="profile-empty-text">' + _esc(t('lb_loading')) + '</p></li>');
  }

  function _renderList(html, emptyText) {
    var list = _el('marathon-rank-list');
    if (!list) return;
    list.innerHTML = html || ('<li class="profile-empty"><span class="profile-empty-icon" aria-hidden="true">🏃</span>' +
      '<p class="profile-empty-text">' + _esc(emptyText) + '</p></li>');
  }

  function _renderLocal(note) {
    var p = (typeof PlayerProfile !== 'undefined') ? PlayerProfile.getProfile() : {};
    var name = p.nickname || t('profile_guest');
    var html = getMarathonRuns().map(function (r, i) {
      return _rowHtml(i + 1, name, p.avatarUrl, _fmtDate(r.date),
        t('marathon_rank_run_detail', { c: r.correct }), _streakHtml(r.streak));
    }).join('');
    _setNote(note || '');
    _renderList(html, t('marathon_rank_empty_local'));
    /* Sin red (fallback del Global) no hay posición fiable que mostrar */
    if (note || !_myGlobal) _renderMe(null);
    else _renderMe(_myGlobal.position, _myGlobal.deltaHtml);
  }

  function _renderGlobal() {
    var req = ++_reqId;
    _setNote('');
    _loadingList();
    _renderMe(null);

    /* La foto del cierre es opcional: si falla, el ranking se muestra sin indicadores */
    var snapP = MarathonLeaderboard.getDailySnapshot().catch(function () { return null; });

    MarathonLeaderboard.submitBest().then(function () {
      return Promise.all([MarathonLeaderboard.getTop(TOP_LIMIT), snapP]);
    }).then(function (res) {
      if (req !== _reqId || _tab !== 'global') return;
      var entries = res[0], snapshot = res[1];
      var me = null;
      var html = entries.map(function (e) {
        var delta = _deltaHtml(snapshot, e.playerId, e.position);
        if (e.isMe) me = { position: e.position, deltaHtml: delta };
        return _rowHtml(e.position, e.playerName, e.avatarUrl, e.playerName,
          _countryLabel(e.country), _streakHtml(e.bestStreak), { isMe: e.isMe, deltaHtml: delta });
      }).join('');
      _myGlobal = me;
      _renderList(html, t('marathon_rank_empty'));
      _renderMe(me && me.position, me && me.deltaHtml);
      if (!MarathonLeaderboard.isSignedIn()) _setNote(t('marathon_rank_signin'));
    }).catch(function (err) {
      if (req !== _reqId || _tab !== 'global') return;
      console.warn('[MarathonRankUI] Ranking global no disponible:', err && (err.code || err.message));
      _renderLocal(t('marathon_rank_offline'));
    });
  }

  function _renderTop1() {
    var req = ++_reqId;
    _setNote(t('marathon_top1_hint'));
    _loadingList();
    _renderMe(_myGlobal && _myGlobal.position, _myGlobal && _myGlobal.deltaHtml);

    Promise.all([
      MarathonLeaderboard.getTop1(TOP_LIMIT),
      MarathonLeaderboard.getDailySnapshot().catch(function () { return null; })
    ]).then(function (res) {
      if (req !== _reqId || _tab !== 'top1') return;
      var entries = res[0], snapshot = res[1];
      var holderId = snapshot && snapshot.holderId;
      var html = entries.map(function (e) {
        var crown = !!holderId && e.playerId === holderId;
        var sub;
        if (crown && snapshot.holderSince) {
          sub = t('marathon_top1_since', { d: _fmtDate(snapshot.holderSince) });
        } else {
          sub = _countryLabel(e.country);
          if (e.longestRun > 1) sub += (sub ? ' · ' : '') + t('marathon_top1_longest', { n: e.longestRun });
        }
        return _rowHtml(e.position, e.playerName, e.avatarUrl, e.playerName, sub,
          e.days + '<small> ' + _esc(t(e.days === 1 ? 'marathon_top1_day' : 'marathon_top1_days')) + '</small>',
          { isMe: e.isMe, crown: crown });
      }).join('');
      _renderList(html, t('marathon_top1_empty'));
    }).catch(function (err) {
      if (req !== _reqId || _tab !== 'top1') return;
      console.warn('[MarathonRankUI] Top 1 no disponible:', err && (err.code || err.message));
      _setNote('');
      _renderList('', t('marathon_top1_offline'));
    });
  }

  function _selectTab(tab) {
    _tab = (tab === 'local' || tab === 'top1') ? tab : 'global';
    document.querySelectorAll('#marathon-rank-tabs .profile-tab').forEach(function (b) {
      var on = b.dataset.tab === _tab;
      b.classList.toggle('profile-tab--active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    if (_tab === 'global') _renderGlobal();
    else if (_tab === 'top1') _renderTop1();
    else _renderLocal();
  }

  function _bind() {
    if (_bound) return;
    _bound = true;
    document.querySelectorAll('#marathon-rank-tabs .profile-tab').forEach(function (b) {
      b.addEventListener('click', function () { _selectTab(b.dataset.tab); });
    });
    var back = _el('btn-back-marathon-ranking');
    if (back) back.addEventListener('click', close);
  }

  /**
   * Abre la pantalla de ranking.
   * @param {string} [returnTo='home']  pantalla a la que vuelve el botón atrás
   */
  function open(returnTo) {
    _bind();
    _returnTo = returnTo || 'home';
    showScreen('marathon-ranking');
    _selectTab('global');
  }

  function close() {
    _reqId++;
    showScreen(_returnTo);
  }

  return { open: open, close: close };

})();
