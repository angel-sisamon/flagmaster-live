/**
 * js/daily.js — Reto diario con seed por fecha (determinista)
 */
var DAILY_COUNT = 15;

/* Modos mezclados para el reto diario: 4+4+4+3 = 15 */
var DAILY_MIXED_MODES = ['guess-country', 'guess-flag', 'guess-capital', 'guess-country-from-capital'];
var DAILY_MIXED_COUNTS = [4, 4, 4, 3];

function getDailySeed() {
  var d=new Date();
  return parseInt(d.getFullYear()+String(d.getMonth()+1).padStart(2,'0')+String(d.getDate()).padStart(2,'0'),10);
}

function getDailyCountries() {
  var rng = seededRng(getDailySeed());
  return seededShuffle(COUNTRIES.slice(), rng).slice(0, DAILY_COUNT);
}

/**
 * Genera las 15 preguntas del reto diario de forma determinista.
 * Cada pregunta tiene un campo `questionMode` con el sub-modo ('guess-country',
 * 'guess-flag', 'guess-capital' o 'guess-country-from-capital').
 * La distribución es 4+4+4+3 y se baraja con el mismo seed del día.
 *
 * @returns {Array} Array de { correct, options, correctIndex, questionMode }
 */
function getDailyQuestions() {
  var rng = seededRng(getDailySeed());

  /* Seleccionamos los 15 países del día */
  var countries = seededShuffle(COUNTRIES.slice(), rng).slice(0, DAILY_COUNT);

  /* Construimos la bolsa de modos y la barajamos determinísticamente */
  var modePool = [];
  for (var m = 0; m < DAILY_MIXED_MODES.length; m++) {
    for (var k = 0; k < DAILY_MIXED_COUNTS[m]; k++) {
      modePool.push(DAILY_MIXED_MODES[m]);
    }
  }
  modePool = seededShuffle(modePool, rng);

  /* Construimos las preguntas */
  return countries.map(function (correct, i) {
    var qMode = modePool[i];
    var distractors = getDistractors(correct.code, 3);
    var options = seededShuffle([correct].concat(distractors), rng);
    var ci = -1;
    for (var j = 0; j < options.length; j++) {
      if (options[j].code === correct.code) { ci = j; break; }
    }
    return { correct: correct, options: options, correctIndex: ci, questionMode: qMode };
  });
}

/**
 * Genera un icono SVG de calendario que muestra el día actual.
 * @param {number} size  Tamaño en px (por defecto 30)
 * @returns {string}  HTML string con el SVG inline
 */
function getDailyCalendarIcon(size) {
  var d = new Date();
  var day = d.getDate();
  var monthIdx = d.getMonth();

  /* Nombres cortos de mes según idioma activo */
  var lang = (typeof getLang === 'function') ? getLang() : 'es';
  var monthsEs = ['ENE','FEB','MAR','ABR','MAY','JUN','JUL','AGO','SEP','OCT','NOV','DIC'];
  var monthsEn = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  var month = (lang === 'en' ? monthsEn : monthsEs)[monthIdx];

  var s = size || 30;

  /* Proporciones internas del SVG (viewBox 28×28) */
  /* Rendered as <img> with data URI so Android WebView algorithmic darkening
     (MIUI/HyperOS forced dark mode) cannot invert individual SVG fills. */
  var svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28">' +

    /* Fondo blanco redondeado */
    '<rect width="28" height="28" rx="5.5" fill="#ffffff"/>' +

    /* Cabecera roja (top + rect cuadrado para eliminar curva inferior) */
    '<rect width="28" height="8.5" rx="5.5" fill="#e53935"/>' +
    '<rect y="3" width="28" height="5.5" fill="#e53935"/>' +

    /* Línea separadora sutil */
    '<line x1="0" y1="8.5" x2="28" y2="8.5" stroke="#ccc" stroke-width="0.4"/>' +

    /* Mes en la cabecera */
    '<text x="14" y="6.8"' +
    ' text-anchor="middle"' +
    ' font-size="5" font-weight="700" fill="#ffffff"' +
    ' font-family="system-ui,-apple-system,Helvetica,Arial,sans-serif"' +
    ' letter-spacing="0.5">' + month + '</text>' +

    /* Número del día — tamaño ajustado para 1 o 2 dígitos */
    '<text x="14" y="' + (day < 10 ? '22' : '22') + '"' +
    ' text-anchor="middle"' +
    ' font-size="' + (day < 10 ? '14' : '13') + '"' +
    ' font-weight="900" fill="#1a1a2e"' +
    ' font-family="system-ui,-apple-system,Helvetica,Arial,sans-serif">' + day + '</text>' +

    '</svg>';

  return (
    '<img width="' + s + '" height="' + s + '"' +
    ' src="data:image/svg+xml,' + encodeURIComponent(svg) + '"' +
    ' alt="" draggable="false"' +
    ' style="display:inline-block;vertical-align:middle;' +
    'filter:drop-shadow(0 2px 5px rgba(0,0,0,.45))"/>'
  );
}

function updateDailyCardUI() {
  var icon   = document.getElementById('daily-icon');
  var status = document.getElementById('daily-status');
  if (!icon || !status) return;

  if (isDailyCompleted()) {
    var sc = getDailyCompletedScore();
    icon.textContent = '✅';
    status.textContent = t('home_daily_done') + (sc !== null ? ' · ' + sc + ' pts' : '');
    if (status.closest('.daily-card')) status.closest('.daily-card').classList.add('daily-done');
  } else {
    /* Icono de calendario dinámico con el día actual */
    icon.innerHTML = getDailyCalendarIcon(30);
    status.textContent = t('home_daily_play');
    if (status.closest('.daily-card')) status.closest('.daily-card').classList.remove('daily-done');
  }
}
