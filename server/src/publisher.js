/**
 * server/src/publisher.js — Sube data/ al repo para que GitHub Actions regenere la web.
 *
 * git add data → commit → pull --rebase → push, con las credenciales de git del PC.
 * Si algo falla (sin red, conflicto…) los ficheros siguen en disco: se reintenta en el siguiente
 * arranque del servidor o a mano con "npm run publish".
 */

'use strict';

const { execFile } = require('child_process');

function git(cwd, args) {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, windowsHide: true, timeout: 60000 }, (err, stdout, stderr) => {
      if (err) {
        err.message = `git ${args.join(' ')}: ${(stderr || err.message).trim()}`;
        return reject(err);
      }
      resolve(stdout.trim());
    });
  });
}

const DATA_COMMIT_PREFIX = 'live: ';

/* Commits locales sin subir; null si la rama no tiene upstream */
async function unpushedSubjects(repoDir) {
  try {
    const out = await git(repoDir, ['log', '--format=%s', '@{u}..HEAD']);
    return out ? out.split('\n') : [];
  } catch (e) {
    return null;
  }
}

/* Devuelve 'published' | 'nothing' | 'committed' (sin push) o lanza si falla git.
 * Solo hace push si todo lo pendiente son commits de datos: nunca sube código a medias. */
async function publishData(repoDir, reason, opts) {
  opts = opts || {};
  await git(repoDir, ['add', '--', 'data']);
  const staged = await git(repoDir, ['diff', '--cached', '--name-only', '--', 'data']);
  if (staged) await git(repoDir, ['commit', '-m', DATA_COMMIT_PREFIX + reason, '--', 'data']);
  const pending = await unpushedSubjects(repoDir);
  if (pending === null) throw new Error('la rama no tiene upstream (haz un primer "git push -u origin main")');
  if (!pending.length) return 'nothing';
  if (opts.push === false) return 'committed';
  if (pending.some(s => !s.startsWith(DATA_COMMIT_PREFIX))) {
    console.warn('⚠️  Hay commits de código sin subir: los datos se quedan en git local hasta que hagas "git push"');
    return 'committed';
  }
  await git(repoDir, ['pull', '--rebase', '--autostash']);
  await git(repoDir, ['push']);
  return 'published';
}

module.exports = { publishData, git };
