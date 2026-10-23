/**
 * js/marathon-attempt.js — FlagMaster
 *
 * Modelo "iniciar = comprometerse" para la Maratón (mismo patrón que
 * js/daily-attempt.js): en cuanto el jugador ve la primera pregunta, la
 * partida del día está consumida. No existe la opción de reiniciar.
 *
 * Dos capas de protección del candado diario:
 *   1. begin() marca el día como jugado en 'marathon' (markMarathonCompleted
 *      con racha 0) → viaja a players/{id}.stats.maratonUltimo en el siguiente
 *      push: ni reinstalar la app a mitad de partida permite repetir.
 *   2. Si la app muere a mitad (force-kill, crash, OOM, reboot), el intento
 *      "huérfano" se detecta al arrancar y se cierra con la racha parcial.
 *
 * API pública (window.MarathonAttempt):
 *   begin(questions)       — inicia el intento; idempotente
 *   update(partial)        — snapshot incremental tras cada respuesta
 *   finalize()             — cierra el intento normalmente (fin de partida)
 *   load()                 — devuelve el objeto guardado o null
 *   clear()                — elimina el snapshot
 *   hasOpenAttempt()       — true si hay un intento sin cerrar
 *   sweepOrphanAttempt()   — llamar al arrancar: cierra intentos huérfanos
 */
var MarathonAttempt = (function () {
  var STORAGE_KEY    = 'marathon_attempt';
  var SCHEMA_VERSION = 1;

  /* ── helpers internos ── */

  /** Hash djb2 de las preguntas (detecta desfase de fecha o manipulación del snapshot). */
  function _hashQuestions(questions) {
    try {
      var src = '';
      for (var i = 0; i < questions.length; i++) {
        var q = questions[i] || {};
        var c = (q.correct && q.correct.code) ? q.correct.code : '';
        var m = q.questionMode || '';
        src += c + ':' + m + '|';
      }
      var h = 5381;
      for (var j = 0; j < src.length; j++) {
        h = (((h << 5) + h) + src.charCodeAt(j)) | 0;
      }
      return 'h_' + (h >>> 0).toString(16);
    } catch (e) { return 'h_0'; }
  }

  function load() {
    try {
      var raw = (typeof storageLoad === 'function')
        ? storageLoad(STORAGE_KEY, null)
        : JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (!raw || typeof raw !== 'object') return null;
      if (raw.version !== SCHEMA_VERSION) return null;
      if (typeof raw.dateKey !== 'string') return null;
      return raw;
    } catch (e) { return null; }
  }

  function _save(obj) {
    try {
      if (typeof storageSave === 'function') storageSave(STORAGE_KEY, obj);
      else localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
    } catch (e) {}
  }

  function clear() {
    try {
      if (typeof storageSave === 'function') storageSave(STORAGE_KEY, null);
      try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
    } catch (e) {}
  }

  function _int(v) { return (typeof v === 'number' && isFinite(v) && v > 0) ? Math.floor(v) : 0; }

  /* ── API pública ── */

  /**
   * Marca el inicio de un intento. SÍNCRONO. Debe llamarse ANTES de pintar
   * la primera pregunta. Idempotente: si ya existe un intento de hoy con las
   * mismas preguntas, no lo sobrescribe.
   *
   * @param {Array} questions  — preguntas de la Maratón (getMarathonQuestions())
   */
  function begin(questions) {
    if (typeof getDailyKey !== 'function') return;
    var todayKey = getDailyKey();
    var hash     = _hashQuestions(questions || []);
    var existing = load();
    if (existing && existing.dateKey === todayKey && existing.questionsHash === hash) return;
    if (existing && existing.dateKey !== todayKey) sweepOrphanAttempt(); /* no perder un día anterior */

    _save({
      version:       SCHEMA_VERSION,
      dateKey:       todayKey,
      startedAt:     Date.now(),
      lastTickAt:    Date.now(),
      questionsHash: hash,
      currentIndex:  0,
      correct:       0,
      wrong:         0,
      maxStreak:     0,
      wrongList:     [],
      score:         0
    });
    /* El día queda consumido YA (local → players/{id} en el siguiente push) */
    if (typeof markMarathonCompleted === 'function') markMarathonCompleted(0, todayKey);
  }

  /**
   * Snapshot incremental tras cada respuesta.
   * @param {Object} partial  — campos del _gameState a persistir
   */
  function update(partial) {
    var a = load();
    if (!a) return;
    if (!partial || typeof partial !== 'object') return;
    var keys = ['currentIndex', 'correct', 'wrong', 'maxStreak', 'wrongList', 'score'];
    for (var i = 0; i < keys.length; i++) {
      if (partial[keys[i]] !== undefined) a[keys[i]] = partial[keys[i]];
    }
    a.lastTickAt = Date.now();
    _save(a);
  }

  /**
   * Cierre normal al terminar la partida. El registro del resultado lo hace
   * _endGame en main.js (Marathon.commitRun); aquí solo se borra el snapshot.
   */
  function finalize() {
    clear();
  }

  function hasOpenAttempt() {
    return load() !== null;
  }

  /**
   * SWEEP — ejecutar al arrancar la app, ANTES de pintar la home.
   * Cierra el intento huérfano con la racha parcial: mismo registro que un
   * fin de partida normal (estado diario, histórico, estadísticas por modo,
   * países fallados y ranking global) sobre la fecha del propio intento.
   *
   * @returns {Object|null}  descriptor del barrido, o null si no había nada
   */
  function sweepOrphanAttempt() {
    var a = load();
    if (!a) return null;
    clear(); /* primero: un fallo a mitad del registro no debe repetir el barrido en bucle */

    var streak = _int(a.correct);
    var wrong  = _int(a.wrong);
    var result = {
      dateKey: a.dateKey,
      streak:  streak,
      case:    (typeof getDailyKey === 'function' && a.dateKey === getDailyKey()) ? 'today' : 'past'
    };

    try {
      if (Array.isArray(a.wrongList) && typeof recordWrongCountryV2 === 'function') {
        a.wrongList.forEach(function (code) {
          if (typeof code === 'string') recordWrongCountryV2(code, 'marathon');
        });
      }
      if (typeof checkAchievements === 'function') {
        checkAchievements({
          mode: 'marathon', score: streak, total: streak + wrong,
          correct: streak, wrong: wrong, maxStreak: _int(a.maxStreak), isDaily: false
        });
      }
      if (typeof Marathon !== 'undefined' && Marathon && typeof Marathon.commitRun === 'function') {
        Marathon.commitRun({ dateKey: a.dateKey, streak: streak, correct: streak, wrong: wrong });
      } else if (typeof markMarathonCompleted === 'function') {
        markMarathonCompleted(streak, a.dateKey);
      }
    } catch (e) { console.warn('[MarathonAttempt] Sweep incompleto:', e); }

    console.log('[MarathonAttempt] Sweep:', result);
    return result;
  }

  return {
    begin:              begin,
    update:             update,
    finalize:           finalize,
    load:               load,
    clear:              clear,
    hasOpenAttempt:     hasOpenAttempt,
    sweepOrphanAttempt: sweepOrphanAttempt
  };
})();
