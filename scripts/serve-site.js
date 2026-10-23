#!/usr/bin/env node
/**
 * scripts/serve-site.js — Vista previa local de la web (la misma carpeta que publica GitHub Pages).
 *   npm run serve:site   → http://localhost:8080
 */

'use strict';

const path = require('path');
const express = require('express');

const PORT = Number(process.env.SITE_PORT) || 8080;
const app = express();
app.use(express.static(path.join(__dirname, '..', 'site'), { etag: false, maxAge: 0 }));
app.listen(PORT, () => console.log(`🌐 Web de clasificaciones en http://localhost:${PORT}`));
