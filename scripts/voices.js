/**
 * scripts/voices.js — Banco de locuciones pregeneradas con Gemini TTS (npm run voices).
 *
 * Lee client/voices/phrases.json y genera en client/voices/<lang>/ solo lo que falta o ha cambiado:
 *
 *   client/voices/en/<grupo>/<nombre>.ogg   audio (Opus mono, volumen normalizado, sin silencios en los bordes)
 *   client/voices/en/index.json             índice: id → { group, country?, file, text, ms }
 *
 * Nombres de archivo:
 *   - grupos fijos:     <grupo>/<primeras-palabras-de-la-frase>.ogg   (last_round/last-flag-of-the-game.ogg)
 *   - grupos por país:  <grupo>/<código ISO>-<n>.ogg                   (answer/jp-1.ogg, nobody/jp-1.ogg)
 *   El id es esa misma ruta sin extensión ('answer/jp-1'), y es lo que usa el código para buscarlos.
 *
 * Para escalar: añadir o cambiar frases en phrases.json y volver a lanzar; lo que ya existe con el mismo
 * texto no se regenera (ni se vuelve a pagar). A cada audio por país se le asigna una plantilla la primera
 * vez y se queda con ella, así que añadir plantillas no regenera lo ya hecho.
 * Los WAV originales quedan en .voices-cache/ (fuera de git) para recodificar sin volver a generar.
 *
 *   npm run voices                     genera lo que falte
 *   npm run voices -- --only greet     solo un grupo (o varios separados por comas)
 *   npm run voices -- --redo answer/jp-1,nobody/jp-1   fuerza regenerar esos ids
 *   npm run voices -- --limit 50       como mucho 50 audios en esta pasada
 *   npm run voices -- --dry            muestra qué haría, sin llamar a la API
 *   npm run voices -- --prune          borra audios que ya no están en phrases.json
 *   npm run voices -- --batch 1        una frase por petición (por defecto 6 por petición, cortadas por silencios:
 *                                      el límite diario de la API cuenta peticiones, no frases)
 *
 * Después, npm run voices:check transcribe los audios y avisa de los que no suenan bien.
 *
 * Necesita GEMINI_API_KEY en .env (proyecto con facturación: sin el límite diario de la capa gratuita).
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFile } = require('child_process');
const ffmpeg = require('ffmpeg-static');

const ROOT = path.join(__dirname, '..');
const PHRASES_FILE = path.join(ROOT, 'client', 'voices', 'phrases.json');
const CACHE_DIR = path.join(ROOT, '.voices-cache');
const API_KEY = process.env.GEMINI_API_KEY;
const CONCURRENCY = 4;

function arg(name) {
  const i = process.argv.indexOf('--' + name);
  if (i < 0) return null;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
}
const ONLY = arg('only') ? String(arg('only')).split(',') : null;
const REDO = new Set(arg('redo') ? String(arg('redo')).split(',') : []);
const DRY = !!arg('dry');
const PRUNE = !!arg('prune');
const BATCH = Number(arg('batch')) || 6;          // frases por petición (--batch 1: una a una)
const LIMIT = Number(arg('limit')) || Infinity;   // como mucho N audios en esta pasada

function loadCountries() {
  const ctx = {};
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'game', 'js', 'countries-data.js'), 'utf8') + ';this.C = COUNTRIES;', ctx);
  return ctx.C;
}

/* "Okay everyone... <breath> last question!" → "okay-everyone-last-question" */
function slug(text, words = 6) {
  return text.replace(/<[^>]*>/g, ' ').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/'/g, '').replace(/[^a-z0-9 ]+/g, ' ').trim().split(/\s+/).slice(0, words).join('-');
}

function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

