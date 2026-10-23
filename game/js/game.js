/**
 * js/game.js
 * Lógica del juego: preguntas, scoring, racha, modos.
 * Depende de: countries-data.js, utils.js
 *
 * Modos soportados:
 *   'guess-country'  — ver bandera, elegir país (normal)
 *   'guess-flag'     — ver país, elegir bandera  (normal)
 *   'guess-silhouette' — ver silueta del país en el mapa, elegir país (normal)
 *   'daily'          — igual que guess-country con preguntas fijas del día
 *   'timetrial'      — igual que guess-country, 60s globales, sin límite de preguntas
 *   'marathon'       — preguntas mezcladas del día; termina en el primer fallo (main.js)
 */

var _gameState = null;

function _isValidGameStateShape(s) {
  var hasValidCurrentIndex = !!s &&
    typeof s.currentIndex === 'number' &&
    s.currentIndex >= 0 &&
    Array.isArray(s.questions) &&
    (
      (s.questions.length === 0 && s.currentIndex === 0) ||
      (s.questions.length > 0 && s.currentIndex < s.questions.length) ||
      (s.questions.length > 0 && s.currentIndex === s.questions.length && !!s.finished)
    );

  return !!s &&
    typeof s === 'object' &&
    typeof s.mode === 'string' &&
    Array.isArray(s.questions) &&
    hasValidCurrentIndex &&
    typeof s.score === 'number' &&
    typeof s.streak === 'number' &&
    typeof s.maxStreak === 'number' &&
    typeof s.correct === 'number' &&
    typeof s.wrong === 'number' &&
    typeof s.attempted === 'number' &&
    Array.isArray(s.wrongList) &&
    Array.isArray(s.questionScores) &&
    typeof s.answered === 'boolean' &&
    typeof s.finished === 'boolean' &&
    typeof s.isTimeTrial === 'boolean' &&
    typeof s.isDailyChallenge === 'boolean';
}

/**
 * Construye un objeto pregunta a partir de un país.
 * Reutilizable desde initGame(), _launchSelected() y _launchReview().
 * @param {object} correct  País correcto (de COUNTRIES)
 * @returns {{ correct, options, correctIndex }}
 */
function buildQuestion(correct) {
  var distractors  = getDistractors(correct.code, 3);
  var options      = shuffle([correct].concat(distractors));
  var correctIndex = -1;
  for (var i = 0; i < options.length; i++) {
    if (options[i].code === correct.code) { correctIndex = i; break; }
  }
  return { correct: correct, options: options, correctIndex: correctIndex };
}

/**
 * Inicializa una nueva partida.
 * @param {string} mode
 * @param {number} numQuestions  ignorado para 'timetrial' y 'daily'
 * @param {Array}  prebuiltQuestions  para 'daily' o 'review'
 * @param {string} continent  'eu'|'am'|'as'|'af'|'oc'|'all'|null
 * @param {object} [opts]  opciones extra { useDailyScoring, isTournament, isMarathon }
 */
function initGame(mode, numQuestions, prebuiltQuestions, continent, opts) {
  var questions;

  if (prebuiltQuestions && prebuiltQuestions.length) {
    questions = prebuiltQuestions;
  } else {
    var pool = continent && continent !== 'all'
      ? getCountriesByContinent(continent)
      : COUNTRIES.slice();

    /* Modo silueta: sólo países con path disponible en assets/world.svg. */
    if (mode === 'guess-silhouette' && typeof Silhouette !== 'undefined') {
      pool = pool.filter(function (c) { return Silhouette.hasSilhouetteFor(c.code); });
    }

    var count = mode === 'timetrial'
      ? Math.min(60, pool.length)
      : Math.min(numQuestions || 10, pool.length);

    pool = shuffle(pool).slice(0, count);
    questions = pool.map(buildQuestion);
  }

  _gameState = {
    mode:             mode,
    continent:        continent || 'all',
    questions:        questions,
    originalQuestions:questions.slice(),
    currentIndex:     0,
    score:            0,
    streak:           0,
    maxStreak:        0,
    correct:          0,
    wrong:            0,
    attempted:        0,
    hardCorrectCount: 0,
    wrongList:        [],
    questionScores:   [],
    questionStartTime:null,
    answered:         false,
    finished:         false,
    isTimeTrial:      mode === 'timetrial',
    isDailyChallenge: mode === 'daily',
    isReview:         mode === 'review',
    useDailyScoring:  !!(opts && opts.useDailyScoring),
    isTournament:     !!(opts && opts.isTournament),
    isMarathon:       mode === 'marathon',
  };
}

/** Copia superficial del estado actual. */
function getGameState() {
  if (!_isValidGameStateShape(_gameState)) return null;
  return {
    mode:             _gameState.mode,
    continent:        _gameState.continent,
    questions:        _gameState.questions,
    currentIndex:     _gameState.currentIndex,
    score:            _gameState.score,
    streak:           _gameState.streak,
    maxStreak:        _gameState.maxStreak,
    correct:          _gameState.correct,
    wrong:            _gameState.wrong,
    hardCorrectCount: _gameState.hardCorrectCount,
    attempted:        _gameState.attempted,
    wrongList:        _gameState.wrongList.slice(),
    questionScores:   _gameState.questionScores.slice(),
    answered:         _gameState.answered,
    finished:         _gameState.finished,
    isTimeTrial:      _gameState.isTimeTrial,
    isDailyChallenge: _gameState.isDailyChallenge,
    isReview:         _gameState.isReview,
    useDailyScoring:  _gameState.useDailyScoring || false,
    isTournament:     _gameState.isTournament || false,
    isMarathon:       _gameState.isMarathon || false,
  };
}

