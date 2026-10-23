/**
 * js/marathon.js — Modo Maratón
 *
 * Preguntas mezcladas (4 sub-modos) sin repetir país, hasta el PRIMER fallo.
 * Métrica: racha máxima de aciertos consecutivos. Una partida por día.
 *
 *  • Preguntas DETERMINISTAS por fecha (ranking justo: todos ven la misma serie),
 *    con la semilla desfasada 31 días para no coincidir con el reto diario de hoy.
 *  • Se pregeneran TODOS los países (COUNTRIES.length = 195) barajados → la racha
 *    perfecta posible es 195: con más preguntas habría que repetir países.
 *  • Persistencia: storage.js ('marathon' = espejo de players/{id}.stats.maraton*),
 *    candado robusto en marathon-attempt.js, ranking global en
 *    firebase-marathon-leaderboard.js y pantalla de ranking en marathon-rank-ui.js.
 *
 * Depende de: utils.js (seededRng, seededShuffle, escHtml), countries-data.js,
 *             storage.js, i18n.js, modes.js
 */

var MARATHON_MODES       = ['guess-country', 'guess-flag', 'guess-capital', 'guess-country-from-capital'];
var MARATHON_SEED_OFFSET = 31; /* días: semilla = fecha de hoy − 31 → nunca coincide con el reto de hoy */

/** Semilla YYYYMMDD de (fecha − 31 días). */
function getMarathonSeed(date) {
  var d = date ? new Date(date.getTime()) : new Date();
  d.setDate(d.getDate() - MARATHON_SEED_OFFSET);
  return parseInt(d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') +
    String(d.getDate()).padStart(2, '0'), 10);
}

/** Máximo de preguntas únicas = nº de países (cada país aparece una sola vez). */
function getMarathonMaxQuestions() { return COUNTRIES.length; }

/** 3 distractores deterministas (getDistractors usa Math.random). */
function _marathonDistractors(excludeCode, rng) {
  var pool = COUNTRIES.filter(function (c) { return c.code !== excludeCode; });
  var out = [];
  for (var i = 0; i < 3 && pool.length; i++) {
    out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
  }
  return out;
}

/**
 * Genera la serie completa de la Maratón del día (195 preguntas, sin repetir país).
 * Sub-modos repartidos a partes iguales (49+49+49+48) y barajados con la misma semilla.
 * @param {Date} [date]
 * @returns {Array} [{ correct, options, correctIndex, questionMode }]
 */
function getMarathonQuestions(date) {
  var rng = seededRng(getMarathonSeed(date));
  var countries = seededShuffle(COUNTRIES.slice(), rng);

  var modePool = [];
  for (var i = 0; i < countries.length; i++) modePool.push(MARATHON_MODES[i % MARATHON_MODES.length]);
  modePool = seededShuffle(modePool, rng);

  return countries.map(function (correct, i) {
    var options = seededShuffle([correct].concat(_marathonDistractors(correct.code, rng)), rng);
    var ci = -1;
    for (var j = 0; j < options.length; j++) {
      if (options[j].code === correct.code) { ci = j; break; }
    }
    return { correct: correct, options: options, correctIndex: ci, questionMode: modePool[i] };
  });
}