/* Lista completa de audios que debería haber según phrases.json */
function buildItems(cfg, prevIndex) {
  const countries = loadCountries();
  const items = [];
  for (const [group, def] of Object.entries(cfg.groups)) {
    if (Array.isArray(def)) {
      const used = new Set();
      for (const text of def) {
        let name = slug(text), n = 2;
        while (used.has(name)) name = slug(text) + '-' + n++;
        used.add(name);
        items.push({ id: `${group}/${name}`, group, text });
      }
      continue;
    }
    // Grupo por país: cada audio conserva la plantilla que le tocó la primera vez
    const templates = def.templates;
    countries.forEach((c, ci) => {
      const name = cfg.spokenNames[c.code] || c.names.en;
      for (let k = 0; k < def.perCountry; k++) {
        const id = `${group}/${c.code.toLowerCase()}-${k + 1}`;
        const prev = prevIndex[id];
        let tpl = prev && templates.includes(prev.template) ? prev.template
          : templates[(ci * def.perCountry + k) % templates.length];
        // "{N}!" al principio de la frase: "The United States!"
        const text = tpl.replace(/\{N\}/g, (m, off) => (off === 0 ? capitalize(name) : name));
        items.push({ id, group, country: c.code, template: tpl, text });
      }
    });
  }
  return items;
}

/* ── Gemini TTS ─────────────────────────────────────── */
async function synth(cfg, text, tries = 5) {
  let res, json;
  try {
    res = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': API_KEY },
      body: JSON.stringify({
        model: cfg.model,
        input: [{ type: 'user_input', content: [{ type: 'text', text,
          annotations: [{ type: 'speech_metadata', style: cfg.style }] }] }],
        response_format: { type: 'audio' },
        generation_config: { speech_config: [{ voice: cfg.voice }] }
      })
    });
    json = await res.json();
  } catch (e) {
    if (tries > 0) { await sleep(5000); return synth(cfg, text, tries - 1); }
    throw e;
  }
  if ((res.status === 429 || res.status >= 500) && tries > 0) {
    const msg = json.error ? json.error.message : '';
    if (/per ?day/i.test(msg)) throw new Error('límite diario agotado (¿la clave está en un proyecto con facturación?)');
    const wait = Math.ceil(Number((/retry in ([\d.]+)s/.exec(msg) || [])[1]) || 20) + 1;
    await sleep(wait * 1000);
    return synth(cfg, text, tries - 1);
  }
  if (!res.ok) throw new Error(`${res.status} ${json.error ? json.error.message : ''}`);
  const audio = (json.steps || []).filter(s => s.type === 'model_output')
    .flatMap(s => s.content || []).filter(c => c.type === 'audio').pop();
  if (!audio) throw new Error('respuesta sin audio');
  return Buffer.from(audio.data, 'base64');
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/* ── Lotes: varias frases en un audio, separadas por pausas largas ─ */
const BATCH_SEPARATOR = ' <long pause> <long pause> ';

function readWav(buf) {
  let off = 12, rate = 24000;
  while (buf.toString('ascii', off, off + 4) !== 'data') {
    if (buf.toString('ascii', off, off + 4) === 'fmt ') rate = buf.readUInt32LE(off + 12);
    off += 8 + buf.readUInt32LE(off + 4);
  }
  return { rate, pcm: buf.subarray(off + 8) };
}

/* Silencios de 200 ms o más ([{ a, b }] en ms) y energía de cada ventana de 20 ms */
function silences(pcm, rate) {
  const W = Math.round(rate / 50), n = pcm.length / 2, gaps = [], energy = [];
  let start = -1, i = 0;
  for (; i + W <= n; i += W) {
    let e = 0;
    for (let k = 0; k < W; k++) { const v = pcm.readInt16LE(2 * (i + k)); e += v * v; }
    energy.push(Math.sqrt(e / W));
    const quiet = energy[energy.length - 1] < 300, ms = (i / rate) * 1000;
    if (quiet && start < 0) start = ms;
    if (!quiet && start >= 0) { if (ms - start >= 200) gaps.push({ a: start, b: ms }); start = -1; }
  }
  return { gaps, energy };
}

/* Corta el audio de un lote en una pieza por frase (null si una pieza no sale bien). Gemini dice dónde empieza y acaba cada frase y
 * cada corte se lleva al silencio más largo entre el final de una y el principio de la siguiente */
