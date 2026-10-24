/**
 * server/src/chatbot/brain.js — Qué dice el bot y cuándo (lógica pura, sin red ni temporizadores).
 *
 *   detectGreeting(text)          ¿es un saludo? (en, es, pt, fr, it, de... aunque el bot responda en inglés)
 *   createCountryMatcher(list)    ¿el mensaje es el nombre de un país? (todos los idiomas de COUNTRIES)
 *   loadPhrases(lang)             phrases/<lang>.json con lo que falte tomado de en.json, ya filtrado
 *   createPhrasePicker(phrases)   frase aleatoria por categoría sin repetir hasta agotarlas
 *
 * Para añadir un idioma de respuesta basta con phrases/<idioma>.json (CHATBOT_LANG); los saludos que se
 * reconocen en el chat no dependen de él.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { blockedReason } = require('./content-filter');

const PHRASES_DIR = path.join(__dirname, 'phrases');
const FALLBACK_LANG = 'en';
const CATEGORIES = ['greetings', 'game_rules_reminder', 'idle_chat', 'round_hard', 'round_easy',
  'game_start', 'game_mid', 'game_final_stretch', 'game_last_round', 'game_end', 'game_end_winner'];
// Variable obligatoria por categoría ({user} = @ de quien escribe, {winner} = nick de quien gana)
const NEEDS_VAR = { greetings: '{user}', game_rules_reminder: '{user}', game_end_winner: '{winner}' };
const MAX_GREETING_WORDS = 6;   // "hola a todos desde méxico" sí; una frase larga que empieza por "hey" no
const MAX_MESSAGE_CHARS = 150;  // límite de un comentario de TikTok

// TikTok LIVE Studio pinta los emojis como una X: los mensajes van sin ellos (banderas, tonos de piel, ZWJ incluidos)
const EMOJI_RE = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}️‍⃣]/gu;

function stripEmoji(text) {
  return String(text || '').replace(EMOJI_RE, '').replace(/\s+([,.!?:])/g, '$1').replace(/\s{2,}/g, ' ').trim();
}

/* minúsculas, sin acentos, sin emojis ni signos: "¡¡Holaaa!! 👋" → "holaaa" */
function normalize(text) {
  return String(text || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, ' ')
    .replace(/'/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Las letras repetidas se admiten con + ("holaaa", "heyyy", "buenaaas")
const GREETING_RE = new RegExp('^(?:' + [
  // inglés
  'h+i+', 'h+e+y+', 'h+e+l+o+u?', 'h+e+l+l+o+', 'hiya', 'howdy', 'yo+$', 's+u+p+', 'wh?at?s+ ?u+p+', 'was+u+p+',
  'good (?:morning|afternoon|evening|night)', 'greetings', 'gm',
  // español
  'h+o+l+a+s?', 'h+o+l+i+s?', 'o+l+a+', 'b+u+e+n+a+s+', 'w+e+n+a+s+', 'buen(?:os)? dias?', 'que tal', 'que onda',
  'saludos', 'muy buenas',
  // portugués / francés / italiano / alemán / otros
  'o+i+e?', 'bom dia', 'boa (?:tarde|noite)', 'e ai', 'salut', 'bonjour', 'bonsoir', 'coucou', 'c+i+a+o+',
  'buongiorno', 'buonasera', 'hallo', 'servus', 'moin', 'guten (?:morgen|tag|abend)', 'merhaba', 'selam',
  'salam', 'salaam', 'marhaba', 'namaste', 'privet', 'ahoj', 'czesc', 'hej',
].join('|') + ')(?: |$)');

function detectGreeting(text) {
  const n = normalize(text);
  if (!n || n.split(' ').length > MAX_GREETING_WORDS) return false;
  return GREETING_RE.test(n);
}

/* Nombre de país escrito en lugar de la letra: "España", "spain!!", "🇪🇸 Spain", "es españa" no (frase) */
function createCountryMatcher(countries) {
  const byName = new Map();
  for (const c of countries || []) {
    for (const name of Object.values(c.names || {})) {
      const n = normalize(name);
      if (n.length >= 3) byName.set(n, c.code);   // evita choques con letras sueltas o códigos cortos
    }
  }
  return text => byName.get(normalize(text)) || null;
}

function readPhraseFile(lang) {
  const file = path.join(PHRASES_DIR, `${lang}.json`);
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (err) {
    if (err.code !== 'ENOENT') console.warn(`⚠️  Chatbot: no se pudo leer ${file}: ${err.message}`);
    return null;
  }
}

/* Devuelve { categoría: [frases] } con lo prohibido y lo que no encaja ya descartado (y avisado) */
function loadPhrases(lang, { log = console.warn } = {}) {
  const base = readPhraseFile(FALLBACK_LANG) || {};
  const own = lang && lang !== FALLBACK_LANG ? readPhraseFile(lang) : null;
  if (lang && lang !== FALLBACK_LANG && !own) log(`⚠️  Chatbot: no hay phrases/${lang}.json, se usa inglés`);
  const out = {};
  for (const cat of CATEGORIES) {
    const list = own && Array.isArray(own[cat]) && own[cat].length ? own[cat] : base[cat] || [];
    out[cat] = list.filter(p => {
      const reason = phraseProblem(cat, p);
      if (reason) log(`⚠️  Chatbot: frase descartada (${cat}, ${reason}): ${p}`);
      return !reason;
    });
  }
  return out;
}

function phraseProblem(category, phrase) {
  if (typeof phrase !== 'string' || !phrase.trim()) return 'vacía';
  const blocked = blockedReason(phrase.replace(/\{\w+\}/g, ''));
  if (blocked) return `contenido no permitido /${blocked}/`;
  if (NEEDS_VAR[category] && !phrase.includes(NEEDS_VAR[category])) return `falta ${NEEDS_VAR[category]}`;
  if (phrase.length > MAX_MESSAGE_CHARS - 30) return 'demasiado larga';
  return null;
}

function shuffle(arr, random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* Bolsa barajada por categoría: no repite una frase hasta haber dicho todas (ni la última al rebarajar) */
function createPhrasePicker(phrases, { random = Math.random } = {}) {
  const bags = new Map();
  const last = new Map();
  return function pick(category, vars) {
    const all = phrases[category] || [];
    if (!all.length) return null;
    let bag = bags.get(category);
    if (!bag || !bag.length) {
      bag = shuffle(all, random);
      if (bag.length > 1 && bag[bag.length - 1] === last.get(category)) bag.unshift(bag.pop());
      bags.set(category, bag);
    }
    const phrase = bag.pop();
    last.set(category, phrase);
    return render(phrase, vars);
  };
}

/* Un solo renglón y dentro del límite de TikTok; {user} → @usuario, {winner} → nick... */
function render(phrase, vars) {
  const text = phrase
    .replace(/\{(\w+)\}/g, (m, name) => (vars && vars[name] != null ? String(vars[name]).replace(/\s+/g, ' ').trim() : ''))
    .replace(/\s+/g, ' ').trim();
  const clean = stripEmoji(text);
  return clean.length > MAX_MESSAGE_CHARS ? clean.slice(0, MAX_MESSAGE_CHARS - 1) + '…' : clean;
}

module.exports = { normalize, stripEmoji, detectGreeting, createCountryMatcher, loadPhrases, createPhrasePicker, CATEGORIES };
