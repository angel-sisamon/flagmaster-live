#!/usr/bin/env node
/**
 * scripts/publish.js — Sube a GitHub los directos que no se pudieron publicar al cerrar el servidor.
 *   npm run publish
 */

'use strict';

const path = require('path');
const { publishData } = require('../server/src/publisher');

publishData(path.join(__dirname, '..'), 'directos pendientes')
  .then(r => console.log({
    published: '🚀 Publicado: la web se actualiza en 1-2 minutos',
    committed: '💾 Guardado en git local (hay commits de código sin subir: haz "git push")',
    nothing: '✅ No hay nada pendiente',
  }[r]))
  .catch(err => { console.error('❌', err.message); process.exit(1); });