var Marathon = (function () {

  /**
   * Registra el resultado de una partida (fin normal o barrido de huérfano):
   * candado/mejor racha (espejo de players/{id}), histórico local y ranking global.
   * Las estadísticas por modo y los fallos los registra el llamante (_endGame / sweep).
   * @param {{dateKey?:string, streak:number, correct:number, wrong:number}} r
   * @returns {{bestStreak:number, games:number, lastPlayed:string}} estado tras guardar
   */
  function commitRun(r) {
    var dk = (r && r.dateKey) || getDailyKey();
    var streak = Math.max(0, Math.floor((r && r.streak) || 0));
    var st = markMarathonCompleted(streak, dk);
    addMarathonRun({ date: dk, streak: streak, correct: (r && r.correct) || streak,
                     wrong: (r && r.wrong) || 0, ts: Date.now() });
    try {
      if (typeof MarathonLeaderboard !== 'undefined') MarathonLeaderboard.submitBest();
    } catch (e) {}
    return st;
  }

  /* ── Tarjeta del home ─────────────────────────────────── */

  function _statusText() {
    var st = loadMarathonStatus();
    var best = st.bestStreak > 0 ? ' · ' + t('marathon_status_best', { n: st.bestStreak }) : '';
    if (st.lastPlayed === getDailyKey()) {
      var today = getMarathonTodayStreak();
      return (today !== null ? t('marathon_status_done', { n: today }) : t('home_daily_done')) + best;
    }
    return t('mode_marathon_desc') + best;
  }

  /**
   * Construye la tarjeta (va justo debajo de la del Reto Diario).
   * Es un div con rol de botón porque contiene otro botón (acceso al ranking).
   */
  function buildHomeCard(selected, onSelect, onRanking) {
    var card = document.createElement('div');
    card.className = 'mode-card mode-card--solo mode-card--marathon' + (selected ? ' mode-card--selected' : '');
    card.id = 'btn-marathon-entry';
    card.dataset.mode = 'marathon';
    card.setAttribute('role', 'button');
    card.tabIndex = 0;
    card.innerHTML =
      '<span class="mode-card-icon" id="marathon-icon">' + MODE_MARATHON.visualBig + '</span>' +
      '<div class="mode-card-text">' +
        '<span class="mode-card-name">' + escHtml(t('mode_marathon')) + '</span>' +
        '<span class="mode-card-desc" id="marathon-status"></span>' +
      '</div>' +
      '<button class="marathon-rank-btn" type="button" id="btn-marathon-ranking" aria-label="' +
        escHtml(t('marathon_ranking_title')) + '">🏆</button>' +
      (selected ? '<span class="mode-card-check">✓</span>' : '');
    card.addEventListener('click', function (e) {
      if (e.target.closest('.marathon-rank-btn')) { e.stopPropagation(); if (onRanking) onRanking(); return; }
      if (onSelect) onSelect('marathon');
    });
    card.addEventListener('keydown', function (e) {
      if (e.target === card && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); card.click(); }
    });
    _paintCard(card);
    return card;
  }

  function _paintCard(card) {
    var status = card ? card.querySelector('#marathon-status') : document.getElementById('marathon-status');
    var icon   = card ? card.querySelector('#marathon-icon')   : document.getElementById('marathon-icon');
    var done   = isMarathonCompletedToday();
    if (status) status.textContent = _statusText();
    if (icon) icon.textContent = done ? '✅' : MODE_MARATHON.visualBig;
    var el = card || document.getElementById('btn-marathon-entry');
    if (el) el.classList.toggle('daily-done', done);
  }

  /** Repinta el estado de la tarjeta (candado diario + mejor racha). */
  function updateCardUI() { _paintCard(null); }

  /* ── Modal de reglas antes de empezar (iniciar = comprometerse) ── */

  function showInfoModal(onPlay) {
    var MODAL_ID = 'modal-marathon-info';
    var modal = document.getElementById(MODAL_ID);
    if (!modal) {
      modal = document.createElement('div');
      modal.id = MODAL_ID;
      modal.className = 'modal-overlay';
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-modal', 'true');
      document.body.appendChild(modal);
    }
    var rows = [
      { icon: '🔀', body: t('marathon_info_rule1', { n: getMarathonMaxQuestions() }) },
      { icon: '💥', body: t('marathon_info_rule2') },
      { icon: '📅', body: t('marathon_info_rule3') }
    ];
    modal.innerHTML =
      '<div class="modal-panel card">' +
        '<div class="modal-header"><h3 class="modal-title">' + escHtml(t('marathon_info_title')) + '</h3></div>' +
        '<div class="modal-body">' + rows.map(function (r) {
          return '<div class="daily-info-row"><span class="daily-info-row-icon">' + r.icon + '</span>' +
            '<div class="daily-info-row-text"><span class="daily-info-row-body">' + escHtml(r.body) + '</span></div></div>';
        }).join('') + '</div>' +
        '<div class="modal-footer modal-footer-row">' +
          '<button class="btn btn-ghost" type="button" id="btn-marathon-info-cancel" data-back>' + escHtml(t('btn_cancel')) + '</button>' +
          '<button class="btn btn-primary" type="button" id="btn-marathon-info-play">' + escHtml(t('marathon_info_play')) + '</button>' +
        '</div>' +
      '</div>';
    modal.style.display = 'flex';

    function close() { modal.style.display = 'none'; modal.onclick = null; }
    modal.onclick = function (e) { if (e.target === modal) close(); };
    document.getElementById('btn-marathon-info-cancel').onclick = close;
    document.getElementById('btn-marathon-info-play').onclick = function () {
      close();
      if (onPlay) onPlay();
    };
  }

  /* ── Pantalla de resultados (ajustes sobre renderResults) ── */

  function renderResults(streak, best, isNewBest, perfect) {
    var trophy = document.getElementById('results-trophy');
    var title  = document.getElementById('results-title');
    var sub    = document.getElementById('results-subtitle');
    var denom  = document.getElementById('results-score-denom');
    var rec    = document.getElementById('results-new-record');
    if (trophy) trophy.textContent = perfect ? '🏆' : (isNewBest && streak > 0) ? '🥇' : '🏃';
    if (title)  title.textContent  = perfect ? t('marathon_result_perfect') : t('marathon_result_title');
    if (sub)    sub.textContent    = t('marathon_result_sub', { best: best });
    if (denom)  denom.textContent  = ' 🔥';
    if (rec) {
      rec.style.display = (isNewBest && streak > 0) ? 'block' : 'none';
      rec.textContent   = t('marathon_new_best');
    }
    var retry = document.getElementById('btn-retry');
    if (retry) retry.style.display = 'none';
  }

  return {
    commitRun:      commitRun,
    buildHomeCard:  buildHomeCard,
    updateCardUI:   updateCardUI,
    showInfoModal:  showInfoModal,
    renderResults:  renderResults
  };
})();

function updateMarathonCardUI() { Marathon.updateCardUI(); }
