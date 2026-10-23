/**
 * js/storage.js — localStorage abstraction
 */
var STORE_PREFIX = 'flagmaster_';

/**
 * Claves locales que forman el "progreso" del jugador (lo que se sincroniza
 * con el documento players/{id} de Firestore). Ver js/player-profile.js.
 * 'wrong_countries' (v1) no se incluye: se deriva siempre de la v2.
 */
var PROGRESS_STORAGE_KEYS = ['achievements', 'best_scores', 'daily', 'wrong_countries_v2', 'ranking', 'marathon'];

/* Observadores de escritura: permiten a PlayerProfile detectar cambios de
   progreso (fin de partida, sweeps, restauraciones…) sin acoplarse a cada
   punto de guardado. Registrar con onStorageSave(fn) → fn(key). */
var _storageSaveListeners = [];

function _isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
function _toNum(v, def) { return (typeof v === 'number' && isFinite(v)) ? v : def; }
function _toBool(v, def) { return (typeof v === 'boolean') ? v : def; }
function _toBoolOrNull(v, def) { return (v === null || typeof v === 'boolean') ? v : def; }
function _isNonEmptyString(v) { return typeof v === 'string' && v !== ''; }

function storageSave(key, value) {
  try { localStorage.setItem(STORE_PREFIX+key, JSON.stringify(value)); } catch(e) {}
  for (var i = 0; i < _storageSaveListeners.length; i++) {
    try { _storageSaveListeners[i](key); } catch(e) {}
  }
}
function onStorageSave(fn) {
  if (typeof fn === 'function') _storageSaveListeners.push(fn);
}
function storageLoad(key, def) {
  try {
    var raw = localStorage.getItem(STORE_PREFIX+key);
    return raw === null ? (def !== undefined ? def : null) : JSON.parse(raw);
  } catch(e) { return def !== undefined ? def : null; }
}

function storeSaveLang(lang) { storageSave('lang', lang); }

