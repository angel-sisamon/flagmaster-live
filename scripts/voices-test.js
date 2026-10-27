/**
 * scripts/voices-test.js — Prueba de locuciones con Gemini TTS (npm run voices:test).
 *
 * Genera unas pocas frases con varias voces en client/voices/test/ para elegir voz y modelo
 * antes de generar el banco completo. Necesita GEMINI_API_KEY en .env.
 *
 *   npm run voices:test                    todas las voces y frases
 *   npm run voices:test -- --model gemini-3.1-flash-tts-preview
 */
const fs = require('fs');
const path = require('path');

const API_KEY = process.env.GEMINI_API_KEY;
const argModel = process.argv.indexOf('--model');
const MODEL = argModel > 0 ? process.argv[argModel + 1] : 'gemini-3.8-flash-tts';
const OUT_DIR = path.join(__dirname, '..', 'client', 'voices', 'test');

// Estilo de toda la frase (va aparte del texto: Gemini 3.8 lee el texto tal cual)
const STYLE = 'warm, upbeat game-show host on a live stream, casual and spontaneous, natural breaths';

const VOICES = ['Puck', 'Kore', 'Fenrir'];   // masculina alegre, femenina firme, masculina enérgica

// Etiquetas entre <>: sonidos o pausas en ese punto (<laugh>, <sigh>, <breath>, <short pause>…)
const PHRASES = {
  answer:   "Drumroll... <short pause> and it's... Japan! <laugh> Did you get it?",
  nobody:   '<sigh> Nobody? Really? <chuckle> Okay, okay... it was Mongolia.',
  greet:    "Oh, hi! <breath> Welcome everyone who's just joining, type A, B, C or D in the chat to play!",
  last:     "Okay everyone... <breath> this is the last flag. <whispering> Don't mess it up.",
  winner:   "And that's the game! We have a winner, congratulations! <laugh> What a match."
};

/* PCM 16 bits mono a 24 kHz → WAV */
function pcmToWav(pcm, rate = 24000) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

async function synth(text, voice, tries = 3) {
  const res = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': API_KEY },
    body: JSON.stringify({
      model: MODEL,
      input: [{ type: 'user_input', content: [{ type: 'text', text,
        annotations: [{ type: 'speech_metadata', style: STYLE }] }] }],
      response_format: { type: 'audio' },
      generation_config: { speech_config: [{ voice }] }
    })
  });
  const json = await res.json();
  if (res.status === 429 && tries > 0) {
    // Capa gratuita: pocas peticiones por minuto; se espera lo que pide la API y se reintenta
    const msg = json.error ? json.error.message : '';
    if (/per ?day|PerDay/i.test(msg)) throw new Error('límite diario agotado, vuelve a lanzarlo mañana');
    const wait = Math.ceil(Number((/retry in ([d.]+)s/.exec(msg) || [])[1]) || 60) + 2;
    console.log(`  … límite por minuto, espero ${wait} s`);
    await new Promise(r => setTimeout(r, wait * 1000));
    return synth(text, voice, tries - 1);
  }
  if (!res.ok) throw new Error(`${res.status} ${json.error ? json.error.message : ''}`);
  const audio = (json.steps || []).filter(st => st.type === 'model_output')
    .flatMap(st => st.content || []).filter(c => c.type === 'audio').pop();
  if (!audio) throw new Error('respuesta sin audio: ' + JSON.stringify(json).slice(0, 300));
  const buf = Buffer.from(audio.data, 'base64');
  // Normalmente llega ya como WAV; si viniera PCM crudo se le pone la cabecera
  return buf.toString('ascii', 0, 4) === 'RIFF' ? buf : pcmToWav(buf);
}

async function main() {
  if (!API_KEY) { console.error('Falta GEMINI_API_KEY en .env'); process.exit(1); }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const voice of VOICES) {
    for (const [key, text] of Object.entries(PHRASES)) {
      const file = path.join(OUT_DIR, `${MODEL}_${voice}_${key}.wav`);
      if (fs.existsSync(file)) continue;   // ya generada en una pasada anterior
      try {
        fs.writeFileSync(file, await synth(text, voice));
        console.log('✔', path.basename(file));
      } catch (e) {
        console.log('✘', path.basename(file), e.message);
      }
    }
  }
}

main();
