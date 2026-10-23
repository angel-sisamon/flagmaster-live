/**
 * js/tournaments-ui.js — FlagMaster · UI de Torneos
 *
 * TournamentsUI: IIFE global.
 * Depende de: TournamentService, DuelService, PlayGamesService,
 *             initGame, showScreen, t, getModeVisual, getModeDisplayName,
 *             vibrateDevice (opcional), delay (utils.js)
 */
var TournamentsUI = (function () {
  'use strict';

  /* ── Estado interno ────────────────────────────────────────────── */
  var _pendingTournament = null;   // torneo en curso (para onGameEnd)
  var _activeTab         = 'active'; // 'active' | 'history'
  var _view              = 'list';   // 'list' | 'detail'

  /* ══════════════════════════════════════════════════════════════════
     PUNTO DE ENTRADA PÚBLICO
     ══════════════════════════════════════════════════════════════════ */

  /** Abre la pantalla principal de torneos. */
  function open() {
    showScreen('tournaments');
    _renderTournamentsScreen();
  }

  /* ══════════════════════════════════════════════════════════════════
     TARJETA PARA EL MENÚ PRINCIPAL
     ══════════════════════════════════════════════════════════════════ */

  /**
   * Construye la tarjeta de Torneos para el menú principal.
   * @returns {HTMLElement}
   */
  function renderTournamentsHomeCard() {
    var card = document.createElement('button');
    card.className = 'mode-card mode-card--tournaments';
    card.id        = 'btn-tournaments-entry';
    card.innerHTML =
      '<span class="mode-card-icon">🏆</span>' +
      '<div class="mode-card-text">' +
        '<span class="mode-card-name">' + t('tournament_section_title') + '</span>' +
        '<span class="mode-card-desc">' + t('tournament_card_subtitle') + '</span>' +
      '</div>';
    card.addEventListener('click', function () { open(); });
    return card;
  }

  /* ══════════════════════════════════════════════════════════════════
     PANTALLA PRINCIPAL DE TORNEOS
     ══════════════════════════════════════════════════════════════════ */

  function _renderTournamentsScreen() {
    _view = 'list';

    /* Restaurar título del header global */
    var titleEl = document.querySelector('#screen-tournaments .subscreen-title');
    if (titleEl) titleEl.textContent = t('tournament_section_title');

    /* Mostrar botón de info y enlazar listener (una sola vez por apertura) */
    var infoBtn = document.getElementById('btn-tournaments-info');
    if (infoBtn) {
      infoBtn.style.display = '';
      infoBtn.onclick = _showTournamentsInfoModal;
    }

    var body = document.getElementById('tournaments-body');
    if (!body) return;
    body.innerHTML = '';

    /* Pestañas */
    var tabs = document.createElement('div');
    tabs.className = 'tournament-tabs';
    tabs.innerHTML =
      '<button class="tournament-tab' + (_activeTab === 'active' ? ' tournament-tab--active' : '') +
        '" data-tab="active">' + t('tournament_tab_active') + '</button>' +
      '<button class="tournament-tab' + (_activeTab === 'history' ? ' tournament-tab--active' : '') +
        '" data-tab="history">' + t('tournament_tab_history') + '</button>';

    tabs.querySelectorAll('.tournament-tab').forEach(function (btn) {
      btn.addEventListener('click', function () {
        _activeTab = this.dataset.tab;
        tabs.querySelectorAll('.tournament-tab').forEach(function (b) {
          b.classList.toggle('tournament-tab--active', b.dataset.tab === _activeTab);
        });
        _renderTabContent(body, tabs);
      });
    });

    body.appendChild(tabs);
    _renderTabContent(body, tabs);
  }

  function _renderTabContent(body, tabs) {
    /* Eliminar contenido previo de la pestaña */
    var existing = body.querySelector('.tournament-tab-content');
    if (existing) existing.remove();

    var content = document.createElement('div');
    content.className = 'tournament-tab-content';
    body.appendChild(content);

    if (_activeTab === 'active') {
      _renderActiveTournamentsList(content);
    } else {
      _renderHistoricList(content);
    }
  }

  /* ══════════════════════════════════════════════════════════════════
     PESTAÑA: TORNEOS ACTIVOS
     ══════════════════════════════════════════════════════════════════ */

  function _renderActiveTournamentsList(container) {
    container.innerHTML = '<p class="duels-loading">' + t('lb_loading') + '</p>';

    TournamentService.getOpenTournaments()
      .then(function (tournaments) {
        container.innerHTML = '';

        if (!tournaments || tournaments.length === 0) {
          container.innerHTML = '<p class="duels-empty">' + t('tournament_no_active') + '</p>';
          return;
        }

        /* Para cada torneo, obtener el score del jugador actual */
        var myScorePromises = tournaments.map(function (t) {
          return TournamentService.getMyScore(t.id);
        });

        Promise.all(myScorePromises).then(function (myScores) {
          tournaments.forEach(function (tournament, idx) {
            container.appendChild(_buildActiveTournamentCard(tournament, myScores[idx]));
          });
        });
      })
      .catch(function (err) {
        console.error('[TournamentsUI] getOpenTournaments error:', err);
        container.innerHTML = '<p class="duels-empty" style="color:var(--red)">' + t('lb_error') + '</p>';
      });
  }

  function _buildActiveTournamentCard(tournament, myScore) {
    var card = document.createElement('div');
    card.className = 'tournament-card';

    var timeLeft = TournamentService.formatTimeRemaining(tournament);

    var playedHtml;
    if (myScore) {
      playedHtml =
        '<span class="tournament-card-played">' +
          t('tournament_already_played', { score: myScore.score }) +
        '</span>';
    } else {
      playedHtml =
        '<button class="btn btn-primary tournament-card-play-btn" data-tid="' + tournament.id + '">' +
          t('tournament_play_btn') +
        '</button>';
    }

    card.innerHTML =
      '<div class="tournament-card-header">' +
        '<span class="tournament-card-icon">' + getModeVisual(tournament.mode) + '</span>' +
        '<div class="tournament-card-info">' +
          '<span class="tournament-card-name">' + getModeDisplayName(tournament.mode) + '</span>' +
          '<span class="tournament-card-status tournament-card-status--open">' +
            t('tournament_status_open') +
          '</span>' +
        '</div>' +
        '<span class="tournament-card-time">' + timeLeft + '</span>' +
      '</div>' +
      '<div class="tournament-card-actions">' + playedHtml + '</div>';

    /* Clic en tarjeta → ver ranking detalle */
    card.addEventListener('click', function (e) {
      /* Evitar doble acción si se pulsó el botón Jugar */
      if (e.target.classList.contains('tournament-card-play-btn')) return;
      renderTournamentDetail(tournament, myScore);
    });

    /* Botón Jugar */
    var playBtn = card.querySelector('.tournament-card-play-btn');
    if (playBtn) {
      playBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        _launchTournament(tournament);
      });
    }

    return card;
  }

  /* ══════════════════════════════════════════════════════════════════
     PESTAÑA: HISTÓRICO
     ══════════════════════════════════════════════════════════════════ */

  function _renderHistoricList(container) {
    container.innerHTML = '<p class="duels-loading">' + t('lb_loading') + '</p>';

    var MODES_4 = [
      'guess-country',
      'guess-flag',
      'guess-capital',
      'guess-country-from-capital'
    ];

    /* Cargar torneos cerrados para cada modo en paralelo */
    var promises = MODES_4.map(function (mode) {
      return TournamentService.getClosedTournaments(mode, 5);
    });

    Promise.all(promises).then(function (results) {
      container.innerHTML = '';

      var hasAny = false;

      MODES_4.forEach(function (mode, idx) {
        var items = results[idx];
        if (!items || items.length === 0) return;
        hasAny = true;

        var section = document.createElement('div');
        section.className = 'tournament-history-section';

        var heading = document.createElement('div');
        heading.className = 'tournament-history-heading';
        heading.innerHTML =
          '<span class="tournament-history-icon">' + getModeVisual(mode) + '</span>' +
          '<span class="tournament-history-mode">' + getModeDisplayName(mode) + '</span>';
        section.appendChild(heading);

        items.forEach(function (tournament) {
          section.appendChild(_buildHistoryCard(tournament));
        });

        container.appendChild(section);
      });

      if (!hasAny) {
        container.innerHTML = '<p class="duels-empty">' + t('tournament_no_history') + '</p>';
      }
    }).catch(function (err) {
      console.error('[TournamentsUI] historial error:', err);
      container.innerHTML = '<p class="duels-empty" style="color:var(--red)">' + t('lb_error') + '</p>';
    });
  }

  function _buildHistoryCard(tournament) {
    var card = document.createElement('button');
    card.className = 'tournament-history-card';

    var closedDate = tournament.startDateKey || '';

    card.innerHTML =
      '<span class="tournament-history-date">' + closedDate + '</span>' +
      '<span class="tournament-history-status tournament-card-status--closed">' +
        t('tournament_status_closed') +
      '</span>';

    card.addEventListener('click', function () {
      renderTournamentDetail(tournament, null);
    });

    return card;
  }

  /* ══════════════════════════════════════════════════════════════════
     VISTA DETALLE: RANKING DE UN TORNEO
     ══════════════════════════════════════════════════════════════════ */

  /**
   * Muestra el ranking de un torneo (en vivo si open, final si closed).
   * @param {object} tournament — objeto torneo
   * @param {object|null} myScore — score del jugador actual (puede ser null)
   */
  function renderTournamentDetail(tournament, myScore) {
    _view = 'detail';

    /* Actualizar título del header global al modo del torneo */
    var titleEl = document.querySelector('#screen-tournaments .subscreen-title');
    if (titleEl) {
      titleEl.textContent = getModeVisual(tournament.mode) + ' ' + getModeDisplayName(tournament.mode);
    }

    /* Ocultar botón de info en la vista detalle */
    var infoBtn = document.getElementById('btn-tournaments-info');
    if (infoBtn) infoBtn.style.display = 'none';

    var body = document.getElementById('tournaments-body');
    if (!body) return;
    body.innerHTML = '';

    /* Info de estado (sin cabecera con botón volver propio) */
    var info = document.createElement('div');
    info.className = 'tournament-detail-info';
    if (tournament.status === 'open') {
      info.innerHTML =
        '<span class="tournament-card-status tournament-card-status--open">' + t('tournament_status_open') + '</span>' +
        '<span class="tournament-detail-time">' +
          t('tournament_time_remaining') + ': <strong>' + TournamentService.formatTimeRemaining(tournament) + '</strong>' +
        '</span>';

      /* Botón jugar si no ha jugado */
      if (!myScore) {
        var playBtn = document.createElement('button');
        playBtn.className = 'btn btn-primary tournament-detail-play';
        playBtn.textContent = t('tournament_play_btn');
        playBtn.addEventListener('click', function () { _launchTournament(tournament); });
        info.appendChild(playBtn);
      } else {
        var playedMsg = document.createElement('p');
        playedMsg.className = 'tournament-detail-played';
        playedMsg.textContent = t('tournament_already_played', { score: myScore.score });
        info.appendChild(playedMsg);
      }
    } else {
      info.innerHTML =
        '<span class="tournament-card-status tournament-card-status--closed">' + t('tournament_status_closed') + '</span>' +
        '<p class="tournament-detail-finished-msg">' + t('tournament_finished_msg') + '</p>';
    }
    body.appendChild(info);

    /* Ranking */
    var rankingSection = document.createElement('div');
    rankingSection.className = 'tournament-ranking-section';

    var rankingTitle = document.createElement('p');
    rankingTitle.className = 'tournament-ranking-title';
    rankingTitle.textContent = t('tournament_view_ranking');
    rankingSection.appendChild(rankingTitle);

    var rankingList = document.createElement('div');
    rankingList.className = 'tournament-ranking-list';
    rankingList.innerHTML = '<p class="duels-loading">' + t('lb_loading') + '</p>';
    rankingSection.appendChild(rankingList);

    body.appendChild(rankingSection);

    /* Cargar ranking */
    if (tournament.status === 'closed') {
      var entries = TournamentService.getClosedRanking(tournament);
      _renderRankingList(rankingList, entries);
    } else {
      TournamentService.getLiveRanking(tournament.id, 100)
        .then(function (entries) { _renderRankingList(rankingList, entries); })
        .catch(function () {
          rankingList.innerHTML = '<p class="duels-empty" style="color:var(--red)">' + t('lb_error') + '</p>';
        });
    }
  }

  function _renderRankingList(container, entries) {
    container.innerHTML = '';

    if (!entries || entries.length === 0) {
      container.innerHTML = '<p class="duels-empty">' + t('lb_empty_today') + '</p>';
      return;
    }

    entries.forEach(function (entry) {
      var row = document.createElement('div');
      row.className = 'tournament-ranking-row' + (entry.isMe ? ' tournament-ranking-row--me' : '');

      var flagEmoji = entry.country ? _flagEmojiFromIso2(entry.country) : '';

      row.innerHTML =
        '<span class="tournament-ranking-pos">#' + entry.position + '</span>' +
        '<span class="tournament-ranking-flag">' + flagEmoji + '</span>' +
        '<span class="tournament-ranking-name">' + _escapeHtml(entry.playerName || '?') + '</span>' +
        '<span class="tournament-ranking-score">' + (entry.score || 0) + ' pts</span>';

      container.appendChild(row);
    });
  }

  /* ══════════════════════════════════════════════════════════════════
     LANZAR PARTIDA DE TORNEO
     ══════════════════════════════════════════════════════════════════ */

  function _launchTournament(tournament) {
    /* Requerir PGS */
    if (typeof PlayGamesService === 'undefined' || !PlayGamesService.isSignedIn()) {
      alert(t('tournament_requires_pgs'));
      return;
    }

    var questions = TournamentService.buildTournamentQuestions(tournament);
    if (!questions || !questions.length) {
      console.error('[TournamentsUI] No se pudieron construir preguntas del torneo.');
      return;
    }

    _pendingTournament = tournament;

    /* ★ Registrar intento de torneo para persistencia ante force-close ★ */
    if (typeof TournamentAttempt !== 'undefined') TournamentAttempt.begin(tournament);

    /* Iniciar partida con preguntas pre-construidas y scoring de torneo */
    if (typeof initGame === 'function') {
      initGame(
        tournament.gameConfig.mode,
        tournament.gameConfig.numQuestions,
        questions,
        tournament.gameConfig.continent || 'all',
        { useDailyScoring: true, isTournament: true }
      );
    }

    /* Arrancar el juego */
    if (typeof _startGameFromState === 'function') {
      _startGameFromState();
    } else {
      showScreen('game');
    }
  }

  /**
   * Callback llamado desde main.js cuando termina una partida.
   * Si hay un torneo pendiente, envía la puntuación.
   * @param {{ score, correct, wrong, maxStreak }} result
   */
  function onGameEnd(result) {
    if (!_pendingTournament) return;
    var tournament = _pendingTournament;
    _pendingTournament = null;

    TournamentService.submitScore(tournament, result)
      .then(function (ok) {
        if (ok) console.log('[TournamentsUI] Score de torneo enviado:', result.score);
      })
      .catch(function (err) {
        console.warn('[TournamentsUI] Error enviando score de torneo:', err);
      });
  }

  /* ══════════════════════════════════════════════════════════════════
     MODAL DE INFORMACIÓN DE TORNEOS
     ══════════════════════════════════════════════════════════════════ */

  function _showTournamentsInfoModal() {
    if (typeof showInfoModal === 'function') {
      showInfoModal({
        title: t('tournament_info_title'),
        rows: [
          { icon: '🌍', title: t('tournament_info_what'),     body: t('tournament_info_what_body') },
          { icon: '⏳', title: t('tournament_info_duration'), body: t('tournament_info_duration_body') },
          { icon: '⭐', title: t('tournament_info_score'),    body: t('tournament_info_score_body') },
          { icon: '🥇', title: t('tournament_info_ranking'),  body: t('tournament_info_ranking_body') },
        ],
        closeLabel: t('tournament_info_close'),
      });
    }
  }

  /* ══════════════════════════════════════════════════════════════════
     NAVEGACIÓN CONTEXTUAL (BOTÓN BACK)
     ══════════════════════════════════════════════════════════════════ */

  /**
   * Gestiona el botón Back de forma contextual:
   * en vista detalle vuelve a la lista; en lista vuelve al home.
   */
  function handleBack() {
    if (_view === 'detail') {
      _renderTournamentsScreen();
    } else {
      showScreen('home');
    }
  }

  /* ══════════════════════════════════════════════════════════════════
     UTILIDADES
     ══════════════════════════════════════════════════════════════════ */

  /**
   * Convierte un código ISO-2 a emoji de bandera.
   * Usa Regional Indicator Symbols Unicode.
   * @param {string} iso2  — ej. 'ES'
   * @returns {string}
   */
  function _flagEmojiFromIso2(iso2) {
    if (!iso2 || iso2.length !== 2) return '';
    var a = iso2.toUpperCase().charCodeAt(0) - 0x41 + 0x1F1E6;
    var b = iso2.toUpperCase().charCodeAt(1) - 0x41 + 0x1F1E6;
    return String.fromCodePoint(a) + String.fromCodePoint(b);
  }

  function _escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* ══════════════════════════════════════════════════════════════════
     API PÚBLICA
     ══════════════════════════════════════════════════════════════════ */

  return {
    open:                      open,
    renderTournamentsHomeCard: renderTournamentsHomeCard,
    renderTournamentDetail:    renderTournamentDetail,
    onGameEnd:                 onGameEnd,
    handleBack:                handleBack,
  };

}());