function loadSettings() {
  var defaults = {numQuestions:10,timerEnabled:false,timerDuration:15,soundEnabled:true,vibration:true,darkMode:null};
  var raw = storageLoad('settings', defaults);
  var saved = _isObj(raw) ? raw : {};
  saved = {
    numQuestions:  _toNum(saved.numQuestions, defaults.numQuestions),
    timerEnabled:  _toBool(saved.timerEnabled, defaults.timerEnabled),
    timerDuration: _toNum(saved.timerDuration, defaults.timerDuration),
    soundEnabled:  _toBool(saved.soundEnabled, defaults.soundEnabled),
    vibration:     _toBool(saved.vibration, defaults.vibration),
    darkMode:      _toBoolOrNull(saved.darkMode, defaults.darkMode)
  };
  /* darkMode null = nunca se ha guardado preferencia → usar sistema */
  if (saved.darkMode === null) {
    saved.darkMode = (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  }
  return saved;
}
function saveSettings(s) { storageSave('settings', s); }

function loadBestScore(mode)  {
  return _toNum(loadBestScores()[mode], 0);
}
function saveBestScore(mode, score) {
  var scores = loadBestScores();
  if (score > (scores[mode]||0)) { scores[mode]=score; storageSave('best_scores',scores); return true; }
  return false;
}
/** Mapa completo { modo: mejorPuntuación }. */
function loadBestScores() {
  var scores = storageLoad('best_scores',{});
  return _isObj(scores) ? scores : {};
}

function loadLastMode()      {
  var mode = storageLoad('last_mode','guess-country');
  return _isNonEmptyString(mode) ? mode : 'guess-country';
}
function saveLastMode(mode)  { storageSave('last_mode', mode); }

var _rankingCache = null;
var _MODE_ORDER = ['daily','guess-country','guess-flag','guess-capital','guess-country-from-capital','timetrial'];

function loadRanking()       {
  if (_rankingCache !== null) return _rankingCache;
  var list = storageLoad('ranking',[]);
  _rankingCache = Array.isArray(list) ? list : [];
  return _rankingCache;
}
function saveRanking(list)   {
  _rankingCache = Array.isArray(list) ? list : [];
  storageSave('ranking', _rankingCache);
}
function addRankingEntry(entry) {
  var list = loadRanking();
  list.push(entry);
  saveRanking(sortRankingEntries(list).slice(0,50));
}

/** Ordena (in-place) entradas de ranking: por modo y, dentro del modo, por puntuación. */
function sortRankingEntries(list) {
  list.sort(function(a,b) {
    var oa = _MODE_ORDER.indexOf(a.mode); if (oa === -1) oa = _MODE_ORDER.length;
    var ob = _MODE_ORDER.indexOf(b.mode); if (ob === -1) ob = _MODE_ORDER.length;
    if (oa !== ob) return oa - ob;
    var pa = (a.mode==='timetrial'||a.mode==='daily') ? a.score : (a.score/(a.total||1));
    var pb = (b.mode==='timetrial'||b.mode==='daily') ? b.score : (b.score/(b.total||1));
    return pb - pa;
  });
  return list;
}

function loadAchievements() {
  var def = {unlocked:[],stats:{total_correct:0,total_games:0,total_attempted:0,modes_played:[],daily_completed:0,max_time_attack:0,max_streak_ever:0,statsByMode:{}}};
  var raw = storageLoad('achievements', def);
  if (!_isObj(raw)) return def;
  var stats = _isObj(raw.stats) ? raw.stats : {};
  var statsByMode = {};
  if (_isObj(stats.statsByMode)) {
    Object.keys(stats.statsByMode).forEach(function (mode) {
      var entry = stats.statsByMode[mode];
      if (!_isNonEmptyString(mode) || !_isObj(entry)) return;
      statsByMode[mode] = {
        games:   Math.max(0, Math.floor(_toNum(entry.games, 0))),
        correct: Math.max(0, Math.floor(_toNum(entry.correct, 0))),
        wrong:   Math.max(0, Math.floor(_toNum(entry.wrong, 0)))
      };
    });
  }
  return {
    unlocked: Array.isArray(raw.unlocked) ? raw.unlocked.filter(_isNonEmptyString) : [],
    stats: {
      total_correct:   _toNum(stats.total_correct, 0),
      total_games:     _toNum(stats.total_games, 0),
      total_attempted: _toNum(stats.total_attempted, 0),
      modes_played:    Array.isArray(stats.modes_played) ? stats.modes_played.filter(_isNonEmptyString) : [],
      daily_completed: _toNum(stats.daily_completed, 0),
      max_time_attack: _toNum(stats.max_time_attack, 0),
      max_streak_ever: _toNum(stats.max_streak_ever, 0),
      statsByMode: statsByMode
    }
  };
}
function saveAchievements(d) { storageSave('achievements', d); }

function loadDailyStatus()   {
  var d = storageLoad('daily',{});
  return _isObj(d) ? d : {};
}
function saveDailyStatus(d)  { storageSave('daily', d); }
function getDailyKey() {
  var d=new Date();
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}
function isDailyCompleted() { return !!(loadDailyStatus()[getDailyKey()]); }
function markDailyCompleted(score) {
  var st=loadDailyStatus(); st[getDailyKey()]={score:score,ts:Date.now()}; saveDailyStatus(st);
}
function markDateCompleted(dateKey, score) {
  var st=loadDailyStatus(); st[dateKey]={score:score,ts:Date.now()}; saveDailyStatus(st);
}
function getDailyCompletedScore() { var d=loadDailyStatus()[getDailyKey()]; return d?d.score:null; }

/* ── Maratón (una partida por día, hasta el primer fallo) ──
 * 'marathon' es ESPEJO EXACTO de players/{id}.stats:
 *   bestStreak → maratonMejorRacha · games → maratonPartidas · lastPlayed → maratonUltimo
 * 'marathon_runs' es histórico solo local (top-20 de rachas), como 'ranking'. */
var MARATHON_RUNS_MAX = 20;

function _isDateKeyStr(v) { return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v); }

