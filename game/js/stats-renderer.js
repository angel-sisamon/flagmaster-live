/**
 * js/stats-renderer.js — Módulo dedicado al renderizado de la pantalla de estadísticas.
 *
 * Expone: StatsRenderer.render()
 *
 * Depende de: storage.js, modes.js (MODE_I18N, getModeDisplayName, getModeVisual),
 *             countries-data.js (COUNTRIES, cn), i18n.js (t()),
 *             utils.js (escHtml)
 */

/* eslint-disable no-unused-vars */

var StatsRenderer = (function () {

  /* ── Punto de entrada principal ──────────────────────────── */

  function render() {
    var wrap = document.getElementById('stats-body');
    if (!wrap) return;

    var data  = loadAchievements();
    var stats = data.stats;
    if (!stats || !stats.total_games) {
      wrap.innerHTML = '<p class="empty-state">' + t('stats_no_data') + '</p>';
      return;
    }

    var frag = document.createDocumentFragment();
    frag.appendChild(_buildSummaryGrid(stats));
    frag.appendChild(_buildModeStats());
    frag.appendChild(_buildMostFailedCountries());

    wrap.innerHTML = '';
    wrap.appendChild(frag);
  }

  /* ── Cuadrícula de resumen (8 stat-cards) ────────────────── */

  function _buildSummaryGrid(stats) {
    var modeCounts = {};
    loadRanking().forEach(function (e) {
      modeCounts[e.mode] = (modeCounts[e.mode] || 0) + 1;
    });
    var favMode = Object.keys(modeCounts).sort(function (a, b) {
      return modeCounts[b] - modeCounts[a];
    })[0];
    var accuracy = stats.total_attempted > 0
      ? Math.min(Math.round((stats.total_correct / stats.total_attempted) * 100), 100)
      : (stats.total_games > 0
          ? Math.min(Math.round((stats.total_correct / Math.max(stats.total_games * 10, 1)) * 100), 100)
          : 0);
    var streak = getDailyStreak();

    function stat(l, v) {
      return '<div class="stat-card card"><span class="stat-val">' + v +
        '</span><span class="stat-label">' + l + '</span></div>';
    }

    var html = '<div class="stats-grid">';
    html += stat(t('stats_games'),        stats.total_games || 0);
    html += stat(t('stats_correct'),      stats.total_correct || 0);
    html += stat(t('stats_accuracy'),     accuracy + '%');
    html += stat(t('stats_best_streak'),  (stats.max_streak_ever || 0) + ' 🔥');
    html += stat(t('stats_fav_mode'),     favMode ? escHtml(getModeDisplayName(favMode)) : '—');
    html += stat(t('stats_daily_streak'), streak > 0 ? streak + ' 🔥' : '—');
    /* Maratón: mismo origen que players/{id}.stats.maratonMejorRacha / maratonPartidas */
    var marathon = loadMarathonStatus();
    html += stat(t('stats_marathon_best'),  marathon.bestStreak > 0 ? marathon.bestStreak + ' 🏃' : '—');
    html += stat(t('stats_marathon_games'), marathon.games);
    html += '</div>';

    var div = document.createElement('div');
    div.innerHTML = html;
    return div.firstChild;
  }

  /* ── Partidas por tipo de juego ──────────────────────────── */

  function _buildModeStats() {
    var section = document.createElement('div');
    section.className = 'stats-wrong-section stats-mode-section';

    var title = document.createElement('p');
    title.className = 'stats-section-title';
    title.textContent = t('stats_games_by_mode_title');
    section.appendChild(title);

    var grid = document.createElement('div');
    grid.className = 'stats-mode-grid';
    var header = document.createElement('div');
    header.className = 'stats-mode-row stats-mode-header-row';
    header.innerHTML =
      '<div class="stats-mode-header" aria-hidden="true"></div>' +
      '<div class="stats-mode-header">' + escHtml(t('stats_mode_games')) + '</div>' +
      '<div class="stats-mode-header">' + escHtml(t('stats_mode_correct')) + '</div>' +
      '<div class="stats-mode-header">' + escHtml(t('stats_mode_wrong')) + '</div>';
    grid.appendChild(header);

    getStatsByMode().forEach(function (entry) {
      if (entry.games === 0 && entry.wrong === 0) return;
      var label = getModeVisual(entry.mode) + ' ' + getModeDisplayName(entry.mode);
      var row = document.createElement('div');
      row.className = 'stats-mode-row';
      row.innerHTML =
        '<span class="stats-mode-name">' + escHtml(label) + '</span>' +
        '<span class="stats-mode-value">' + entry.games + '</span>' +
        '<span class="stats-mode-value">' + entry.correct + '</span>' +
        '<span class="stats-mode-value">' + entry.wrong + '</span>';
      grid.appendChild(row);
    });
    section.appendChild(grid);
    return section;
  }

  /* ── Países más fallados ─────────────────────────────────── */

  function _buildMostFailedCountries() {
    var section = document.createElement('div');
    section.className = 'stats-wrong-section';

    var title = document.createElement('p');
    title.className = 'stats-section-title';
    title.textContent = t('stats_most_failed_title');
    section.appendChild(title);
    section.appendChild(_buildWrongList());
    return section;
  }

  function _buildWrongList() {
    var list = document.createElement('div');
    list.className = 'stats-wrong-list';
    var items = getTopWrongCountriesV2(10).filter(function (item) { return item.count > 0; });

    if (!items.length) {
      var empty = document.createElement('p');
      empty.className = 'empty-state';
      empty.style.padding = '.5rem 0';
      empty.textContent = t('stats_no_data');
      list.appendChild(empty);
      return list;
    }

    var codeToCountry = {};
    if (typeof COUNTRIES !== 'undefined') {
      for (var ci = 0; ci < COUNTRIES.length; ci++) {
        codeToCountry[COUNTRIES[ci].code] = COUNTRIES[ci];
      }
    }

    items.forEach(function (item) {
      var country = codeToCountry[item.code] || null;
      if (!country) return;

      var continent = (typeof getContinentForCountry === 'function')
        ? getContinentForCountry(item.code)
        : null;
      var row = document.createElement('div');
      row.className = 'wrong-country-row';
      row.innerHTML =
        '<span class="wrong-flag">' + escHtml(country.flag || '') + '</span>' +
        '<div class="wrong-country-info">' +
          '<span class="wrong-name">' + escHtml((typeof cn === 'function') ? cn(country) : (country.name || item.code)) + '</span>' +
          (continent ? '<span class="wrong-continent">' + escHtml(t('continent_' + continent)) + '</span>' : '') +
        '</div>' +
        '<span class="wrong-count">×' + item.count + '</span>';
      list.appendChild(row);
    });
    return list;
  }

  return { render: render };

})();
