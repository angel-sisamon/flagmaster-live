/**
 * server/src/questions.js — Preguntas del directo con los mismos datos del juego.
 *
 * countries-data.js aporta COUNTRIES y daily.js la mezcla de modos del reto diario. Ambos solo
 * declaran variables y funciones, así que se evalúan en un sandbox: servidor y cliente nunca
 * se desincronizan en nombres ni banderas.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadGameData(gameDir) {
  const files = [path.join(gameDir, 'js', 'countries-data.js'), path.join(gameDir, 'js', 'daily.js')];
  const sandbox = {};
  vm.createContext(sandbox);
  for (const file of files) vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file });
  if (!Array.isArray(sandbox.COUNTRIES) || sandbox.COUNTRIES.length < 4) {
    throw new Error('countries-data.js no contiene un array COUNTRIES válido');
  }
  if (!Array.isArray(sandbox.DAILY_MIXED_MODES) || !Array.isArray(sandbox.DAILY_MIXED_COUNTS)) {
    throw new Error('daily.js no define DAILY_MIXED_MODES / DAILY_MIXED_COUNTS');
  }
  return {
    countries: sandbox.COUNTRIES,
    modes: Array.from(sandbox.DAILY_MIXED_MODES),
    modeCounts: Array.from(sandbox.DAILY_MIXED_COUNTS),
  };
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function publicCountry(c) {
  return { code: c.code, flag: c.flag, names: c.names, capitals: c.capitals };
}

function createQuestionFactory(data) {
  // Evita repetir países hasta agotar la baraja
  let deck = [];
  function nextCountry() {
    if (!deck.length) deck = shuffle(data.countries);
    return deck.pop();
  }

  // Bolsa de modos con la misma proporción que el reto diario (4+4+4+3): cada 15 rondas
  // salen todos los modos en esa proporción, en orden aleatorio
  let modeBag = [];
  function nextMode() {
    if (!modeBag.length) {
      data.modes.forEach((m, i) => { for (let k = 0; k < data.modeCounts[i]; k++) modeBag.push(m); });
      modeBag = shuffle(modeBag);
    }
    return modeBag.pop();
  }

  return function buildQuestion() {
    const correct = nextCountry();
    const distractors = shuffle(data.countries.filter(c => c.code !== correct.code)).slice(0, 3);
    const options = shuffle([correct, ...distractors]);
    return {
      mode: nextMode(),
      correct: publicCountry(correct),   // el cliente lo necesita para pintar el enunciado del modo
      options: options.map(publicCountry),
      correctIndex: options.findIndex(o => o.code === correct.code),
    };
  };
}

module.exports = { loadGameData, createQuestionFactory };
