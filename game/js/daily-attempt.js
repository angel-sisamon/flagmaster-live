/**
 * js/daily-attempt.js — FlagMaster
 *
 * Modelo "iniciar = comprometerse": en el momento en que el usuario
 * ve la primera pregunta del reto diario, el intento ha comenzado y
 * el resultado es definitivo. No existe la opción de reiniciar.
 *
 * Si la app se cierra de forma inesperada (force-kill, crash, OOM-kill,
 * reboot) antes de terminar, el intento "huérfano" se detecta al
 * arrancar y se cierra automáticamente con la puntuación parcial.
 *
 * API pública (window.DailyAttempt):
 *   begin(questions)       — inicia el intento; idempotente
 *   update(partial)        — snapshot incremental tras cada respuesta
 *   finalize()             — cierra el intento normalmente (fin de partida)
 *   load()                 — devuelve el objeto guardado o null
 *   clear()                — elimina el snapshot
 *   hasOpenAttempt()       — true si hay un intento sin cerrar
 *   sweepOrphanAttempt()   — llamar al arrancar: cierra intentos huérfanos
 */
var DailyAttempt = (function () {
  var STORAGE_KEY    = 'daily_attempt';
  var SCHEMA_VERSION = 1;

  /* ── helpers internos ── */

  /**
   * Hash determinista y barato de las preguntas del día.
   * Sirve únicamente para detectar desfase de fecha o manipulación
   * del snapshot; no requiere criptografía.
   */
  function _hashQuestions(questions) {
    try {
      var src = '';
      for (var i = 0; i < questions.length; i++) {
        var q = questions[i] || {};
        var c = (q.correct && q.correct.code) ? q.correct.code : '';
        var m = q.questionMode || '';
        src += c + ':' + m + '|';
      }
      /* djb2 simple — force signed 32-bit to ensure consistent results */
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

  /* ── API pública ── */

  /**
   * Marca el inicio de un intento. SÍNCRONO. Debe llamarse ANTES de
   * pintar la primera pregunta del reto diario.
   *
   * Es idempotente: si ya existe un intento del día de hoy, no lo
   * sobrescribe (defensa contra dobles llamadas o reintentos).
   *
   * @param {Array} questions  — preguntas del reto (resultado de getDailyQuestions)
   */
  function begin(questions) {
    if (typeof getDailyKey !== 'function') return;
    var todayKey = getDailyKey();
    var existing = load();
    if (existing && existing.dateKey === todayKey) {
      /* Today's attempt exists — only keep it if the questions hash still matches.
         A mismatch (e.g. app update changed the question pool) means the stored
         attempt is stale; clear it and start fresh. */
      if (_hashQuestions(questions || []) === existing.questionsHash) {
        return; /* idempotent — do not overwrite in-progress attempt */
      }
      clear(); /* stale hash — discard and fall through to create a new attempt */
    }
    var attempt = {
      version:       SCHEMA_VERSION,
      dateKey:       todayKey,
      startedAt:     Date.now(),
      lastTickAt:    Date.now(),
      questionsHash: _hashQuestions(questions || []),
      currentIndex:  0,
      questionScores:[],
      correct:       0,
      wrong:         0,
      maxStreak:     0,
      wrongList:     [],
      score:         0
    };
    _save(attempt);
  }

  /**
   * Snapshot incremental tras cada respuesta del jugador en el reto diario.
   * Acepta un objeto parcial con los campos actualizados; los mergea con el
   * estado guardado. Llama a esto después de cada cambio de score/currentIndex.
   *
   * @param {Object} partial  — campos del _gameState a persistir
   */
  function update(partial) {
    var a = load();
    if (!a) return;
    if (!partial || typeof partial !== 'object') return;
    var keys = ['currentIndex', 'questionScores', 'correct', 'wrong',
                'maxStreak', 'wrongList', 'score'];
    for (var i = 0; i < keys.length; i++) {
      if (partial[keys[i]] !== undefined) a[keys[i]] = partial[keys[i]];
    }
    a.lastTickAt = Date.now();
    _save(a);
  }

  /**
   * Cierra el intento normalmente al terminar la última pregunta.
   * No llama a markDailyCompleted — eso lo hace _endGame en main.js.
   * Solo elimina el snapshot.
   */
  function finalize() {
    clear();
  }

  /**
   * Devuelve true si hay un intento abierto (de hoy o de otro día) sin cerrar.
   */
  function hasOpenAttempt() {
    return load() !== null;
  }

  /**
   * SWEEP — debe ejecutarse al arrancar la app, ANTES de pintar la home.
   *
   * Cierra cualquier intento huérfano causado por force-kill, crash,
   * OOM-kill de Android, reboot, o reloj adelantado:
   *
   *   Caso A (intento de HOY):      markDailyCompleted(score parcial)
   *   Caso B (intento de otro día): markDateCompleted(dateKey, score parcial)
   *
   * De esta forma, cuando updateDailyCardUI() pinta el home, el estado
   * ya refleja el intento incompleto como "completado" con la puntuación
   * que tenía el usuario antes de cerrar la app.
   *
   * @returns {Object|null}  descriptor del barrido, o null si no había nada
   */
  function sweepOrphanAttempt() {
    var a = load();
    if (!a) return null;

    if (typeof getDailyKey !== 'function') { clear(); return null; }
    var todayKey     = getDailyKey();
    var partialScore = (typeof a.score === 'number' && a.score >= 0) ? a.score : 0;
    var result       = { dateKey: a.dateKey, score: partialScore, case: null };

    if (a.dateKey === todayKey) {
      result.case = 'today';
      /* Solo marcar si no estaba ya completado por otra vía (sync Firestore, etc.) */
      if (typeof isDailyCompleted === 'function' && !isDailyCompleted()) {
        if (typeof markDailyCompleted === 'function') {
          markDailyCompleted(partialScore);
        }
        /* Enviar a leaderboards — best effort, sin bloquear.
           Si Firebase/PGS aún no están listos (arranque en frío), encolar
           en DailySync para reintento posterior. Si ya están listos,
           el intento inmediato de FirebaseLeaderboard tiene éxito en el acto. */
        try {
          if (typeof DailySync !== 'undefined' && DailySync &&
              typeof DailySync.enqueueDeferred === 'function') {
            DailySync.enqueueDeferred(partialScore);
          }
          /* Intento inmediato también — si ya está todo listo, sale ya */
          if (typeof FirebaseLeaderboard !== 'undefined' &&
              FirebaseLeaderboard &&
              typeof FirebaseLeaderboard.submitDailyScore === 'function') {
            FirebaseLeaderboard.submitDailyScore(partialScore);
          }
        } catch (e) {}
        try {
          if (typeof PlayGamesService !== 'undefined' &&
              PlayGamesService &&
              typeof PlayGamesService.submitScore === 'function') {
            PlayGamesService.submitScore('daily_challenge', partialScore);
          }
        } catch (e) {}
        /* Reprogramar notificación de mañana */
        try {
          if (typeof NotificationService !== 'undefined' &&
              NotificationService &&
              typeof NotificationService.onDailyCompleted === 'function') {
            NotificationService.onDailyCompleted();
          }
        } catch (e) {}
      }
    } else {
      result.case = 'past';
      /* Día anterior — cerrarlo sobre su propio dateKey, no sobre hoy.
         Comprobar si ya estaba marcado (p. ej. por otra vía) para evitar
         llamadas duplicadas si clear() fallara en una ejecución anterior. */
      if (typeof markDateCompleted === 'function') {
        var alreadyDone = false;
        try {
          if (typeof loadDailyStatus === 'function') {
            var pastStatus = loadDailyStatus();
            alreadyDone = !!(pastStatus && pastStatus[a.dateKey]);
          }
        } catch (e) {}
        if (!alreadyDone) {
          markDateCompleted(a.dateKey, partialScore);
        }
      }
    }

    clear();
    console.log('[DailyAttempt] Sweep:', result);
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
