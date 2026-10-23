/**
 * js/score-calculator.js
 * Sistema de puntuación modular basado en tiempo de respuesta y racha de aciertos.
 * Reutilizable en cualquier modo de juego.
 *
 * Depende de: nada (módulo autónomo)
 */
var ScoreCalculator = (function () {

  /* Multiplicadores de racha indexados por número de aciertos consecutivos */
  var STREAK_MULTIPLIERS = [1.0, 1.0, 1.1, 1.2, 1.3, 1.5, 1.7];

  /* Tiempo máximo por pregunta en segundos */
  var MAX_QUESTION_TIME = 10;

  /* Tiempo máximo por pregunta en milisegundos */
  var MAX_QUESTION_TIME_MS = MAX_QUESTION_TIME * 1000;

  /* Puntos base por pregunta correcta */
  var BASE_POINTS = 100;

  /* Bonus por completar todas las preguntas correctamente */
  var PERFECT_BONUS = 500;

  /* Número de preguntas del reto diario para activar el bonus de perfecta */
  var DAILY_TOTAL = 15;

  /**
   * Devuelve el multiplicador de racha para una racha dada.
   * Para rachas 1–6 mantiene la tabla original.
   * Desde racha 7 crece +0.05 por acierto adicional, con techo ×2.5.
   * @param {number} streak  Aciertos consecutivos (≥ 0).
   * @returns {number}
   */
  function getStreakMultiplier(streak) {
    if (streak <= 0) return 1.0;
    if (streak < STREAK_MULTIPLIERS.length) {
      return STREAK_MULTIPLIERS[streak];
    }
    var extended = STREAK_MULTIPLIERS[STREAK_MULTIPLIERS.length - 1] +
      (streak - (STREAK_MULTIPLIERS.length - 1)) * 0.05;
    return Math.min(extended, 2.5);
  }

  /**
   * Calcula los puntos obtenidos por una pregunta correcta.
   * puntosPregunta = 100 * factorTiempo * multiplicadorRacha
   *
   * @param {number} responseTime  Tiempo de respuesta en segundos (0–10).
   * @param {number} streak        Racha de aciertos consecutivos al responder (ya actualizada).
   * @returns {number}  Puntos redondeados.
   */
  function calculateQuestionScore(responseTime, streak) {
    var tiempoRestante = MAX_QUESTION_TIME - Math.min(responseTime, MAX_QUESTION_TIME);
    var factorTiempo = 1 + (tiempoRestante / MAX_QUESTION_TIME);
    var multiplicadorRacha = getStreakMultiplier(streak);
    return Math.round(BASE_POINTS * factorTiempo * multiplicadorRacha);
  }

  /**
   * Calcula la puntuación final sumando los puntos de cada pregunta y aplicando el bonus.
   * Bonus: +500 si se aciertan todas las preguntas (solo en reto diario de 15 preguntas).
   *
   * @param {number[]} questionScores  Array de puntos por pregunta.
   * @param {number}   correctCount    Total de respuestas correctas.
   * @param {number}   totalQuestions  Total de preguntas en el modo.
   * @returns {number}
   */
  function calculateFinalScore(questionScores, correctCount, totalQuestions) {
    var total = questionScores.reduce(function (sum, s) { return sum + s; }, 0);
    if (correctCount === totalQuestions && totalQuestions === DAILY_TOTAL) {
      total += PERFECT_BONUS;
    }
    return total;
  }

  return {
    getStreakMultiplier:    getStreakMultiplier,
    calculateQuestionScore: calculateQuestionScore,
    calculateFinalScore:    calculateFinalScore,
    MAX_QUESTION_TIME:      MAX_QUESTION_TIME,
    MAX_QUESTION_TIME_MS:   MAX_QUESTION_TIME_MS,
    PERFECT_BONUS:          PERFECT_BONUS,
  };

})();