async function align(wavBuf, texts, tries = 3) {
  const prompt = `This audio contains these ${texts.length} phrases, spoken in this order:\n` +
    texts.map((t, i) => `${i + 1}. ${t.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()}`).join('\n') +
    '\nReturn ONLY a JSON array with one object per phrase, in order: {"start_ms": number, "end_ms": number}.';
  const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': API_KEY },
    body: JSON.stringify({ contents: [{ parts: [{ inlineData: { mimeType: 'audio/wav', data: wavBuf.toString('base64') } }, { text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json' } })
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`alineado: ${res.status} ${json.error ? json.error.message : ''}`);
  const segs = JSON.parse(json.candidates[0].content.parts.map(p => p.text || '').join(''));
  if (Array.isArray(segs) && segs.length === texts.length) return segs;
  if (tries > 1) return align(wavBuf, texts, tries - 1);
  throw new Error(`alineado: ${segs.length} frases en vez de ${texts.length}`);
}

async function splitBatch(wavBuf, texts) {
  const { rate, pcm } = readWav(wavBuf);
  const segs = await align(wavBuf, texts);

  const totalMs = (pcm.length / 2 / rate) * 1000;
  const { gaps, energy } = silences(pcm, rate);
  const cuts = [0];
  for (let i = 0; i < segs.length - 1; i++) {
    const lo = Math.min(segs[i].end_ms, segs[i + 1].start_ms) - 600, hi = Math.max(segs[i].end_ms, segs[i + 1].start_ms) + 600;
    const inside = gaps.filter(g => g.b > lo && g.a < hi);
    if (inside.length) {
      const g = inside.reduce((best, g) => (g.b - g.a > best.b - best.a ? g : best));
      cuts.push((g.a + g.b) / 2);
    } else {
      // Sin silencio claro: se corta en el punto más bajo de volumen de la zona (voices:check avisará si queda mal)
      let best = Math.max(0, Math.floor(lo / 20));
      for (let w = best; w < Math.min(energy.length, hi / 20); w++) if (energy[w] < energy[best]) best = w;
      cuts.push(best * 20 + 10);
    }
  }
  cuts.push(totalMs);
  return segs.map((s, i) => {
    const a = Math.floor((cuts[i] / 1000) * rate) * 2, b = Math.floor((cuts[i + 1] / 1000) * rate) * 2;
    return b - a < rate ? null : pcmToWav(pcm.subarray(a, b), rate);   // < 1 s: esa frase no se dijo bien
  });
}

function pcmToWav(pcm, rate) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

/* WAV → Opus: recorta silencios de los bordes (deja ~0,1 s), normaliza volumen. Devuelve la duración en ms */
function encode(wavFile, outFile) {
  const trim = 'silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.1';
  const filter = `${trim},areverse,${trim},areverse,loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000`;
  return new Promise((resolve, reject) => {
    execFile(ffmpeg, ['-hide_banner', '-y', '-i', wavFile, '-af', filter, '-ac', '1',
      '-c:a', 'libopus', '-b:a', '40k', outFile], { windowsHide: true }, (err, stdout, stderr) => {
      if (err) return reject(new Error('ffmpeg: ' + String(stderr).split('\n').slice(-3).join(' ')));
      const t = [...String(stderr).matchAll(/time=(\d+):(\d+):([\d.]+)/g)].pop();
      resolve(t ? Math.round(((+t[1]) * 3600 + (+t[2]) * 60 + (+t[3])) * 1000) : 0);
    });
  });
}

async function main() {
  const cfg = JSON.parse(fs.readFileSync(PHRASES_FILE, 'utf8'));
  const outDir = path.join(ROOT, 'client', 'voices', cfg.lang);
  const indexFile = path.join(outDir, 'index.json');
  const index = fs.existsSync(indexFile) ? JSON.parse(fs.readFileSync(indexFile, 'utf8')) : { clips: {} };
  const items = buildItems(cfg, index.clips);

  const todo = items.filter(it => {
    if (REDO.size && !REDO.has(it.id) && index.clips[it.id]) return false;
    if (ONLY && !ONLY.includes(it.group)) return false;
    const prev = index.clips[it.id];
    return REDO.has(it.id) || !prev || prev.text !== it.text || prev.voice !== cfg.voice || prev.model !== cfg.model ||
      !fs.existsSync(path.join(outDir, prev.file));
  }).slice(0, LIMIT);
  console.log(`🎙️  ${items.length} audios en phrases.json, ${todo.length} por generar (${cfg.model}, voz ${cfg.voice})`);
  if (DRY) { todo.slice(0, 40).forEach(it => console.log('  ', it.id, '|', it.text)); return; }
  if (todo.length && !API_KEY) { console.error('Falta GEMINI_API_KEY en .env'); process.exit(1); }

  fs.mkdirSync(CACHE_DIR, { recursive: true });
  let done = 0, failed = 0, lastSave = Date.now();
  const save = () => {
    // Orden estable (por id) para que los diffs de git sean legibles
    const clips = {};
    Object.keys(index.clips).sort().forEach(k => { clips[k] = index.clips[k]; });
    fs.writeFileSync(indexFile, JSON.stringify({ lang: cfg.lang, clips }, null, 1) + '\n');
  };

  async function store(it, wavBuf) {
    const file = it.id + '.ogg';
    const wav = path.join(CACHE_DIR, cfg.lang, it.id + '.wav');
    fs.mkdirSync(path.dirname(wav), { recursive: true });
    fs.mkdirSync(path.dirname(path.join(outDir, file)), { recursive: true });
    fs.writeFileSync(wav, wavBuf);
    const ms = await encode(wav, path.join(outDir, file));
    index.clips[it.id] = Object.assign({ group: it.group }, it.country ? { country: it.country, template: it.template } : {},
      { file, text: it.text, ms, voice: cfg.voice, model: cfg.model });
    done++;
  }

  // Lotes de BATCH frases por petición (el límite diario cuenta peticiones); si un lote no se puede
  // cortar bien, sus frases vuelven a la cola de una en una
  const queue = [];
  for (let i = 0; i < todo.length; i += BATCH) queue.push(todo.slice(i, i + BATCH));
  let stopped = null;
  // Lo que falla en un lote se reintenta una vez en otro lote más pequeño y, si vuelve a fallar, frase a frase
  function requeue(list, why) {
    console.log(`  ↺ ${list.length} de un lote (${list[0].id}…) se repiten: ${why}`);
    const again = list.filter(it => !it.retried), single = list.filter(it => it.retried);
    again.forEach(it => { it.retried = true; });
    for (let i = 0; i < again.length; i += 3) queue.push(again.slice(i, i + 3));
    single.forEach(it => queue.push([it]));
  }
  async function worker() {
    for (let batch; !stopped && (batch = queue.shift());) {
      try {
        if (batch.length === 1) {
          await store(batch[0], await synth(cfg, batch[0].text));
        } else {
          const wav = await synth(cfg, batch.map(it => it.text).join(BATCH_SEPARATOR));
          const pieces = await splitBatch(wav, batch.map(it => it.text));
          const retry = [];
          for (let i = 0; i < batch.length; i++) {
            if (pieces[i]) await store(batch[i], pieces[i]);
            else retry.push(batch[i]);
          }
          if (retry.length) requeue(retry, 'pieza demasiado corta');
        }
      } catch (e) {
        if (/límite diario/.test(e.message)) { stopped = e.message; break; }
        if (batch.length > 1) requeue(batch, e.message);
        else {
          failed++;
          console.log(`  ✘ ${batch[0].id}: ${e.message}`);
        }
      }
      if (Date.now() - lastSave > 20000) { save(); lastSave = Date.now(); console.log(`  … ${done}/${todo.length} (${failed} fallos)`); }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  if (stopped) {
    const left = todo.length - done - failed;
    console.log(`⏸️  ${stopped}. Faltan ~${left}: vuelve a lanzar "npm run voices" y sigue donde se quedó.`);
  }

  if (PRUNE) {
    const valid = new Set(items.map(it => it.id));
    for (const id of Object.keys(index.clips)) {
      if (valid.has(id)) continue;
      fs.rmSync(path.join(outDir, index.clips[id].file), { force: true });
      delete index.clips[id];
      console.log('  🗑️ ', id);
    }
  }
  save();
  console.log(`✅ ${done} generados, ${failed} fallos. Índice: ${path.relative(ROOT, indexFile)}`);
  if (failed) process.exitCode = 1;
}

main();
