/**
 * site/js/i18n.js — Textos de la web (es / en). Idioma: el guardado, el del navegador o inglés.
 */
var SITE_STRINGS = {
  es: {
    tagline: 'Clasificación del directo de TikTok',
    hero_title: 'Juega en directo.<br><span>Sube al ranking del mes.</span>',
    hero_sub: 'Cada directo de FlagMaster en TikTok suma puntos: escribe A, B, C o D en el chat y cuanto antes aciertes, más ganas. ¡Búscate aquí!',
    play_small: 'Disponible en', play_big: 'Google Play',
    ios_small: 'Próximamente en', ios_big: 'App Store', soon: 'Pronto',
    follow_live: 'Ver los directos en TikTok',
    search_ph: 'Busca tu @usuario o nick…', search_none: 'No encontramos a nadie con ese nombre este mes',
    month_title: 'Ranking de {month}', month_prev: 'Mes anterior', month_next: 'Mes siguiente',
    empty_month: 'Este mes aún no ha habido directos. ¡El ranking empieza en el próximo!',
    last_champion: 'Campeón de {month}',
    b_points: 'Puntos', b_accuracy: 'Precisión', b_streak: 'Rachas', b_speed: 'Rapidez', b_loyal: 'Fieles', b_support: 'Apoyos',
    h_accuracy: 'Mínimo {n} respuestas en el mes', h_speed: 'Tiempo medio de acierto · mínimo {n} aciertos',
    h_streak: 'Más aciertos seguidos en un directo', h_loyal: 'Directos en los que ha jugado', h_support: 'Regalos (💎) y Me gusta',
    h_points: 'Cuanto antes aciertes, más puntos: 10, 8, 6, 5, 4, 3, 2 y luego 1',
    col_player: 'Jugador', pts: 'pts', lives_n: '{n} directos', live_1: '1 directo',
    show_more: 'Ver más', nobody: 'Todavía no hay nadie en esta tabla',
    stats_title: 'El mes en números',
    s_lives: 'Directos', s_players: 'Jugadores', s_new: 'Nuevos', s_answers: 'Respuestas', s_accuracy: 'Acierto global',
    s_likes: 'Me gusta', s_peak: 'Récord de espectadores', s_gifts: 'Diamantes',
    flags_title: 'Banderas del mes', hardest: 'Las más difíciles', easiest: 'Las más fáciles',
    lives_title: 'Directos del mes', winner: 'Ganador', players_n: '{n} jugadores',
    fame_title: 'Salón de la fama', champions: 'Campeones de cada mes', records: 'Récords históricos',
    r_bestLive: 'Más puntos en un directo', r_streak: 'Racha más larga', r_fastest: 'Acierto más rápido',
    r_fastestAvg: 'Mejor tiempo medio', r_loyal: 'Más directos jugados', r_supporter: 'Mayor apoyo',
    alltime_title: 'Clasificación histórica',
    me_btn: 'Soy yo', me_on: 'Eres tú', back: '← Volver al ranking',
    p_month: 'Este mes', p_alltime: 'Histórico', p_pos: 'Puesto', p_points: 'Puntos', p_acc: 'Acierto',
    p_streak: 'Mejor racha', p_avg: 'Tiempo medio', p_fast: 'Más rápido', p_lives: 'Directos', p_first: 'Veces 1º',
    p_modes: 'Por tipo de pregunta', p_history: 'Meses anteriores', p_progress: 'Puntos por directo',
    p_not_found: 'No encontramos a este jugador.',
    'mode_guess-country': '¿De qué país es la bandera?', 'mode_guess-flag': '¿Cuál es la bandera?', 'mode_guess-capital': 'Capitales', 'mode_guess-country-from-capital': 'País por su capital',
    cta_title: '¿Quieres entrenar entre directo y directo?',
    cta_sub: 'Descarga FlagMaster gratis: banderas, capitales y siluetas de todo el mundo.',
    optout: '¿Prefieres no aparecer? Escribe <b>!optout</b> en el chat del directo y desaparecerás de esta web.',
    rank_cmd: 'Escribe <b>!yo</b> en el chat durante el directo para ver tu puesto en pantalla.',
    updated: 'Actualizado {date}', error: 'No se pudieron cargar los datos. Prueba a recargar la página.'
  },
  en: {
    tagline: 'TikTok LIVE leaderboard',
    hero_title: 'Play live.<br><span>Climb the monthly ranking.</span>',
    hero_sub: 'Every FlagMaster TikTok LIVE adds up: type A, B, C or D in the chat, and the faster you get it right, the more points you earn. Find yourself here!',
    play_small: 'Get it on', play_big: 'Google Play',
    ios_small: 'Coming soon to the', ios_big: 'App Store', soon: 'Soon',
    follow_live: 'Watch the LIVEs on TikTok',
    search_ph: 'Search your @username or nickname…', search_none: 'Nobody with that name this month',
    month_title: '{month} ranking', month_prev: 'Previous month', month_next: 'Next month',
    empty_month: 'No LIVEs yet this month. The ranking starts with the next one!',
    last_champion: '{month} champion',
    b_points: 'Points', b_accuracy: 'Accuracy', b_streak: 'Streaks', b_speed: 'Speed', b_loyal: 'Loyal', b_support: 'Supporters',
    h_accuracy: 'At least {n} answers this month', h_speed: 'Average time to a correct answer · at least {n} correct',
    h_streak: 'Most correct answers in a row in one LIVE', h_loyal: 'LIVEs played', h_support: 'Gifts (💎) and likes',
    h_points: 'The faster you answer right, the more points: 10, 8, 6, 5, 4, 3, 2, then 1',
    col_player: 'Player', pts: 'pts', lives_n: '{n} LIVEs', live_1: '1 LIVE',
    show_more: 'Show more', nobody: 'Nobody on this board yet',
    stats_title: 'The month in numbers',
    s_lives: 'LIVEs', s_players: 'Players', s_new: 'New', s_answers: 'Answers', s_accuracy: 'Overall accuracy',
    s_likes: 'Likes', s_peak: 'Peak viewers', s_gifts: 'Diamonds',
    flags_title: 'Flags of the month', hardest: 'Hardest', easiest: 'Easiest',
    lives_title: 'LIVEs this month', winner: 'Winner', players_n: '{n} players',
    fame_title: 'Hall of fame', champions: 'Monthly champions', records: 'All-time records',
    r_bestLive: 'Most points in one LIVE', r_streak: 'Longest streak', r_fastest: 'Fastest correct answer',
    r_fastestAvg: 'Best average time', r_loyal: 'Most LIVEs played', r_supporter: 'Top supporter',
    alltime_title: 'All-time ranking',
    me_btn: 'This is me', me_on: 'That\'s you', back: '← Back to the ranking',
    p_month: 'This month', p_alltime: 'All time', p_pos: 'Rank', p_points: 'Points', p_acc: 'Accuracy',
    p_streak: 'Best streak', p_avg: 'Average time', p_fast: 'Fastest', p_lives: 'LIVEs', p_first: 'Times 1st',
    p_modes: 'By question type', p_history: 'Previous months', p_progress: 'Points per LIVE',
    p_not_found: 'We couldn\'t find this player.',
    'mode_guess-country': 'Whose flag is it?', 'mode_guess-flag': 'Which flag?', 'mode_guess-capital': 'Capitals', 'mode_guess-country-from-capital': 'Country from its capital',
    cta_title: 'Want to practise between LIVEs?',
    cta_sub: 'Download FlagMaster for free: flags, capitals and silhouettes from all over the world.',
    optout: 'Rather not appear? Type <b>!optout</b> in the LIVE chat and you will disappear from this site.',
    rank_cmd: 'Type <b>!me</b> in the chat during the LIVE to see your rank on screen.',
    updated: 'Updated {date}', error: 'Could not load the data. Try reloading the page.'
  }
};

var SiteI18n = (function () {
  var KEY = 'fm_site_lang';
  var lang = 'en';
  try { lang = localStorage.getItem(KEY) || ''; } catch (e) { lang = ''; }
  if (!SITE_STRINGS[lang]) lang = (navigator.language || '').slice(0, 2).toLowerCase() === 'es' ? 'es' : 'en';

  function t(key, vars) {
    var s = SITE_STRINGS[lang][key];
    if (s === undefined) s = SITE_STRINGS.en[key] !== undefined ? SITE_STRINGS.en[key] : key;
    if (vars) Object.keys(vars).forEach(function (k) { s = s.split('{' + k + '}').join(vars[k]); });
    return s;
  }

  function set(l) {
    if (!SITE_STRINGS[l]) return;
    lang = l;
    try { localStorage.setItem(KEY, l); } catch (e) { /* sin almacenamiento: solo esta visita */ }
  }

  return { t: t, set: set, lang: function () { return lang; } };
})();
