/**
 * server/src/chatbot/studio.js — Pega un mensaje en el chat de TikTok LIVE Studio con el ratón y el teclado del sistema.
 *
 *   const studio = createStudioPaster({ x: 1650, y: 980 });   // CHAT_X / CHAT_Y: la caja de chat de Studio
 *   await studio.sendChatMessage('Hello chat!');               // lanza StudioError si algo falla
 *   studio.setSettings({ method: 'type', typoPct: 3 });        // panel /bot → "Ajustes de escritura"
 *
 * Pasos: comprueba que bajo (x, y) está Studio y no otra ventana → copia el texto → acerca el ratón en varios
 * pasos y pulsa/suelta por separado (Studio es Electron: un clic "teletransportado" a veces no le da el foco) →
 * comprueba que Studio ha quedado activo (si no, un segundo clic) → Ctrl+V (Cmd+V en macOS) o tecleo → Enter →
 * devuelve ratón y portapapeles. Un envío cada vez. Las comprobaciones usan win32.js (solo Windows).
 * Lo dispara quien emite desde el panel (/bot, botón "Enviar a Studio"): el bot no publica nada por su cuenta.
 *
 * Dependencias opcionales: @jitsi/robotjs (ratón/teclado, CommonJS), koffi (user32) y clipboardy (solo ES Modules:
 * aquí se carga con import() dinámico; en un proyecto ESM bastaría con `import clipboard from 'clipboardy'`).
 */

'use strict';

const win32 = require('./win32');
const { stripEmoji } = require('./brain');

const APPROACH_STEPS = 6;          // movimientos hasta la caja: Chromium ve el ratón "entrar" en ella
const APPROACH_MS = 12;
const HOVER_MS = 80;               // quieto encima antes de pulsar
const PRESS_MS = [50, 90];         // entre pulsar y soltar
const FOCUS_MS = [150, 250];       // tras el clic, para que la caja tenga el foco
const PASTE_MS = [150, 300];       // tras pegar, antes de Enter
const MODIFIER_MS = 40;
const RESTORE_CLIPBOARD_MS = 400;
const CHECK_EVERY = 5;             // al teclear, cada tantas letras se comprueba que Studio sigue activo

/*
 * Ajustes de escritura (se cambian en caliente desde el panel). Los de tecleo solo cuentan con method 'type':
 * ~45-60 palabras por minuto, algo más lento tras espacios y signos, de vez en cuando una pausa de "pensar" y
 * algún error tipográfico (una tecla vecina QWERTY): se siguen escribiendo 0-typoLateMax letras, se para,
 * se borra con Retroceso y se reescribe bien.
 */
const DEFAULT_SETTINGS = {
  method: 'paste',                 // 'paste' (Ctrl+V) o 'type' (letra a letra; los emojis se pegan sueltos)
  keyMs: [70, 170],                // entre tecla y tecla
  spaceExtraMs: [40, 160],         // de más tras un espacio
  punctExtraMs: [120, 320],        // de más tras . , ! ? ; :
  thinkPct: 4,                     // % de letras tras las que hay una pausa de "pensar"
  thinkMs: [350, 900],
  typoPct: 8,                      // % de letras que se escriben mal
  typoLateMax: 2,                  // letras que se siguen escribiendo antes de darse cuenta
  typoNoticeMs: [250, 700],        // al darse cuenta, antes de borrar
  backspaceMs: [60, 120],          // entre Retroceso y Retroceso
  typoResumeMs: [80, 200],         // tras corregir, antes de seguir
};
const RANGES_MS = ['keyMs', 'spaceExtraMs', 'punctExtraMs', 'thinkMs', 'typoNoticeMs', 'backspaceMs', 'typoResumeMs'];
const MAX_MS = 5000;
const LIMITS = { thinkPct: [0, 50], typoPct: [0, 30], typoLateMax: [0, 5] };