function getCurrentQuestion() {
  if (!_isValidGameStateShape(_gameState)) return null;
  return _gameState.questions[_gameState.currentIndex] || null;
}

function getTotalQuestions() {
  return _isValidGameStateShape(_gameState) ? _gameState.questions.length : 0;
}

/**
 * Registra la respuesta del jugador.
 * @param {number} optionIndex  0-3, o -1 si el tiempo se agotó.
 * @returns {{ isCorrect, correctIndex, state } | null}
 */
function answerQuestion(optionIndex) {
  if (!_gameState || _gameState.answered || _gameState.finished) return null;

  var q         = getCurrentQuestion();
  var isCorrect = optionIndex === q.correctIndex;

  _gameState.answered = true;
  _gameState.attempted++;

  if (isCorrect) {
    _gameState.streak++;
    _gameState.correct++;
    if (_gameState.streak > _gameState.maxStreak) {
      _gameState.maxStreak = _gameState.streak;
    }

    if ((_gameState.isDailyChallenge || _gameState.useDailyScoring) && typeof ScoreCalculator !== 'undefined') {
      /* Puntuación basada en tiempo de respuesta y racha */
      var elapsedMs   = _gameState.questionStartTime ? (Date.now() - _gameState.questionStartTime) : ScoreCalculator.MAX_QUESTION_TIME_MS;
      var elapsedSecs = Math.min(elapsedMs / 1000, ScoreCalculator.MAX_QUESTION_TIME);
      var pts = ScoreCalculator.calculateQuestionScore(elapsedSecs, _gameState.streak);
      _gameState.questionScores.push(pts);
      _gameState.score += pts;
    } else {
      _gameState.score++;
    }
  } else {
    _gameState.streak = 0;
    _gameState.wrong++;
    if (_gameState.isDailyChallenge || _gameState.useDailyScoring) {
      _gameState.questionScores.push(0);
    }
    /* guardar para repaso */
    var wCode = q.correct.code;
    if (_gameState.wrongList.indexOf(wCode) === -1) _gameState.wrongList.push(wCode);
  }

  /* ★ Snapshot incremental para el reto diario (anti-trampa force-kill) ★ */
  if (_gameState.isDailyChallenge && typeof DailyAttempt !== 'undefined') {
    DailyAttempt.update({
      currentIndex:   _gameState.currentIndex,
      questionScores: _gameState.questionScores,
      correct:        _gameState.correct,
      wrong:          _gameState.wrong,
      maxStreak:      _gameState.maxStreak,
      wrongList:      _gameState.wrongList,
      score:          _gameState.score
    });
  }
  /* ★ Snapshot incremental para torneos (paridad con daily) ★ */
  if (_gameState.isTournament && typeof TournamentAttempt !== 'undefined') {
    TournamentAttempt.update({
      currentIndex:   _gameState.currentIndex,
      questionScores: _gameState.questionScores,
      correct:        _gameState.correct,
      wrong:          _gameState.wrong,
      maxStreak:      _gameState.maxStreak,
      wrongList:      _gameState.wrongList,
      score:          _gameState.score
    });
  }
  /* ★ Snapshot incremental de la Maratón (anti-trampa force-kill / reinstalación) ★ */
  if (_gameState.isMarathon && typeof MarathonAttempt !== 'undefined') {
    MarathonAttempt.update({
      currentIndex: _gameState.currentIndex,
      correct:      _gameState.correct,
      wrong:        _gameState.wrong,
      maxStreak:    _gameState.maxStreak,
      wrongList:    _gameState.wrongList,
      score:        _gameState.score
    });
  }
  /* ★ Envío progresivo a Firebase — throttled para reducir escrituras ★ */
  if (_gameState.isDailyChallenge && typeof DailySync !== 'undefined') {
    DailySync.touch(_gameState.score);
  }

  return {
    isCorrect:    isCorrect,
    correctIndex: q.correctIndex,
    state:        getGameState(),
  };
}

/**
 * Registra el instante en que se muestra la pregunta actual.
 * Se usa en el reto diario para calcular el tiempo de respuesta.
 */
function setQuestionStartTime() {
  if (_gameState) _gameState.questionStartTime = Date.now();
}

/**
 * Avanza a la siguiente pregunta.
 * @returns {{ finished: boolean, state: object }}
 */
function advanceQuestion() {
  if (!_gameState) return { finished: true, state: null };
  _gameState.currentIndex++;
  _gameState.answered = false;

  if (_gameState.isTimeTrial) {
    /* En timetrial: ciclo infinito, nunca se pone finished (lo hace forceFinishGame) */
    if (_gameState.currentIndex >= _gameState.questions.length) {
      _gameState.currentIndex = 0;
    }
    return { finished: false, state: getGameState() };
  }

  if (_gameState.currentIndex >= _gameState.questions.length) {
    _gameState.finished = true;
  }
  return { finished: _gameState.finished, state: getGameState() };
}

/**
 * Fuerza el final de la partida (usado por el timer del contrarreloj).
 */
function forceFinishGame() {
  if (_gameState) _gameState.finished = true;
}

/**
 * Actualiza la puntuación final en el estado (p. ej. tras añadir el bonus de perfecta).
 * @param {number} score
 */
function applyFinalScore(score) {
  if (_gameState) _gameState.score = score;
}

/** Reinicia con los mismos parámetros. En daily preserva las preguntas originales del reto. */
function resetGameState() {
  if (!_gameState) return;
  var prebuilt = (_gameState.isDailyChallenge || _gameState.isReview || _gameState.isMarathon) ? _gameState.originalQuestions : null;
  initGame(_gameState.mode, _gameState.questions.length, prebuilt, _gameState.continent);
}
