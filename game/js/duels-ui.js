/**
 * js/duels-ui.js — FlagMaster · UI de Duelos Asíncronos
 *
 * DuelsUI: IIFE global.
 * Depende de: DuelService, PlayGamesService, initGame, launchDuelGame,
 *             showScreen, t, vibrateDevice, delay (utils.js)
 */
var DuelsUI = (function () {
  'use strict';

  /* ── Estado interno ────────────────────────────────────────── */
  var _pendingDuel   = null;   // Duelo en curso (para onGameEnd)
  var _pendingRole   = null;   // 'A' | 'B'
  var _pendingSeed   = null;
  var _pendingConfig = null;
  var _isDuelGame    = false;  // flag para suprimir modal de nombre
  var _cachedDuels   = [];     // array completo de duelos en memoria
  var _activeTab     = 'active';   // 'active' | 'completed'
  var _sortActive    = 'desc';     // orden del tab activos
  var _sortCompleted = 'desc';     // orden del tab completados

  /* ══════════════════════════════════════════════════════════════
     PUNTO DE ENTRADA PÚBLICO
     ══════════════════════════════════════════════════════════════ */

  /** Abre la pantalla principal de duelos. */
  function open() {
    if (!_assertPGS()) return;
    showScreen('duels');

    /* Enlazar el botón de info */
    var infoBtn = document.getElementById('btn-duels-info');
    if (infoBtn) infoBtn.onclick = _showDuelsInfoModal;

    _loadMyDuels();
  }

  /* ══════════════════════════════════════════════════════════════
     CARGA DE MIS DUELOS
     ══════════════════════════════════════════════════════════════ */

  function _loadMyDuels() {
    var body = document.getElementById('duels-body');
    if (!body) return;
    body.innerHTML = '<p class="duels-loading">' + t('duel_loading') + '</p>';

    DuelService.getMyDuels()
      .then(function (duels) {
        _renderDuelsBody(body, duels);
      })
      .catch(function (err) {
        console.error('[DuelsUI] getMyDuels error:', err);
        _renderDuelsBody(body, []);
        var errNote = document.createElement('p');
        errNote.className = 'duels-empty';
        errNote.style.color = 'var(--red)';
        errNote.textContent = t('duel_error');
        body.appendChild(errNote);
      });
  }

  function _renderDuelsBody(body, duels) {
    body.innerHTML = '';

    /* Botones de acción */
    var actions = document.createElement('div');
    actions.className = 'duels-actions';
    actions.innerHTML =
      '<button class="btn btn-primary" id="btn-duel-new">⚔️ ' + t('duel_new') + '</button>' +
      '<button class="btn btn-ghost"   id="btn-duel-join">🔗 ' + t('duel_join') + '</button>';
    body.appendChild(actions);
    actions.querySelector('#btn-duel-new').addEventListener('click', _showConfigModal);
    actions.querySelector('#btn-duel-join').addEventListener('click', _showJoinModal);

    /* Guardar duelos en caché */
    _cachedDuels = duels || [];

    /* Separar en activos / completados */
    var activeDuels    = _filterDuelsByTab(_cachedDuels, 'active');
    var completedDuels = _filterDuelsByTab(_cachedDuels, 'completed');

    /* Barra de pestañas */
    var tabs = document.createElement('div');
    tabs.className = 'duels-tabs';
    tabs.id = 'duels-tabs-bar';

    var tabActive = document.createElement('button');
    tabActive.className = 'duels-tab' + (_activeTab === 'active' ? ' duels-tab--active' : '');
    tabActive.textContent = t('duel_tab_active') + ' (' + activeDuels.length + ')';
    tabActive.addEventListener('click', function () {
      _activeTab = 'active';
      _renderTabContent(body);
    });
    tabs.appendChild(tabActive);

    var tabCompleted = document.createElement('button');
    tabCompleted.className = 'duels-tab' + (_activeTab === 'completed' ? ' duels-tab--active' : '');
    tabCompleted.textContent = t('duel_tab_completed') + ' (' + completedDuels.length + ')';
    tabCompleted.addEventListener('click', function () {
      _activeTab = 'completed';
      _renderTabContent(body);
    });
    tabs.appendChild(tabCompleted);

    /* Botón de ordenación */
    var sortBtn = document.createElement('button');
    sortBtn.className = 'duels-sort-btn';
    sortBtn.id = 'duels-sort-btn';
    sortBtn.title = (_activeTab === 'active' ? _sortActive : _sortCompleted) === 'desc'
      ? t('duel_sort_desc') : t('duel_sort_asc');
    sortBtn.textContent = '↑↓';
    sortBtn.addEventListener('click', function () {
      if (_activeTab === 'active') {
        _sortActive = _sortActive === 'desc' ? 'asc' : 'desc';
      } else {
        _sortCompleted = _sortCompleted === 'desc' ? 'asc' : 'desc';
      }
      _renderTabContent(body);
    });

    body.appendChild(tabs);

    /* Fila de ordenación (entre tabs y lista) */
    var sortRow = document.createElement('div');
    sortRow.className = 'duels-sort-row';
    sortRow.appendChild(sortBtn);
    body.appendChild(sortRow);

    /* Contenedor de tarjetas */
    var listContainer = document.createElement('div');
    listContainer.id = 'duels-list-container';
    body.appendChild(listContainer);

    _renderTabContent(body);
  }

  /* Renderiza solo la lista de tarjetas según la tab activa */
  function _renderTabContent(body) {
    /* Actualizar estilos de tabs */
    var tabsBar = body.querySelector('#duels-tabs-bar');
    if (tabsBar) {
      var tabBtns = tabsBar.querySelectorAll('.duels-tab');
      tabBtns[0].className = 'duels-tab' + (_activeTab === 'active' ? ' duels-tab--active' : '');
      tabBtns[1].className = 'duels-tab' + (_activeTab === 'completed' ? ' duels-tab--active' : '');
    }

    /* Actualizar tooltip del botón de ordenación */
    var sortBtn = body.querySelector('#duels-sort-btn');
    if (sortBtn) {
      var currentSort = _activeTab === 'active' ? _sortActive : _sortCompleted;
      sortBtn.title = currentSort === 'desc' ? t('duel_sort_desc') : t('duel_sort_asc');
    }

    var container = body.querySelector('#duels-list-container');
    if (!container) return;
    container.innerHTML = '';

    var duels = _filterDuelsByTab(_cachedDuels, _activeTab);

    var order = _activeTab === 'active' ? _sortActive : _sortCompleted;
    duels = _sortDuels(duels, order);

    if (duels.length === 0) {
      var empty = document.createElement('p');
      empty.className = 'duels-empty';
      empty.textContent = t('duel_empty');
      container.appendChild(empty);
      return;
    }

    duels.forEach(function (duel) {
      container.appendChild(_buildDuelCard(duel));
    });
  }

  /* Extrae el timestamp en ms de un campo createdAt (Firestore Timestamp, número o string ISO) */
  function _getTimestamp(createdAt) {
    if (createdAt == null) return 0;
    /* Firestore Timestamp object */
    if (typeof createdAt.toMillis === 'function') return createdAt.toMillis();
    /* Firestore Timestamp con seconds/nanoseconds */
    if (typeof createdAt.seconds === 'number') return createdAt.seconds * 1000;
    /* Número (ms o s epoch) */
    if (typeof createdAt === 'number') {
      /* Si el valor parece un timestamp en segundos (Unix epoch en s es ~10^9, en ms ~10^12) conviértelo a ms */
      return createdAt < 1e12 ? createdAt * 1000 : createdAt;
    }
    /* String ISO u otro formato parseable */
    var ms = Date.parse(createdAt);
    return isNaN(ms) ? 0 : ms;
  }

  /* Filtra el array de duelos según la tab indicada */
  function _filterDuelsByTab(duels, tab) {
    return duels.filter(function (d) {
      if (tab === 'active') return d.status === 'waiting';
      return d.status === 'completed' || d.status === 'expired';
    });
  }

  /* Ordena un array de duelos por createdAt */
  function _sortDuels(duels, order) {
    var sorted = duels.slice();
    sorted.sort(function (a, b) {
      var tsA = _getTimestamp(a.createdAt);
      var tsB = _getTimestamp(b.createdAt);
      return order === 'asc' ? tsA - tsB : tsB - tsA;
    });
    return sorted;
  }

  /* ══════════════════════════════════════════════════════════════
     TARJETA DE DUELO
     ══════════════════════════════════════════════════════════════ */

  function _buildDuelCard(duel) {
    var player  = PlayGamesService.getPlayerInfo();
    var myId    = player ? player.playerId : '';
    var isA     = duel.playerA && duel.playerA.id === myId;

    var nameA = duel.playerA ? duel.playerA.name : '?';
    var nameB = duel.playerB ? duel.playerB.name : '?';
    var statusKey = 'duel_status_' + (duel.status || 'waiting');

    var card = document.createElement('div');
    card.className = 'duel-card duel-card--' + (duel.status || 'waiting');

    /* Cabecera */
    var header = document.createElement('div');
    header.className = 'duel-card-header';
    header.innerHTML =
      '<span class="duel-card-players">' +
        nameA + '<span class="vs"> vs </span>' + (duel.playerB ? nameB : '…') +
      '</span>' +
      '<span class="duel-card-status duel-card-status--' + (duel.status || 'waiting') + '">' +
        t(statusKey) +
      '</span>';
    card.appendChild(header);

    /* Meta */
    var cfg  = duel.gameConfig || {};
    var meta = document.createElement('div');
    meta.className = 'duel-card-meta';
    meta.innerHTML =
      '<span>' + t('duel_card_mode') + ': ' + _modeName(cfg.mode) + '</span>' +
      '<span>' + t('duel_card_questions') + ': ' + (cfg.numQuestions || '?') + '</span>';
    card.appendChild(meta);

    /* Scores (solo si completed o si soy A) */
    if (duel.status === 'completed' && duel.playerA && duel.playerB) {
      var aScore = duel.playerA.score;
      var bScore = duel.playerB.score;
      var aWins  = aScore > bScore;
      var bWins  = bScore > aScore;
      var scores = document.createElement('div');
      scores.className = 'duel-card-scores';
      scores.innerHTML =
        '<div class="duel-score-pill ' + (isA ? (aWins ? 'duel-score-pill--winner' : 'duel-score-pill--loser') : '') + '">' +
          '<span>' + nameA + '</span><strong>' + aScore + '</strong>' +
        '</div>' +
        '<span class="duel-score-vs">' + t('duel_card_vs') + '</span>' +
        '<div class="duel-score-pill ' + (!isA ? (bWins ? 'duel-score-pill--winner' : 'duel-score-pill--loser') : '') + '">' +
          '<span>' + nameB + '</span><strong>' + bScore + '</strong>' +
        '</div>';
      card.appendChild(scores);
    } else if (duel.status === 'waiting' && isA) {
      var scoreA = document.createElement('div');
      scoreA.className = 'duel-card-scores';
      scoreA.innerHTML =
        '<div class="duel-score-pill">' +
          '<span>' + nameA + '</span><strong>' + duel.playerA.score + '</strong>' +
        '</div>' +
        '<span class="duel-score-vs">vs</span>' +
        '<div class="duel-score-pill duel-score-pill--hidden">' +
          '<span>…</span><strong>' + t('duel_card_score_hidden') + '</strong>' +
        '</div>';
      card.appendChild(scoreA);
    }

    /* Expiración */
    if (duel.expiresAt && duel.status === 'waiting') {
      var expDiv = document.createElement('div');
      expDiv.className = 'duel-card-expires';
      var expDate = duel.expiresAt.toDate ? duel.expiresAt.toDate() : new Date(duel.expiresAt);
      expDiv.textContent = t('duel_card_expires') + ': ' + expDate.toLocaleDateString();
      card.appendChild(expDiv);
    }

    /* Botones de acción */
    var btnRow = document.createElement('div');
    btnRow.className = 'duel-card-actions';

    if (duel.status === 'waiting' && !isA) {
      /* B puede jugar */
      var btnPlay = document.createElement('button');
      btnPlay.className = 'btn btn-primary';
      btnPlay.textContent = '▶ ' + t('duel_btn_play');
      btnPlay.addEventListener('click', function () { _confirmJoinAndPlay(duel); });
      btnRow.appendChild(btnPlay);
    }

    if (duel.status === 'waiting' && isA) {
      /* A puede compartir */
      var btnShare = document.createElement('button');
      btnShare.className = 'btn btn-ghost';
      btnShare.textContent = '📤 ' + t('duel_btn_share');
      btnShare.addEventListener('click', function () { _showShareModal(duel.shareCode); });
      btnRow.appendChild(btnShare);
    }

    if (duel.status === 'completed') {
      /* Ver resultado */
      var btnResult = document.createElement('button');
      btnResult.className = 'btn btn-ghost';
      btnResult.textContent = '📊 ' + t('duel_result_title');
      btnResult.addEventListener('click', function () { _showResultModal(duel); });
      btnRow.appendChild(btnResult);
    }

    if (btnRow.children.length) card.appendChild(btnRow);
    return card;
  }

  /* ══════════════════════════════════════════════════════════════
     MODAL: CONFIGURAR NUEVO DUELO
     ══════════════════════════════════════════════════════════════ */

  function _showConfigModal() {
    var modes = [
      { id:'guess-country',              label:'🌍 ' + t('mode_guess_country') },
      { id:'guess-flag',                 label:'🚩 ' + t('mode_guess_flag') },
      { id:'guess-capital',              label:'🏛️ ' + t('mode_guess_capital') },
      { id:'guess-country-from-capital', label:'📍 ' + t('mode_guess_capital_from') }
    ];
    var continents = [
      { id:'all', label: t('continent_all') },
      { id:'eu',  label: t('continent_eu') },
      { id:'am',  label: t('continent_am') },
      { id:'as',  label: t('continent_as') },
      { id:'af',  label: t('continent_af') },
      { id:'oc',  label: t('continent_oc') }
    ];

    var overlay = _createOverlay();
    var panel   = document.createElement('div');
    panel.className = 'duel-modal-panel';

    panel.innerHTML =
      '<h3 class="duel-modal-title">⚔️ ' + t('duel_config_title') + '</h3>' +

      '<div class="duel-field">' +
        '<label>' + t('duel_config_mode') + '</label>' +
        '<div class="duel-chips" id="duel-mode-chips">' +
          modes.map(function (m) {
            return '<button class="duel-chip' + (m.id === 'guess-country' ? ' active' : '') +
              '" data-mode="' + m.id + '">' + m.label + '</button>';
          }).join('') +
        '</div>' +
      '</div>' +

      '<div class="duel-field">' +
        '<label>' + t('duel_config_questions') + '</label>' +
        '<input type="number" id="duel-num-q" min="5" max="30" value="10" inputmode="numeric"/>' +
      '</div>' +

      '<div class="duel-field">' +
        '<label>' + t('duel_config_continent') + '</label>' +
        '<select id="duel-continent">' +
          continents.map(function (c) {
            return '<option value="' + c.id + '">' + c.label + '</option>';
          }).join('') +
        '</select>' +
      '</div>' +

      '<div class="duel-modal-footer">' +
        '<button class="btn btn-ghost"   id="duel-cfg-cancel">' + t('duel_btn_cancel') + '</button>' +
        '<button class="btn btn-primary" id="duel-cfg-play">▶ ' + t('duel_config_play') + '</button>' +
      '</div>';

    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    /* Chips de modo */
    var chipsWrap = panel.querySelector('#duel-mode-chips');
    chipsWrap.addEventListener('click', function (e) {
      var chip = e.target.closest('.duel-chip');
      if (!chip) return;
      chipsWrap.querySelectorAll('.duel-chip').forEach(function (c) {
        c.classList.toggle('active', c === chip);
      });
    });

    panel.querySelector('#duel-cfg-cancel').addEventListener('click', function () {
      _removeOverlay(overlay);
    });

    panel.querySelector('#duel-cfg-play').addEventListener('click', function () {
      var activeChip = chipsWrap.querySelector('.duel-chip.active');
      var mode       = activeChip ? activeChip.dataset.mode : 'guess-country';
      var numQ       = parseInt(panel.querySelector('#duel-num-q').value, 10) || 10;
      numQ = Math.min(30, Math.max(5, numQ));
      var continent  = panel.querySelector('#duel-continent').value;

      var config = { mode: mode, numQuestions: numQ, continent: continent };
      var seed   = DuelService.generateDuelSeed();

      _removeOverlay(overlay);
      _launchDuelAsA(config, seed);
    });
  }

  /* ══════════════════════════════════════════════════════════════
     JUGAR COMO PLAYER A
     ══════════════════════════════════════════════════════════════ */

  function _launchDuelAsA(config, seed) {
    _isDuelGame    = true;
    _pendingRole   = 'A';
    _pendingConfig = config;
    _pendingSeed   = seed;
    _pendingDuel   = null;

    var questions = DuelService.buildDuelQuestions(seed, config);
    initGame(config.mode, config.numQuestions, questions, config.continent);
    launchDuelGame();
  }

  /* ══════════════════════════════════════════════════════════════
     MODAL: UNIRSE A DUELO
     ══════════════════════════════════════════════════════════════ */

  function _showJoinModal() {
    var overlay = _createOverlay(true);
    var panel   = document.createElement('div');
    panel.className = 'duel-modal-panel';

    panel.innerHTML =
      '<h3 class="duel-modal-title">🔗 ' + t('duel_join_title') + '</h3>' +
      '<div class="duel-field">' +
        '<input type="text" class="duel-join-input" id="duel-join-code" ' +
          'maxlength="6" placeholder="' + t('duel_join_placeholder') + '" ' +
          'autocomplete="off" spellcheck="false"/>' +
      '</div>' +
      '<p class="duel-join-error" id="duel-join-error"></p>' +
      '<div class="duel-modal-footer">' +
        '<button class="btn btn-ghost"   id="duel-join-cancel">' + t('duel_btn_cancel') + '</button>' +
        '<button class="btn btn-primary" id="duel-join-btn">' + t('duel_join_btn') + '</button>' +
      '</div>';

    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    panel.querySelector('#duel-join-cancel').addEventListener('click', function () {
      _removeOverlay(overlay);
    });

    panel.querySelector('#duel-join-btn').addEventListener('click', function () {
      var code = (panel.querySelector('#duel-join-code').value || '').toUpperCase().trim();
      if (!code) return;
      _handleJoinByCode(code, panel, overlay);
    });
  }

  function _handleJoinByCode(code, panel, overlay) {
    var player = PlayGamesService.getPlayerInfo();
    var myId   = player ? player.playerId : '';
    var errEl  = panel.querySelector('#duel-join-error');
    errEl.textContent = t('duel_loading');

    DuelService.getDuelByCode(code, myId)
      .then(function (duel) {
        errEl.textContent = '';
        if (!duel) {
          errEl.textContent = t('duel_join_not_found');
          return;
        }
        if (duel.playerA && duel.playerA.id === myId) {
          errEl.textContent = t('duel_join_own');
          return;
        }
        if (duel.status === 'completed') {
          errEl.textContent = t('duel_join_completed');
          return;
        }
        if (duel.status === 'expired') {
          errEl.textContent = t('duel_join_expired');
          return;
        }
        if (duel.expiresAt) {
          var expDate = duel.expiresAt.toDate ? duel.expiresAt.toDate() : new Date(duel.expiresAt);
          if (expDate < new Date()) {
            errEl.textContent = t('duel_join_expired');
            return;
          }
        }
        /* Todo OK: mostrar ficha y ofrecer jugar */
        _removeOverlay(overlay);
        _showJoinConfirmModal(duel, myId);
      })
      .catch(function (err) {
        console.error('[DuelsUI] join error:', err);
        errEl.textContent = t('duel_error');
      });
  }

  /* ── Ficha de confirmación antes de jugar como B ── */
  function _showJoinConfirmModal(duel, myId) {
    var cfg     = duel.gameConfig || {};
    var overlay = _createOverlay(true);
    var panel   = document.createElement('div');
    panel.className = 'duel-modal-panel';

    var nameA   = duel.playerA ? duel.playerA.name : '?';
    var pgsInfo = PlayGamesService.getPlayerInfo();
    var myName  = (pgsInfo && pgsInfo.displayName) ? pgsInfo.displayName : t('profile_guest');

    panel.innerHTML =
      '<h3 class="duel-modal-title">⚔️ ' + nameA + ' ' + t('duel_card_vs') + ' ' + myName + '</h3>' +
      '<div class="duel-detail-code">' + duel.shareCode + '</div>' +
      '<div class="duel-detail-meta">' +
        '<span>' + t('duel_card_mode') + ': ' + _modeName(cfg.mode) + '</span>' +
        '<span>' + t('duel_card_questions') + ': ' + (cfg.numQuestions || '?') + '</span>' +
      '</div>' +
      '<div class="duel-modal-footer">' +
        '<button class="btn btn-ghost"   id="duel-jc-cancel">' + t('duel_btn_cancel') + '</button>' +
        '<button class="btn btn-primary" id="duel-jc-play">▶ ' + t('duel_btn_join_confirm') + '</button>' +
      '</div>';

    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    panel.querySelector('#duel-jc-cancel').addEventListener('click', function () {
      _removeOverlay(overlay);
    });

    panel.querySelector('#duel-jc-play').addEventListener('click', function () {
      _removeOverlay(overlay);
      _launchDuelAsB(duel);
    });
  }

  /* ── Confirmación al hacer click en "Jugar" de una tarjeta de duelo B ── */
  function _confirmJoinAndPlay(duel) {
    var player = PlayGamesService.getPlayerInfo();
    var myId   = player ? player.playerId : '';
    _showJoinConfirmModal(duel, myId);
  }

  /* ══════════════════════════════════════════════════════════════
     JUGAR COMO PLAYER B
     ══════════════════════════════════════════════════════════════ */

  function _launchDuelAsB(duel) {
    _isDuelGame    = true;
    _pendingRole   = 'B';
    _pendingDuel   = duel;
    _pendingConfig = duel.gameConfig;
    _pendingSeed   = duel.seed;

    var questions = DuelService.buildDuelQuestions(duel.seed, duel.gameConfig);
    initGame(duel.gameConfig.mode, duel.gameConfig.numQuestions, questions, duel.gameConfig.continent);
    launchDuelGame();
  }

  /* ══════════════════════════════════════════════════════════════
     CALLBACK AL TERMINAR PARTIDA  (llamado desde main.js)
     ══════════════════════════════════════════════════════════════ */

  /**
   * onGameEnd(result) — llamado desde main.js después de showScreen('results').
   * @param {{ score, correct, wrong, maxStreak }} result
   */
  function onGameEnd(result) {
    if (!_pendingRole) return;

    var player = PlayGamesService.getPlayerInfo();
    if (!player || !player.playerId) {
      _pendingRole = null;
      return;
    }

    var playerResult = {
      id:        player.playerId,
      name:      player.displayName || player.playerId,
      score:     result.score,
      correct:   result.correct,
      wrong:     result.wrong,
      maxStreak: result.maxStreak
    };

    if (_pendingRole === 'A') {
      _handleEndAsA(playerResult);
    } else if (_pendingRole === 'B') {
      _handleEndAsB(playerResult);
    }
  }

  function _handleEndAsA(playerResult) {
    var config = _pendingConfig;
    var seed   = _pendingSeed;
    _pendingRole = null; _pendingConfig = null; _pendingSeed = null; _pendingDuel = null;

    DuelService.createDuel(config, seed, playerResult)
      .then(function (duel) {
        _isDuelGame = false;
        _showCreatedModal(duel);
      })
      .catch(function (err) {
        console.error('[DuelsUI] createDuel error:', err);
        _isDuelGame = false;
        _showErrorToast(t('duel_err_generic'));
      });
  }

  function _handleEndAsB(playerResult) {
    var duel = _pendingDuel;
    _pendingRole = null; _pendingConfig = null; _pendingSeed = null; _pendingDuel = null;

    DuelService.resolveAsDuelB(duel.shareCode, playerResult)
      .then(function (resolvedDuel) {
        DuelService.cancelReminders(duel.shareCode);
        _isDuelGame = false;
        _showResultModal(resolvedDuel);
      })
      .catch(function (err) {
        console.error('[DuelsUI] resolveAsDuelB error:', err);
        _isDuelGame = false;
        _showErrorToast(t('duel_err_generic'));
      });
  }

  /* ══════════════════════════════════════════════════════════════
     MODAL: DUELO CREADO (código para compartir)
     ══════════════════════════════════════════════════════════════ */

  function _showCreatedModal(duel) {
    var overlay = _createOverlay(true);
    var panel   = document.createElement('div');
    panel.className = 'duel-modal-panel';

    panel.innerHTML =
      '<h3 class="duel-modal-title">🎉 ' + t('duel_created_title') + '</h3>' +
      '<p style="text-align:center;color:var(--text-2);font-size:.88rem;margin:.25rem 0 .5rem">' +
        t('duel_created_body') +
      '</p>';

    /* Bloque de código con botón copiar */
    var codeRow = _buildShareCodeRow(duel.shareCode);
    panel.appendChild(codeRow);

    var footer = document.createElement('div');
    footer.className = 'duel-modal-footer';
    footer.innerHTML =
      '<button class="btn btn-ghost"   id="duel-cr-later">' + t('duel_btn_new_game') + '</button>' +
      '<button class="btn btn-primary" id="duel-cr-share">📤 WhatsApp</button>';
    panel.appendChild(footer);

    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    panel.querySelector('#duel-cr-later').addEventListener('click', function () {
      _removeOverlay(overlay);
      open();
    });

    panel.querySelector('#duel-cr-share').addEventListener('click', function () {
      var url = DuelService.buildWhatsAppShare(duel.shareCode);
      window.open(url, '_blank');
    });
  }

  /* ══════════════════════════════════════════════════════════════
     MODAL: COMPARTIR CÓDIGO (desde tarjeta de duelo activo)
     ══════════════════════════════════════════════════════════════ */

  function _showShareModal(shareCode) {
    var overlay = _createOverlay(true);
    var panel   = document.createElement('div');
    panel.className = 'duel-modal-panel';

    panel.innerHTML =
      '<h3 class="duel-modal-title">📤 ' + t('duel_share_title') + '</h3>';

    /* Bloque de código con botón copiar */
    var codeRow = _buildShareCodeRow(shareCode);
    panel.appendChild(codeRow);

    var footer = document.createElement('div');
    footer.className = 'duel-modal-footer';
    footer.style.flexDirection = 'column';
    footer.innerHTML =
      '<button class="btn btn-primary" id="duel-sh-whatsapp">📤 ' + t('share_duel_dialog') + '</button>' +
      '<button class="btn btn-ghost"   id="duel-sh-close">' + t('duel_btn_cancel') + '</button>';
    panel.appendChild(footer);

    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    panel.querySelector('#duel-sh-whatsapp').addEventListener('click', function () {
      var url = DuelService.buildWhatsAppShare(shareCode);
      window.open(url, '_blank');
    });

    panel.querySelector('#duel-sh-close').addEventListener('click', function () {
      _removeOverlay(overlay);
    });
  }

  /* Construye la fila de código con botón copiar (reutilizable) */
  function _buildShareCodeRow(shareCode) {
    var row = document.createElement('div');
    row.className = 'duel-share-code-row';

    var codeSpan = document.createElement('span');
    codeSpan.className = 'code-big';
    codeSpan.textContent = shareCode;
    row.appendChild(codeSpan);

    var copyBtn = document.createElement('button');
    copyBtn.className = 'duel-copy-btn';
    copyBtn.textContent = '📋';
    copyBtn.addEventListener('click', function () {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(shareCode)
          .then(function () { _showCopyToast(t('duel_code_copied')); })
          .catch(function () { _showErrorToast(t('duel_err_generic')); });
      } else {
        /* Fallback para WebViews sin clipboard API (execCommand está obsoleto pero funciona en entornos legacy) */
        try {
          var ta = document.createElement('textarea');
          ta.value = shareCode; ta.style.position = 'fixed'; ta.style.opacity = '0';
          document.body.appendChild(ta); ta.select();
          document.execCommand('copy');
          document.body.removeChild(ta);
          _showCopyToast(t('duel_code_copied'));
        } catch (e) {
          _showErrorToast(t('duel_err_generic'));
        }
      }
    });
    row.appendChild(copyBtn);

    return row;
  }

  /* ══════════════════════════════════════════════════════════════
     MODAL: RESULTADO HEAD-TO-HEAD
     ══════════════════════════════════════════════════════════════ */

  function _showResultModal(duel) {
    var player = PlayGamesService.getPlayerInfo();
    var myId   = player ? player.playerId : '';
    var isA    = duel.playerA && duel.playerA.id === myId;

    var aData = duel.playerA || { name: '?', score: 0 };
    var bData = duel.playerB || { name: '?', score: 0 };

    var aWins  = aData.score > bData.score;
    var bWins  = bData.score > aData.score;
    var isDraw = !aWins && !bWins;

    var myData    = isA ? aData : bData;
    var theirData = isA ? bData : aData;
    var iWin      = isA ? aWins : bWins;
    var outcomeKey = isDraw ? 'duel_result_draw' : (iWin ? 'duel_result_win' : 'duel_result_lose');

    var overlay = _createOverlay(true);
    var panel   = document.createElement('div');
    panel.className = 'duel-modal-panel';

    panel.innerHTML =
      '<h3 class="duel-modal-title">⚔️ ' + t('duel_result_title') + '</h3>' +
      '<div class="duel-result-grid">' +
        '<div class="duel-result-player ' + (aWins ? 'duel-result-player--winner' : (bWins ? 'duel-result-player--loser' : '')) + '">' +
          '<div class="duel-result-player-name">' + aData.name + '</div>' +
          '<div class="duel-result-player-score">' + aData.score + '</div>' +
          '<div class="duel-result-player-stats">' +
            '✓' + (aData.correct || 0) + '  🔥' + (aData.maxStreak || 0) +
          '</div>' +
        '</div>' +
        '<div class="duel-result-player ' + (bWins ? 'duel-result-player--winner' : (aWins ? 'duel-result-player--loser' : '')) + '">' +
          '<div class="duel-result-player-name">' + bData.name + '</div>' +
          '<div class="duel-result-player-score">' + bData.score + '</div>' +
          '<div class="duel-result-player-stats">' +
            '✓' + (bData.correct || 0) + '  🔥' + (bData.maxStreak || 0) +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="duel-result-outcome">' + t(outcomeKey) + '</div>' +
      '<div class="duel-modal-footer">' +
        '<button class="btn btn-primary" id="duel-res-close">' + t('duel_btn_new_game') + '</button>' +
      '</div>';

    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    panel.querySelector('#duel-res-close').addEventListener('click', function () {
      _removeOverlay(overlay);
      open();
    });
  }

  /* ══════════════════════════════════════════════════════════════
     COMPARTIR CÓDIGO
     ══════════════════════════════════════════════════════════════ */

  function _shareCode(shareCode) {
    /* URL del duelo: ver ShareLinks.getShareUrl (hoy = URL de la store;
       en el futuro = Universal/App Link a /duel/{code}). */
    var shareUrl = (window.ShareLinks && typeof window.ShareLinks.getShareUrl === 'function')
      ? window.ShareLinks.getShareUrl({ type: 'duel', code: shareCode })
      : 'https://play.google.com/store/apps/details?id=com.sisapicasso.flagmaster';
    var text = t('share_duel_text', { code: shareCode }) + '\n' + shareUrl;
    var title = t('share_duel_dialog');

    /* 1. Capacitor Share plugin — nativo Android/iOS */
    if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Share) {
      window.Capacitor.Plugins.Share.share({
        title: title,
        text:  text,
        dialogTitle: title
      }).catch(function () {});
      return;
    }

    /* 2. Fallback — copiar al portapapeles + toast */
    var toastMsg = t('share_duel_copied');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { _showCopyToast(toastMsg); }).catch(function () {});
    } else {
      /* último fallback: execCommand para WebViews antiguos */
      try {
        var ta = document.createElement('textarea');
        ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        _showCopyToast(toastMsg);
      } catch (e) {}
    }
  }

  /* ══════════════════════════════════════════════════════════════
     HELPERS PRIVADOS
     ══════════════════════════════════════════════════════════════ */

  function _assertPGS() {
    if (!PlayGamesService.isSignedIn()) {
      alert(t('duel_err_pgs_required'));
      return false;
    }
    return true;
  }

  function _modeName(mode) {
    return getModeDisplayName(mode);
  }

  function _createOverlay(center) {
    var overlay = document.createElement('div');
    overlay.className = 'duel-modal-overlay' + (center ? ' duel-modal-overlay--center' : '');
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) _removeOverlay(overlay);
    });
    return overlay;
  }

  function _removeOverlay(overlay) {
    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
  }

  function _showErrorToast(msg) {
    var toast = document.createElement('div');
    toast.style.cssText =
      'position:fixed;bottom:calc(2rem + var(--sab,0px));left:50%;transform:translateX(-50%);' +
      'background:var(--red-bg);color:var(--red);border:1px solid var(--red);' +
      'border-radius:var(--r-sm);padding:.6rem 1.25rem;z-index:9999;font-size:.88rem;' +
      'font-family:var(--font);pointer-events:none;';
    toast.textContent = msg;
    document.body.appendChild(toast);
    delay(3000).then(function () {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    });
  }

  /* ══════════════════════════════════════════════════════════════
     MODAL DE INFORMACIÓN DE DUELOS
     ══════════════════════════════════════════════════════════════ */

  function _showDuelsInfoModal() {
    if (typeof showInfoModal === 'function') {
      showInfoModal({
        title: t('duel_info_title'),
        rows: [
          { icon: '🎮', title: t('duel_info_what'),    body: t('duel_info_what_body') },
          { icon: '🔗', title: t('duel_info_how'),     body: t('duel_info_how_body') },
          { icon: '🏆', title: t('duel_info_results'), body: t('duel_info_results_body') },
        ],
        closeLabel: t('duel_info_close'),
      });
    }
  }

  /* ══════════════════════════════════════════════════════════════
     EXPOSICIÓN PÚBLICA
     ══════════════════════════════════════════════════════════════ */

  return {
    open:       open,
    onGameEnd:  onGameEnd,
    isDuelGame: function () { return _isDuelGame; }
  };
}());
