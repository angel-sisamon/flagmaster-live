#!/usr/bin/env node
/**
 * scripts/sync-game.js — Copia en game/ la versión del juego que se usa en el directo.
 *
 * El directo es independiente del repo flag-master: juega con su propia copia (game/), que solo cambia
 * cuando tú lo decides. Para traer la última versión del juego:
 *
 *   npm run sync:game                      → rama development de ../flagmaster-capacitor/www
 *   npm run sync:game -- main              → otra rama, tag o commit
 *   npm run sync:game -- development "C:\ruta\al\repo\www"
 *
 * Se copia desde git (no desde la carpeta), así que da igual en qué rama tengas el juego abierto ni lo
 * que tengas sin guardar. Solo lo que necesita la página: index.html, css, js y assets (sin el mapa
 * de siluetas, que el directo no usa). Después revisa el cambio con git diff y haz commit.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'game');
const REF = process.argv[2] || 'development';
const REPO = path.resolve(process.argv[3] || path.join(ROOT, '..', 'flagmaster-capacitor', 'www'));
const INCLUDE = ['index.html', 'manifest.json', 'css', 'js', 'assets'];
const EXCLUDE = new Set(['assets/world.svg', 'assets/README.md']);

const git = (...args) => execFileSync('git', ['-C', REPO, ...args], { maxBuffer: 64 * 1024 * 1024 });

function main() {
  const commit = git('rev-parse', '--verify', `${REF}^{commit}`).toString().trim();
  const files = git('ls-tree', '-r', '--name-only', commit, '--', ...INCLUDE).toString()
    .split('\n').filter(f => f && !EXCLUDE.has(f));
  if (!files.includes('index.html')) throw new Error(`${REF} no tiene index.html en ${REPO}`);

  fs.rmSync(OUT, { recursive: true, force: true });
  let bytes = 0;
  for (const f of files) {
    const data = git('show', `${commit}:${f}`);
    fs.mkdirSync(path.dirname(path.join(OUT, f)), { recursive: true });
    fs.writeFileSync(path.join(OUT, f), data);
    bytes += data.length;
  }

  const config = fs.readFileSync(path.join(OUT, 'js', 'config.js'), 'utf8');
  const version = (config.match(/version\s*=\s*["']([^"']+)/) || [])[1] || '?';
  const info = { version, ref: REF, commit, date: git('show', '-s', '--format=%cI', commit).toString().trim(), syncedAt: new Date().toISOString() };
  fs.writeFileSync(path.join(OUT, 'VERSION.json'), JSON.stringify(info, null, 2) + '\n');
  console.log(`✅ Juego ${version} (${REF} @ ${commit.slice(0, 7)}) copiado en game/: ${files.length} ficheros, ${(bytes / 1048576).toFixed(1)} MB`);
  console.log('   Revisa con "git status" y haz commit para dejarlo fijado.');
}

try {
  main();
} catch (e) {
  console.error(`❌ No se pudo copiar el juego: ${e.message}`);
  process.exit(1);
}
