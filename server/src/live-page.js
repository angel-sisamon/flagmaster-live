/**
 * server/src/live-page.js — Página del directo = index.html del juego + capa LIVE.
 *
 * El juego (copia en game/) no sabe nada del directo. Al pedir "/" se lee su index.html y se le añaden
 * la hoja de estilos y las pantallas/scripts de client/ (servidos en /live/), y se desactiva el aviso de
 * actualización obligatoria. Se lee en cada petición: los cambios se ven recargando la página.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const LIVE_SCRIPTS = ['live-i18n.js', 'live-fireworks.js', 'live-voice.js', 'live-mode.js'];

/* La copia del juego del directo es fija: sin esto, el día que la app pida una versión mínima más alta
 * (Firestore app_config) el directo quedaría bloqueado con "Actualización requerida". Va justo antes de
 * main.js, que es quien llama a UpdateChecker.check() al arrancar. */
const NO_UPDATE_CHECK = '<script>if (window.UpdateChecker) UpdateChecker.check = function () {' +
  " return Promise.resolve({ status: 'ok', blocked: false, data: null }); };</script>";
const UPDATE_CHECKER_TAG = /<script src="js\/update-checker\.js"><\/script>/;

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
  // Reemplazos con función: un "$" en el HTML no debe interpretarse como patrón de replace()
  return html.replace(UPDATE_CHECKER_TAG, tag => tag + '\n' + NO_UPDATE_CHECK)
    .replace('</head>', () => css + '</head>')
    .replace(/<\/body>(?![\s\S]*<\/body>)/, () => body + '</body>');
}

module.exports = { composeLivePage };