/* Valida un cambio del panel sobre `base`: lo que no cuadra se ignora o se ajusta al límite */
function normalizeSettings(patch, base = DEFAULT_SETTINGS) {
  const out = { ...base };
  if (!patch || typeof patch !== 'object') return out;
  const clamp = (v, [min, max]) => Math.min(max, Math.max(min, Math.round(v)));
  if (patch.method === 'paste' || patch.method === 'type') out.method = patch.method;
  for (const k of RANGES_MS) {
    const r = patch[k];
    if (!Array.isArray(r) || r.length !== 2 || !r.every(v => Number.isFinite(Number(v)))) continue;
    const [a, b] = r.map(v => clamp(Number(v), [0, MAX_MS]));
    out[k] = [Math.min(a, b), Math.max(a, b)];
  }
  for (const [k, lim] of Object.entries(LIMITS)) {
    if (patch[k] !== undefined && patch[k] !== '' && Number.isFinite(Number(patch[k]))) out[k] = clamp(Number(patch[k]), lim);
  }
  return out;
}

// Teclas vecinas en un teclado QWERTY: los errores típicos al teclear rápido
const QWERTY_ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
const NEIGHBORS = {};
QWERTY_ROWS.forEach((row, r) => [...row].forEach((ch, i) => {
  NEIGHBORS[ch] = [row[i - 1], row[i + 1], (QWERTY_ROWS[r - 1] || '')[i], (QWERTY_ROWS[r + 1] || '')[i]].filter(Boolean);
}));

class StudioError extends Error {
  constructor(stage, cause) {
    super(`${stage}: ${cause && cause.message ? cause.message : cause}`);
    this.stage = stage;
  }
}

const between = ([min, max], random = Math.random) => Math.round(min + random() * (max - min));

async function step(stage, fn) {
  try { return await fn(); } catch (err) { throw err instanceof StudioError ? err : new StudioError(stage, err); }
}

/**
 * method / settings: ver DEFAULT_SETTINGS (method suelto, por compatibilidad con CHAT_INPUT_METHOD).
 * robot, clipboard, windows, sleep, random: para los tests (por defecto los de verdad).
 */