function loadMarathonStatus() {
  var raw = storageLoad('marathon', null);
  var m = _isObj(raw) ? raw : {};
  return {
    bestStreak: Math.max(0, Math.floor(_toNum(m.bestStreak, 0))),
    games:      Math.max(0, Math.floor(_toNum(m.games, 0))),
    lastPlayed: _isDateKeyStr(m.lastPlayed) ? m.lastPlayed : null
  };
}
function saveMarathonStatus(m) { storageSave('marathon', m); }

/** Candado diario: la Maratón de hoy ya se ha iniciado (y por tanto consumido). */
function isMarathonCompletedToday() { return loadMarathonStatus().lastPlayed === getDailyKey(); }

/**
 * Registra la partida de Maratón del día `dateKey` (por defecto hoy). Idempotente por día:
 * la partida solo cuenta una vez (se llama al EMPEZAR con racha 0 y al terminar con la
 * racha final); la mejor racha siempre es el máximo.
 */
function markMarathonCompleted(streak, dateKey) {
  var dk = _isDateKeyStr(dateKey) ? dateKey : getDailyKey();
  var m  = loadMarathonStatus();
  if (!m.lastPlayed || dk > m.lastPlayed) { m.games += 1; m.lastPlayed = dk; }
  m.bestStreak = Math.max(m.bestStreak, Math.max(0, Math.floor(_toNum(streak, 0))));
  saveMarathonStatus(m);
  return m;
}

function getMarathonRuns() {
  var list = storageLoad('marathon_runs', []);
  return Array.isArray(list) ? list.filter(_isObj) : [];
}
/** Añade una partida al histórico local (top-20 por racha). Una entrada por día. */
function addMarathonRun(run) {
  if (!_isObj(run) || !_isDateKeyStr(run.date)) return;
  var list = getMarathonRuns().filter(function (r) { return r.date !== run.date; });
  list.push({
    date:    run.date,
    streak:  Math.max(0, Math.floor(_toNum(run.streak, 0))),
    correct: Math.max(0, Math.floor(_toNum(run.correct, 0))),
    wrong:   Math.max(0, Math.floor(_toNum(run.wrong, 0))),
    ts:      _toNum(run.ts, Date.now())
  });
  list.sort(function (a, b) { return (b.streak - a.streak) || (b.ts - a.ts); });
  storageSave('marathon_runs', list.slice(0, MARATHON_RUNS_MAX));
}
function getMarathonBestStreak() { return loadMarathonStatus().bestStreak; }
/** Racha de la partida de hoy (null si hoy no se ha jugado o no hay registro local). */
function getMarathonTodayStreak() {
  if (!isMarathonCompletedToday()) return null;
  var today = getDailyKey();
  var runs = getMarathonRuns();
  for (var i = 0; i < runs.length; i++) if (runs[i].date === today) return runs[i].streak;
  return null;
}

/**
 * Calcula racha de días consecutivos completando el reto.
 * @param {object} [statusMap]  Mapa diario alternativo (por defecto, el local)
 */
function getDailyStreak(statusMap) {
  var status = _isObj(statusMap) ? statusMap : loadDailyStatus();
  var streak = 0;
  var d = new Date();
  /* empieza desde ayer si hoy no está completado, o desde hoy si sí */
  if (!status[getDailyKey()]) { d.setDate(d.getDate()-1); }
  for (var i = 0; i < 365; i++) {
    var key = d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
    if (status[key]) { streak++; d.setDate(d.getDate()-1); }
    else break;
  }
  return streak;
}

/* ── Estadísticas y países fallados ──────────────────────── */
function loadWrongCountries() {
  var d = storageLoad('wrong_countries', {});
  return _isObj(d) ? d : {};
}
function saveWrongCountries(d) { storageSave('wrong_countries', d); }
function recordWrongCountry(code) {
  var d = loadWrongCountries();
  d[code] = (d[code]||0) + 1;
  saveWrongCountries(d);
}
function getTopWrongCountries(n) {
  var d = loadWrongCountries();
  var arr = Object.keys(d).map(function(k){ return {code:k, count:d[k]}; });
  arr.sort(function(a,b){ return b.count-a.count; });
  return arr.slice(0, n||5);
}

