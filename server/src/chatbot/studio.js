/**
 * server/src/chatbot/studio.js — Pega un mensaje en el chat de TikTok LIVE Studio con el ratón y el teclado del sistema.
 *
 *   const studio = createStudioPaster({ x: 1650, y: 980 });   // CHAT_X / CHAT_Y: la caja de chat de Studio
 *   await studio.sendChatMessage('Hello chat!');               // lanza StudioError si algo falla
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
// Tecleo a ritmo de persona (método 'type'): ~45-60 palabras por minuto, algo más lento tras espacios y signos,
// y de vez en cuando una pausa de "pensar". Cada CHECK_EVERY letras se comprueba que Studio sigue activo.
const KEY_MS = [70, 170];
const SPACE_EXTRA_MS = [40, 160];
const PUNCT_EXTRA_MS = [120, 320];
const THINK_CHANCE = 0.04;
const THINK_MS = [350, 900];
const CHECK_EVERY = 5;

class StudioError extends Error {
  constructor(stage, cause) {
    super(`${stage}: ${cause && cause.message ? cause.message : cause}`);
    this.stage = stage;
  }
}

const pause = ms => new Promise(r => setTimeout(r, ms));
const between = ([min, max]) => Math.round(min + Math.random() * (max - min));

async function step(stage, fn) {
  try { return await fn(); } catch (err) { throw err instanceof StudioError ? err : new StudioError(stage, err); }
}

/**
 * method: 'paste' (Ctrl+V, por defecto) o 'type' (teclea letra a letra a ritmo natural; los emojis, que no se
 * pueden teclear, se pegan sueltos)
 */
function createStudioPaster({ x, y, method = 'paste', platform = process.platform, log = console.log }) {
  let robot = null;
  let clipboard = null;
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
    const w = win32.load();
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
    await pause(between(PRESS_MS));
    robot.mouseToggle('up', 'left');
    return from;
  }

  /* Tras el clic: ¿Studio es la ventana activa? ¿hay cursor de texto? (lo segundo, orientativo en Chromium) */
  function focusState() {
    const w = win32.load();
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
    const w = win32.load();
    if (!w) return;
    const fg = w.foreground();
    if (!win32.isStudio(fg)) throw new StudioError(stage, `has cambiado a ${win32.label(fg)} mientras escribía: no se envía`);
  }

  async function typeNaturally(msg) {
    const graphemes = [...segmenter.segment(msg)].map(s => s.segment);
    for (let i = 0; i < graphemes.length; i++) {
      const g = graphemes[i];
      if (i % CHECK_EVERY === 0) ensureStudioActive('escribir');
      // Una letra normal se teclea; un emoji o una bandera (varios códigos) se pega
      if (g.length === 1) robot.typeString(g);
      else {
        await clipboard.write(g);
        await pressWithModifier('v', pasteModifier);
      }
      let wait = between(KEY_MS);
      if (g === ' ') wait += between(SPACE_EXTRA_MS);
      else if (/[.,!?;:]/.test(g)) wait += between(PUNCT_EXTRA_MS);
      if (Math.random() < THINK_CHANCE) wait += between(THINK_MS);
      await pause(wait);
    }
  }

  async function paste(text, { pressEnter = true } = {}) {
    checkConfig();
    await load();
    const msg = stripEmoji(String(text || '').replace(/\s+/g, ' '));
    if (!msg) throw new StudioError('texto', 'mensaje vacío (o solo emojis, que Studio no muestra)');

    const report = { method };
    const previousClipboard = await clipboard.read().catch(() => null);   // puede no ser texto (una imagen)
    let previousMouse = robot.getMousePos();
    try {
      await step('comprobar ventana', () => checkTarget(report));
      if (method === 'paste') await step('copiar al portapapeles', () => clipboard.write(msg));
      previousMouse = await step('clic en la caja de chat', humanClick);
      await pause(between(FOCUS_MS));
      report.focus = focusState();
      if (report.focus.checked && !report.focus.studioActive) {
        // El primer clic a veces solo activa la ventana: segundo intento
        await step('clic en la caja de chat (2º intento)', humanClick);
        await pause(between(FOCUS_MS));
        report.focus = focusState();
        report.retried = true;
      }
      if (report.focus.checked && !report.focus.studioActive) {
        throw new StudioError('foco', `tras el clic la ventana activa es ${report.focus.active}, no Studio`);
      }
      if (method === 'type') await step('escribir', () => typeNaturally(msg));
      else await step('pegar', () => pressWithModifier('v', pasteModifier));
      await pause(between(PASTE_MS));
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
    if (pressEnter) log(`🎙️  ${method === 'type' ? 'Escrito' : 'Pegado'} en Studio: ${msg}`);
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
  };
}

module.exports = { createStudioPaster, StudioError };