function createStudioPaster({
  x, y, method, settings: initial, platform = process.platform, log = console.log,
  robot = null, clipboard = null, windows = win32.load,
  sleep = ms => new Promise(r => setTimeout(r, ms)), random = Math.random,
}) {
  let settings = normalizeSettings({ ...initial, ...(method ? { method } : {}) });
  const pause = sleep;
  const pick = range => between(range, random);
  const pasteModifier = platform === 'darwin' ? 'command' : 'control';
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });   // 🇪🇸 o 👋🏽 = una "letra"
  let queue = Promise.resolve();

  async function load() {
    if (!robot) {
      robot = await step('cargar @jitsi/robotjs (npm install)', () => require('@jitsi/robotjs'));
      robot.setMouseDelay(0);
      robot.setKeyboardDelay(0);
    }
    if (!clipboard) clipboard = await step('cargar clipboardy (npm install)', async () => (await import('clipboardy')).default);
  }

  function checkConfig() {
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new StudioError('configuración', 'faltan CHAT_X y CHAT_Y en .env (búscalas con coordenadas_chat.bat)');
    }
  }

  /* ¿Está Studio bajo el punto? Si lo tapa otra ventana, el clic se lo llevaría ella */
  function checkTarget(report) {
    const w = windows();
    if (!w) return;
    const target = w.windowAt(x, y);
    report.target = win32.label(target);
    if (!win32.isStudio(target)) {
      throw new StudioError('comprobar ventana', `en (${x}, ${y}) está ${win32.label(target)}, no TikTok LIVE Studio: ` +
        'algo la tapa, Studio está minimizado o se ha movido (vuelve a sacar las coordenadas)');
    }
    if (w.isElevated(target.pid) && !w.isElevated(process.pid)) {
      throw new StudioError('permisos', 'TikTok LIVE Studio se está ejecutando como administrador y este programa no: ' +
        'Windows bloquea el ratón y el teclado simulados. Abre Studio sin "Ejecutar como administrador" o abre ' +
        'arrancar_live.bat / probar_studio.bat con clic derecho → "Ejecutar como administrador"');
    }
  }

  async function humanClick() {
    const from = robot.getMousePos();
    // Último tramo de lado y desde abajo-izquierda: así el ratón "entra" en la caja aunque viniera de muy lejos
    const sx = x - 40, sy = y + 12;
    robot.moveMouse(sx, sy);
    for (let i = 1; i <= APPROACH_STEPS; i++) {
      await pause(APPROACH_MS);
      robot.moveMouse(Math.round(sx + ((x - sx) * i) / APPROACH_STEPS), Math.round(sy + ((y - sy) * i) / APPROACH_STEPS));
    }
    const at = robot.getMousePos();
    // Con varios monitores, unas coordenadas fuera del principal pueden no alcanzarse
    if (Math.abs(at.x - x) > 2 || Math.abs(at.y - y) > 2) {
      throw new Error(`el ratón quedó en (${at.x}, ${at.y}) y no en (${x}, ${y}); pon Studio en el monitor principal`);
    }
    await pause(HOVER_MS);
    robot.mouseToggle('down', 'left');
    await pause(pick(PRESS_MS));
    robot.mouseToggle('up', 'left');
    return from;
  }

  /* Tras el clic: ¿Studio es la ventana activa? ¿hay cursor de texto? (lo segundo, orientativo en Chromium) */
  function focusState() {
    const w = windows();
    if (!w) return { checked: false };
    const fg = w.foreground();
    const f = w.threadFocus(fg) || {};
    return { checked: true, studioActive: win32.isStudio(fg), active: win32.label(fg), focusClass: f.focusClass || '', caret: !!f.caret };
  }

  async function pressWithModifier(key, modifier) {
    robot.keyToggle(modifier, 'down');
    await pause(MODIFIER_MS);
    robot.keyTap(key);
    await pause(MODIFIER_MS);
    robot.keyToggle(modifier, 'up');
  }

  /* ¿Studio sigue siendo la ventana activa? Si has hecho clic en otra, se para: no se escribe ni se envía fuera */
  function ensureStudioActive(stage) {
    const w = windows();
    if (!w) return;
    const fg = w.foreground();
    if (!win32.isStudio(fg)) throw new StudioError(stage, `has cambiado a ${win32.label(fg)} mientras escribía: no se envía`);
  }

  /* Una letra normal se teclea; un emoji o una bandera (varios códigos) se pega. Luego, la espera de después */
  async function typeOne(g, s, { think = false } = {}) {
    if (g.length === 1) robot.typeString(g);
    else {
      await clipboard.write(g);
      await pressWithModifier('v', pasteModifier);
    }
    let wait = pick(s.keyMs);
    if (g === ' ') wait += pick(s.spaceExtraMs);
    else if (/[.,!?;:]/.test(g)) wait += pick(s.punctExtraMs);
    if (think && random() * 100 < s.thinkPct) wait += pick(s.thinkMs);
    await pause(wait);
  }

  async function typeNaturally(msg, s, report) {
    const graphemes = [...segmenter.segment(msg)].map(seg => seg.segment);
    report.typos = 0;
    for (let i = 0; i < graphemes.length; i++) {
      if (i % CHECK_EVERY === 0) ensureStudioActive('escribir');
      const g = graphemes[i];
      const lower = g.toLowerCase();

      // Error: una tecla vecina, unas letras más sin darse cuenta, y se borra todo eso con Retroceso
      if (NEIGHBORS[lower] && random() * 100 < s.typoPct) {
        const options = NEIGHBORS[lower];
        const wrong = options[Math.floor(random() * options.length)];
        await typeOne(g === lower ? wrong : wrong.toUpperCase(), s);
        const late = Math.min(Math.floor(random() * (s.typoLateMax + 1)), graphemes.length - i - 1);
        for (let k = 1; k <= late; k++) {
          ensureStudioActive('escribir');
          await typeOne(graphemes[i + k], s);
        }
        await pause(pick(s.typoNoticeMs));
        for (let d = 0; d <= late; d++) {
          ensureStudioActive('escribir (corregir)');
          robot.keyTap('backspace');
          await pause(pick(s.backspaceMs));
        }
        await pause(pick(s.typoResumeMs));
        report.typos++;
      }

      await typeOne(g, s, { think: true });   // las letras borradas (i+1...) las reescribe el propio bucle
    }
  }

  async function paste(text, { pressEnter = true } = {}) {
    checkConfig();
    await load();
    const msg = stripEmoji(String(text || '').replace(/\s+/g, ' '));
    if (!msg) throw new StudioError('texto', 'mensaje vacío (o solo emojis, que Studio no muestra)');

    const s = settings;   // un cambio en el panel a mitad de mensaje cuenta para el siguiente
    const report = { method: s.method };
    const previousClipboard = await clipboard.read().catch(() => null);   // puede no ser texto (una imagen)
    let previousMouse = robot.getMousePos();
    try {
      await step('comprobar ventana', () => checkTarget(report));
      if (s.method === 'paste') await step('copiar al portapapeles', () => clipboard.write(msg));
      previousMouse = await step('clic en la caja de chat', humanClick);
      await pause(pick(FOCUS_MS));
      report.focus = focusState();
      if (report.focus.checked && !report.focus.studioActive) {
        // El primer clic a veces solo activa la ventana: segundo intento
        await step('clic en la caja de chat (2º intento)', humanClick);
        await pause(pick(FOCUS_MS));
        report.focus = focusState();
        report.retried = true;
      }
      if (report.focus.checked && !report.focus.studioActive) {
        throw new StudioError('foco', `tras el clic la ventana activa es ${report.focus.active}, no Studio`);
      }
      if (s.method === 'type') await step('escribir', () => typeNaturally(msg, s, report));
      else await step('pegar', () => pressWithModifier('v', pasteModifier));
      await pause(pick(PASTE_MS));
      if (pressEnter) {
        ensureStudioActive('enviar (Enter)');
        await step('enviar (Enter)', () => robot.keyTap('enter'));
      }
    } finally {
      try { robot.moveMouse(previousMouse.x, previousMouse.y); } catch { /* da igual */ }
      if (previousClipboard != null) {
        setTimeout(() => clipboard.write(previousClipboard).catch(() => {}), RESTORE_CLIPBOARD_MS);
      }
    }
    const how = s.method === 'type' ? `Escrito${report.typos ? ` (${report.typos} error${report.typos > 1 ? 'es' : ''} corregido${report.typos > 1 ? 's' : ''})` : ''}` : 'Pegado';
    if (pressEnter) log(`🎙️  ${how} en Studio: ${msg}`);
    return report;
  }

  /* Un envío detrás de otro: dos clics seguidos en el panel no se pisan */
  function run(text, opts) {
    const job = queue.then(() => paste(text, opts));
    queue = job.catch(() => {});
    return job;
  }

  return {
    sendChatMessage: text => run(text),
    /* Para probar_studio.bat: hace todo menos pulsar Enter y devuelve qué ha visto */
    dryRun: text => run(text, { pressEnter: false }),
    getSettings: () => JSON.parse(JSON.stringify(settings)),
    /* Cambia algunos ajustes (lo que no es válido se ignora) y devuelve cómo quedan */
    setSettings(patch) {
      settings = normalizeSettings(patch, settings);
      return this.getSettings();
    },
  };
}

module.exports = { createStudioPaster, StudioError, normalizeSettings, DEFAULT_SETTINGS };