/* ── Wrong countries v2: desglose por modo ───────────────── */

/**
 * Migra los datos v1 (wrong_countries) al nuevo esquema v2 una sola vez.
 * Si v2 ya existe, no hace nada.
 */
function _migrateWrongCountriesV2() {
  var v2 = storageLoad('wrong_countries_v2', null);
  if (_isObj(v2)) return;
  var v1 = loadWrongCountries();
  var migrated = {};
  Object.keys(v1).forEach(function(code) {
    migrated[code] = { total: _toNum(v1[code], 0), byMode: { '_legacy': _toNum(v1[code], 0) }, lastSeen: null };
  });
  storageSave('wrong_countries_v2', migrated);
}

function _loadWrongCountriesV2() {
  _migrateWrongCountriesV2();
  var d = storageLoad('wrong_countries_v2', {});
  return _isObj(d) ? d : {};
}

/**
 * Registra un fallo en v2 (con desglose por modo) y mantiene v1 sincronizado.
 * @param {string} code  Código de país (p.ej. 'ES')
 * @param {string} mode  Identificador de modo (p.ej. 'guess-flag')
 */
function recordWrongCountryV2(code, mode) {
  var d = _loadWrongCountriesV2();
  if (!_isObj(d[code])) {
    d[code] = { total: 0, byMode: {}, lastSeen: null };
  }
  d[code].total++;
  var safeMode = (typeof mode === 'string' && mode !== '') ? mode : '_unknown';
  d[code].byMode[safeMode] = (_toNum(d[code].byMode[safeMode], 0)) + 1;
  d[code].lastSeen = getDailyKey();
  storageSave('wrong_countries_v2', d);
  recordWrongCountry(code);
}

/**
 * Top N países fallados filtrados por un modo concreto.
 * @param {string} mode
 * @param {number} n
 * @returns {{ code:string, count:number }[]}
 */
function getTopWrongByMode(mode, n) {
  var d = _loadWrongCountriesV2();
  var arr = Object.keys(d).map(function(code) {
    var entry = d[code];
    var count = _isObj(entry) && _isObj(entry.byMode) ? _toNum(entry.byMode[mode], 0) : 0;
    return { code: code, count: count };
  }).filter(function(x) { return x.count > 0; });
  arr.sort(function(a, b) { return b.count - a.count; });
  return arr.slice(0, n || 5);
}

/**
 * Desglose completo de un país (total + por modo + lastSeen).
 * @param {string} code
 * @returns {{ total:number, byMode:object, lastSeen:string|null }|null}
 */
function getWrongCountrySummary(code) {
  var d = _loadWrongCountriesV2();
  return _isObj(d[code]) ? d[code] : null;
}

/**
 * Similar a getTopWrongCountries pero usando datos v2 (incluye byMode).
 * @param {number} n
 * @returns {{ code:string, count:number, byMode:object, lastSeen:string|null }[]}
 */
function getTopWrongCountriesV2(n) {
  var d = _loadWrongCountriesV2();
  var arr = Object.keys(d).map(function(code) {
    var entry = d[code];
    return {
      code: code,
      count: _isObj(entry) ? _toNum(entry.total, 0) : 0,
      byMode: (_isObj(entry) && _isObj(entry.byMode)) ? entry.byMode : {},
      lastSeen: (_isObj(entry) && entry.lastSeen) ? entry.lastSeen : null
    };
  });
  arr.sort(function(a, b) { return b.count - a.count; });
  return arr.slice(0, n || 5);
}

/**
 * Ratio de fallos por modo: { modeId: totalFailures }.
 * @returns {object}
 */
function getFailureRateByMode() {
  var d = _loadWrongCountriesV2();
  var result = {};
  Object.keys(d).forEach(function(code) {
    var entry = d[code];
    if (!_isObj(entry) || !_isObj(entry.byMode)) return;
    Object.keys(entry.byMode).forEach(function(mode) {
      result[mode] = (_toNum(result[mode], 0)) + _toNum(entry.byMode[mode], 0);
    });
  });
  return result;
}

