/**
 * js/daily-sync.js — FlagMaster
 *
 * DailySync — coordina el envío del score del reto diario a Firebase
 * mientras el usuario juega, para que cualquier cierre inesperado
 * (force-kill, crash) deje en Firestore el último score conocido.
 *
 * Estrategia:
 *   - touch(score)       → encola el score más reciente y programa un envío
 *                          en THROTTLE_MS si no hay otro pendiente.
 *   - flush()            → cancela el throttle y envía inmediatamente. Se llama
 *                          en visibilitychange→hidden y App.pause (último aliento).
 *   - Si FirebaseLeaderboard no está listo o PGS no está logueado al
 *     intentar enviar, el score queda como pendiente y se reintenta
 *     cuando retryPending() es invocado tras PGS sign-in / firebase ready.
 *
 * No envía nunca un score menor que el último confirmado como enviado.
 * Firestore además solo persiste si supera el documento existente.
 *
 * API pública (window.DailySync):
 *   touch(score)         — notifica score actualizado; throttled
 *   flush()              — fuerza envío inmediato del pendiente
 *   retryPending()       — reintenta deferred cuando Firebase/PGS están listos
 *   reset()              — resetea estado al iniciar nuevo reto
 *   enqueueDeferred(s)   — inyecta score deferred (usado por sweepOrphanAttempt)
 */
var DailySync = (function () {
  var THROTTLE_MS    = 4000;   /* mín. ms entre envíos durante el juego */
  var _pendingScore  = null;   /* score esperando timer */
  var _timer         = null;
  var _lastSentScore = -1;     /* mayor score ya confirmado en Firebase */
  var _deferredScore = null;   /* score esperando que Firebase/PGS estén listos */

  function _hasFirebaseReady() {
    return typeof FirebaseLeaderboard !== 'undefined' &&
           FirebaseLeaderboard &&
           typeof FirebaseLeaderboard.isReady === 'function' &&
           FirebaseLeaderboard.isReady();
  }

  function _isPgsAvailable() {
    return typeof PlayGamesService !== 'undefined' &&
           PlayGamesService &&
           typeof PlayGamesService.isSignedIn === 'function' &&
           PlayGamesService.isSignedIn();
  }

  function _doSubmit(score) {
    /* Si no hay infraestructura lista, dejarlo como deferred y reintentar
       cuando PGS firme o Firebase termine de inicializar. */
    if (!_hasFirebaseReady() || !_isPgsAvailable()) {
      if (_deferredScore === null || score > _deferredScore) _deferredScore = score;
      console.log('[DailySync] Aplazado (Firebase/PGS no listos):', score);
      return;
    }
    try {
      FirebaseLeaderboard.submitDailyScore(score).then(function (ok) {
        if (ok) {
          _lastSentScore = Math.max(_lastSentScore, score);
          console.log('[DailySync] ✓ Score parcial enviado:', score);
        }
      }).catch(function () { /* silencioso — se reintenta en próximo touch */ });
    } catch (e) { /* silencioso */ }
  }

  /**
   * Notifica un score actualizado del reto diario en curso.
   * Throttled: el envío real se programa en THROTTLE_MS.
   *
   * @param {number} score
   */
  function touch(score) {
    if (typeof score !== 'number' || score < 0) return;
    if (score <= _lastSentScore) return;
    _pendingScore = (_pendingScore === null) ? score : Math.max(_pendingScore, score);
    if (_timer) return;
    _timer = setTimeout(function () {
      _timer = null;
      var s = _pendingScore;
      _pendingScore = null;
      if (s !== null && s > _lastSentScore) _doSubmit(s);
    }, THROTTLE_MS);
  }

  /**
   * Fuerza el envío inmediato del score pendiente, si lo hay.
   * Llamar en visibilitychange→hidden, pagehide, App.pause y _endGame.
   */
  function flush() {
    if (_timer) { clearTimeout(_timer); _timer = null; }
    var s = _pendingScore;
    _pendingScore = null;
    if (s !== null && s > _lastSentScore) _doSubmit(s);
  }

  /**
   * Reintenta el envío de un score deferred (cuando Firebase/PGS no
   * estaban listos en el momento del touch). Llamar tras PGS sign-in
   * y/o tras la inicialización completada de Firebase.
   */
  function retryPending() {
    if (_deferredScore === null) return;
    var s = _deferredScore;
    _deferredScore = null;
    if (s > _lastSentScore) _doSubmit(s);
  }

  /**
   * Resetea el estado interno. Llamar al iniciar un nuevo reto diario
   * para no arrastrar _lastSentScore de la sesión anterior.
   */
  function reset() {
    if (_timer) { clearTimeout(_timer); _timer = null; }
    _pendingScore  = null;
    _lastSentScore = -1;
    _deferredScore = null;
  }

  /**
   * Inyecta directamente un score como deferred — usado por el sweep al
   * arrancar para garantizar el envío de un intento huérfano cuya marca
   * local ya quedó persistida pero cuya submisión a Firebase no pudo
   * completarse en el momento del sweep.
   *
   * @param {number} score
   */
  function enqueueDeferred(score) {
    if (typeof score !== 'number' || score < 0) return;
    if (_deferredScore === null || score > _deferredScore) _deferredScore = score;
  }

  return {
    touch:           touch,
    flush:           flush,
    retryPending:    retryPending,
    reset:           reset,
    enqueueDeferred: enqueueDeferred
  };
})();
