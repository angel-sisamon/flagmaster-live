/**
 * server/src/live-page.js — Página del directo = index.html del juego + capa LIVE.
 *
 * El juego (repo flag-master) no sabe nada del directo. Al pedir "/" se lee su www/index.html y se
 * le añaden la hoja de estilos y las pantallas/scripts de client/ (servidos en /live/). Se lee en
 * cada petición: los cambios en el juego o en client/ se ven recargando la página.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const LIVE_SCRIPTS = ['live-i18n.js', 'live-fireworks.js', 'live-voice.js', 'live-mode.js'];

function composeLivePage(gameDir, clientDir) {
  const html = fs.readFileSync(path.join(gameDir, 'index.html'), 'utf8');
  const screens = fs.readFileSync(path.join(clientDir, 'live-screens.html'), 'utf8');
  if (!html.includes('</head>') || !html.includes('</body>')) {
    throw new Error(`${path.join(gameDir, 'index.html')} no tiene </head> o </body>`);
  }
  const css = '  <link rel="stylesheet" href="live/live-mode.css"/>\n';
  // Las pantallas van antes que los scripts LIVE, que se ejecutan después de los del juego (main.js)
  const body = '\n<!-- ═══ Capa FlagMaster LIVE (flagmaster-live/client) ═══ -->\n' + screens +
    LIVE_SCRIPTS.map(f => `<script src="live/${f}"></script>`).join('\n') + '\n';
  // Reemplazo con función: un "$" en el HTML no debe interpretarse como patrón de replace()
  return html.replace('</head>', () => css + '</head>').replace(/<\/body>(?![\s\S]*<\/body>)/, () => body + '</body>');
}

module.exports = { composeLivePage };