/**
 * Estadísticas de los ocho modos (incluida la Maratón), combinando el histórico de fallos por modo.
 * @returns {{ mode:string, games:number, correct:number, wrong:number }[]}
 */
function getStatsByMode() {
  var modeOrder = ['daily','marathon','guess-country','guess-flag','timetrial','guess-capital','guess-country-from-capital','guess-silhouette'];
  var byMode = loadAchievements().stats.statsByMode;
  var failures = getFailureRateByMode();
  return modeOrder.map(function (mode) {
    var entry = _isObj(byMode[mode]) ? byMode[mode] : {};
    var wrong = Math.max(0, Math.floor(_toNum(entry.wrong, 0)));
    if (wrong === 0 && _toNum(failures[mode], 0) > 0) wrong = Math.floor(_toNum(failures[mode], 0));
    return {
      mode: mode,
      games: Math.max(0, Math.floor(_toNum(entry.games, 0))),
      correct: Math.max(0, Math.floor(_toNum(entry.correct, 0))),
      wrong: wrong
    };
  });
}

/* ── Snapshot de progreso (sincronización con Firestore) ─── */

/**
 * Foto del progreso local en su formato de almacenamiento.
 * La consume PlayerProfile para construir/fusionar el documento players/{id}.
 * @returns {{ achievements:object, bestScores:object, daily:object, wrongCountries:object, ranking:Array, marathon:object }}
 */
function loadProgressSnapshot() {
  return {
    achievements:   loadAchievements(),
    bestScores:     loadBestScores(),
    daily:          loadDailyStatus(),
    wrongCountries: _loadWrongCountriesV2(),
    ranking:        loadRanking().slice(),
    marathon:       loadMarathonStatus()
  };
}

/**
 * Sobrescribe el progreso local con un snapshot (p. ej. el descargado de Firestore).
 * Mantiene 'wrong_countries' (v1) coherente con la v2.
 * @param {object} snap  Mismo formato que loadProgressSnapshot()
 */
function saveProgressSnapshot(snap) {
  if (!_isObj(snap)) return;
  if (_isObj(snap.achievements)) saveAchievements(snap.achievements);
  if (_isObj(snap.bestScores))   storageSave('best_scores', snap.bestScores);
  if (_isObj(snap.daily))        saveDailyStatus(snap.daily);
  if (_isObj(snap.wrongCountries)) {
    storageSave('wrong_countries_v2', snap.wrongCountries);
    var v1 = {};
    Object.keys(snap.wrongCountries).forEach(function(code) {
      var entry = snap.wrongCountries[code];
      var total = _isObj(entry) ? _toNum(entry.total, 0) : 0;
      if (total > 0) v1[code] = total;
    });
    saveWrongCountries(v1);
  }
  if (Array.isArray(snap.ranking)) saveRanking(snap.ranking);
  if (_isObj(snap.marathon))      saveMarathonStatus(snap.marathon);
}

/**
 * true si el snapshot contiene algún dato de juego.
 * Distingue un usuario totalmente nuevo (Caso A) de uno con partidas previas (Caso B).
 * @param {object} snap  Mismo formato que loadProgressSnapshot()
 */
function hasProgressData(snap) {
  if (!_isObj(snap)) return false;
  var ach = _isObj(snap.achievements) ? snap.achievements : {};
  var st  = _isObj(ach.stats) ? ach.stats : {};
  return _toNum(st.total_games, 0) > 0 ||
    (Array.isArray(ach.unlocked) && ach.unlocked.length > 0) ||
    Object.keys(_isObj(snap.bestScores) ? snap.bestScores : {}).length > 0 ||
    Object.keys(_isObj(snap.daily) ? snap.daily : {}).length > 0 ||
    Object.keys(_isObj(snap.wrongCountries) ? snap.wrongCountries : {}).length > 0 ||
    (Array.isArray(snap.ranking) && snap.ranking.length > 0) ||
    (_isObj(snap.marathon) && _toNum(snap.marathon.games, 0) > 0);
}
