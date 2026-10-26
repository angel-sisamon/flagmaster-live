/**
 * scripts/voices-check.js — Revisa el banco de locuciones (npm run voices:check).
 *
 * Transcribe cada audio de client/voices/<lang>/index.json con Gemini y marca los sospechosos:
 * faltan palabras de la frase, sobran (p. ej. lee la indicación de estilo), no se oye el país,
 * o dura demasiado para su texto. Solo revisa lo nuevo o cambiado (resultados en .voices-cache/check.json).
 *
 *   npm run voices:check                      revisa y lista los sospechosos
 *   npm run voices -- --redo <id>,<id>        regenera los que no convenzan
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const API_KEY = process.env.GEMINI_API_KEY;
const MODEL = 'gemini-3.8-flash';
const CONCURRENCY = 4;
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'client', 'voices', 'phrases.json'), 'utf8'));
const OUT_DIR = path.join(ROOT, 'client', 'voices', cfg.lang);
const CHECK_FILE = path.join(ROOT, '.voices-cache', 'check.json');

function words(s) {
  return s.replace(/<[^>]*>|\([^)]*\)/g, ' ').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/'/g, '').replace(/[^a-z0-9 ]+/g, ' ').trim().split(/\s+/).filter(Boolean);
}

async function transcribe(file, tries = 4) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': API_KEY },
    body: JSON.stringify({ contents: [{ parts: [
      { inlineData: { mimeType: 'audio/ogg', data: fs.readFileSync(file).toString('base64') } },
      { text: 'Transcribe this audio exactly, in one line. Mark non-speech sounds in parentheses, e.g. (laugh), (sigh), (cough).' }
    ] }] })
  });
  const json = await res.json();
  if ((res.status === 429 || res.status >= 500) && tries > 0) {
    await new Promise(r => setTimeout(r, 15000));
    return transcribe(file, tries - 1);
  }
  if (!res.ok) throw new Error(`${res.status} ${json.error ? json.error.message : ''}`);
  return json.candidates[0].content.parts.map(p => p.text || '').join(' ').trim();
}

/* Problemas detectados comparando texto esperado y transcripción */
function problems(clip, heard) {
  const out = [];
  const want = words(clip.text), got = words(heard);
  const gotSet = new Set(got);
  const missing = want.filter(w => !gotSet.has(w));
  if (missing.length > Math.max(1, want.length * 0.2)) out.push('faltan: ' + missing.join(' '));
  if (got.length > want.length + 4) out.push(`sobran palabras (${got.length} vs ${want.length})`);
  if (clip.country) {
    const name = words(cfg.spokenNames[clip.country] || '').filter(w => w !== 'the');
    const country = name.length ? name : want.filter(w => !words(clip.template.replace('{N}', '')).includes(w));
    if (country.some(w => !gotSet.has(w))) out.push('país no reconocido');
  }
  if (/\((cough|throat|sneeze|hiccup)/i.test(heard)) out.push('ruido: ' + heard.match(/\((cough|throat|sneeze|hiccup)[^)]*\)/i)[0]);
  if (clip.ms > clip.text.replace(/<[^>]*>/g, '').length * 110 + 2500) out.push(`muy largo (${(clip.ms / 1000).toFixed(1)} s)`);
  return out;
}

async function main() {
  if (!API_KEY) { console.error('Falta GEMINI_API_KEY en .env'); process.exit(1); }
  const index = JSON.parse(fs.readFileSync(path.join(OUT_DIR, 'index.json'), 'utf8'));
  const checks = fs.existsSync(CHECK_FILE) ? JSON.parse(fs.readFileSync(CHECK_FILE, 'utf8')) : {};
  const ids = Object.keys(index.clips);
  const todo = ids.filter(id => !checks[id] || checks[id].text !== index.clips[id].text || checks[id].ms !== index.clips[id].ms);
  console.log(`🔎 ${ids.length} audios, ${todo.length} por revisar`);

  let n = 0;
  const queue = todo.slice();
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    for (let id; (id = queue.shift());) {
      const clip = index.clips[id];
      try {
        const heard = await transcribe(path.join(OUT_DIR, clip.file));
        checks[id] = { text: clip.text, ms: clip.ms, heard, problems: problems(clip, heard) };
      } catch (e) {
        console.log(`  ✘ ${id}: ${e.message}`);
      }
      if (++n % 50 === 0) { console.log(`  … ${n}/${todo.length}`); fs.writeFileSync(CHECK_FILE, JSON.stringify(checks, null, 1)); }
    }
  }));
  fs.writeFileSync(CHECK_FILE, JSON.stringify(checks, null, 1));

  const bad = ids.filter(id => checks[id] && checks[id].problems.length);
  console.log(`\n${bad.length ? '⚠️ ' : '✅'} ${bad.length} sospechosos de ${ids.length}`);
  for (const id of bad) {
    console.log(`\n  ${id}  [${checks[id].problems.join('; ')}]\n    texto: ${index.clips[id].text}\n    oído:  ${checks[id].heard}`);
  }
  if (bad.length) console.log(`\nPara regenerarlos: npm run voices -- --redo ${bad.join(',')}`);
}

main();
