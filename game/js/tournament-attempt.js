/**
 * js/tournament-attempt.js — FlagMaster
 *
 * Modelo "iniciar = comprometerse" para torneos.
 * Si la app se cierra inesperadamente (force-kill, crash, OOM, reboot)
 * antes de terminar, el intento huérfano se cierra al arrancar y
 * la puntuación parcial se envía a tournament_scores.
 *
 * API pública (window.TournamentAttempt):
 *   begin(tournament)      — inicia el intento; idempotente por tournamentId
 *   update(partial)        — snapshot incremental tras cada respuesta
 *   finalize()             — cierra el intento normalmente
 *   load()                 — devuelve el objeto guardado o null
 *   clear()                — elimina el snapshot
 *   hasOpenAttempt()       — true si hay un intento sin cerrar
 *   sweepOrphanAttempt()   — llamar al arrancar; cierra intentos huérfanos
 */
var TournamentAttempt = (function () {
  'use strict';

  var STORAGE_KEY    = 'tournament_attempt';
  var SCHEMA_VERSION = 1;

  /* Estructura guardada en localStorage:
     {
       version, tournamentId, mode, startedAt, lastTickAt,
       currentIndex, questionScores, correct, wrong, maxStreak, wrongList, score
     }
  */

  /* ── helpers internos ── */

  function load() {
    try {
      var raw = (typeof storageLoad === 'function')
        ? storageLoad(STORAGE_KEY, null)
        : JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (!raw || typeof raw !== 'object') return null;
      if (raw.version !== SCHEMA_VERSION) return null;
      if (typeof raw.tournamentId !== 'string') return null;
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
   * Marca el inicio de un intento de torneo. SÍNCRONO.
   * Debe llamarse ANTES de pintar la primera pregunta del torneo.
   *
   * Es idempotente: si ya existe un intento del mismo torneo, no lo
   * sobrescribe. Si existe uno de otro torneo (residuo no barrido),
   * lo descarta y crea uno nuevo.
   *
   * @param {object} tournament  — objeto torneo con al menos { id, gameConfig.mode }
   */
  function begin(tournament) {
    if (!tournament || !tournament.id) return;
    var existing = load();
    if (existing) {
      if (existing.tournamentId === tournament.id) {
        /* Intento del mismo torneo — idempotente, no sobrescribir */
        return;
      }
      /* Residuo de otro torneo — descartar */
      clear();
    }
    var attempt = {
      version:        SCHEMA_VERSION,
      tournamentId:   tournament.id,
      mode:           (tournament.gameConfig && tournament.gameConfig.mode) || '',
      startedAt:      Date.now(),
      lastTickAt:     Date.now(),
      currentIndex:   0,
      questionScores: [],
      correct:        0,
      wrong:          0,
      maxStreak:      0,
      wrongList:      [],
      score:          0
    };
    _save(attempt);
  }

  /**
   * Snapshot incremental tras cada respuesta del jugador en el torneo.
   * Acepta un objeto parcial con los campos actualizados; los mergea con
   * el estado guardado.
   *
   * @param {object} partial  — campos del _gameState a persistir
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
   * Cierra el intento normalmente al terminar la partida.
   * Solo elimina el snapshot.
   */
  function finalize() {
    clear();
  }

  /**
   * Devuelve true si hay un intento abierto sin cerrar.
   */
  function hasOpenAttempt() {
    return load() !== null;
  }

  /**
   * SWEEP — debe ejecutarse al arrancar la app, ANTES de pintar la home.
   *
   * Cierra cualquier intento huérfano causado por force-kill, crash,
   * OOM-kill de Android o reboot. Envía la puntuación parcial a
   * tournament_scores si el torneo sigue abierto.
   *
   * Best-effort: no bloquea el arranque. La lógica async va en .then().catch().
   *
   * @returns {object|null}  descriptor del barrido, o null si no había nada
   */
  function sweepOrphanAttempt() {
    var a = load();
    if (!a) return null;

    var tournamentId = a.tournamentId;
    var correct      = a.correct || 0;
    var wrong        = a.wrong   || 0;
    var maxStreak    = a.maxStreak || 0;

    /* Calcular puntuación final con bonus de perfecta si procede */
    var finalScore = a.score || 0;
    if (typeof ScoreCalculator !== 'undefined') {
      var total = Math.max(
        (a.currentIndex || 0),
        correct + wrong,
        1
      );
      finalScore = ScoreCalculator.calculateFinalScore(
        a.questionScores || [], correct, total);
    }

    var result = { tournamentId: tournamentId, score: finalScore };

    /* Comprobar PGS: si existe pero NO está sign-in, conservar snapshot para reintento */
    if (typeof PlayGamesService !== 'undefined' && PlayGamesService) {
      if (!PlayGamesService.isSignedIn()) {
        /* Dejar el snapshot intacto — el retry se disparará desde ProfilePill.onSignIn */
        console.log('[TournamentAttempt] PGS no listo; sweep aplazado hasta sign-in.');
        return null;
      }
    } else {
      /* PGS no existe en absoluto — descartar */
      clear();
      return null;
    }

    /* Intentar enviar score — best-effort, no bloquea */
    if (typeof TournamentService !== 'undefined') {
      TournamentService.getTournamentById(tournamentId).then(function (t) {
        if (!t) {
          clear();
          return;
        }
        if (t.status === 'open') {
          /* Recalcular con numQuestions del torneo si está disponible */
          var scoreToSend = finalScore;
          if (typeof ScoreCalculator !== 'undefined' && t.gameConfig && t.gameConfig.numQuestions) {
            scoreToSend = ScoreCalculator.calculateFinalScore(
              a.questionScores || [], correct, t.gameConfig.numQuestions);
          }
          TournamentService.submitScore(t, {
            score:     scoreToSend,
            correct:   correct,
            wrong:     wrong,
            maxStreak: maxStreak
          }).then(function () {
            clear();
          }).catch(function () {
            clear();
          });
        } else {
          /* Torneo cerrado o no existe: descartar */
          clear();
        }
      }).catch(function () {
        clear();
      });
    } else {
      clear();
    }

    console.log('[TournamentAttempt] Sweep:', result);
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
