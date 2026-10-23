/**
 * js/modes.js — Registro centralizado de modos de juego.
 *
 * Punto único de verdad para la configuración de modos.
 * Para añadir un nuevo modo de juego:
 *   1. Añade su entrada en MODE_I18N con las claves de traducción.
 *   2. Añade sus traducciones en i18n.js.
 *   3. Añádelo en el grupo correspondiente de MODE_GROUPS
 *      o como nuevo MODE_SOLO si es un modo independiente.
 *
 * Depende de: i18n.js (t() se invoca en tiempo de uso, no de carga)
 */

var MODE_GROUPS = [
  {
    id: 'classic', icon: '🎮', nameKey: 'group_classic', expanded: true,
    modes: [
      { id:'guess-country',              visualBig:'🌍', active:true },
      { id:'guess-flag',                 visualBig:'🚩', active:true },
      { id:'guess-silhouette',           visualBig:'🗺️', active:true },
      { id:'timetrial',                  visualBig:'⚡', active:true },
      { id:'guess-capital',              visualBig:'🏛️', active:true },
      { id:'guess-country-from-capital', visualBig:'📍', active:true },
    ]
  },
];

var MODE_SOLO = { id:'daily', visualBig:'📅', active:true };

/* Maratón: modo independiente (una partida al día, hasta el primer fallo). Ver js/marathon.js */
var MODE_MARATHON = { id:'marathon', visualBig:'🏃', active:true };

/**
 * Claves i18n para cada modo (nombre y descripción).
 * Para registrar un nuevo modo añade aquí su entrada; el resto
 * del sistema (menú, stats, duelos) lo detectará automáticamente.
 */
var MODE_I18N = {
  'guess-country':              { name:'mode_guess_country',        desc:'mode_guess_country_desc' },
  'guess-flag':                 { name:'mode_guess_flag',           desc:'mode_guess_flag_desc' },
  'guess-silhouette':           { name:'mode_guess_silhouette',     desc:'mode_guess_silhouette_desc' },
  'timetrial':                  { name:'mode_time_attack',          desc:'mode_time_attack_desc' },
  'guess-capital':              { name:'mode_guess_capital',        desc:'mode_guess_capital_desc' },
  'guess-country-from-capital': { name:'mode_guess_capital_from',   desc:'mode_guess_capital_from_desc' },
  'daily':                      { name:'mode_daily',                desc:'mode_daily_desc' },
  'marathon':                   { name:'mode_marathon',             desc:'mode_marathon_desc' },
};

/**
 * Devuelve el emoji/visual del modo dado su id.
 * @param {string} id
 * @returns {string}
 */
function getModeVisual(id) {
  for (var g = 0; g < MODE_GROUPS.length; g++) {
    for (var m = 0; m < MODE_GROUPS[g].modes.length; m++) {
      if (MODE_GROUPS[g].modes[m].id === id) return MODE_GROUPS[g].modes[m].visualBig;
    }
  }
  if (MODE_SOLO.id === id) return MODE_SOLO.visualBig;
  if (MODE_MARATHON.id === id) return MODE_MARATHON.visualBig;
  return '🌍';
}

/**
 * Devuelve el nombre traducido del modo.
 * Requiere que t() esté disponible (i18n.js ya cargado).
 * @param {string} id
 * @returns {string}
 */
function getModeDisplayName(id) {
  var keys = MODE_I18N[id];
  return keys ? t(keys.name) : (id || '?');
}
