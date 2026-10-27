/**
 * server/src/vtuber/avatar.js — Lo que el avatar sabe hacer, sin JSON de la API de VTube Studio a la vista.
 *
 *   anim(intención)            dispara la animación (hotkey) del modelo para esa intención: 'wave', 'celebrate'...
 *   face(intención, on)        activa / quita la expresión del modelo para esa intención y pone la cara a mano
 *                              (sonrisa, cejas) con parámetros: así 'happy' se ve aunque el modelo no tenga expresión
 *   gesture(nombre)            movimiento hecho aquí, vale para cualquier modelo: GESTURES
 *   look({x, y, z}) / idle()   hacia dónde mira (grados que se suman al seguimiento de cara, si lo hay)
 *   isSpeaking()               si suena la voz: VTube Studio la oye por el micrófono (VoiceVolume) y la boca se
 *                              mueve sola; aquí solo se acompaña con la cabeza
 *
 * Las intenciones se buscan por nombre en los hotkeys y expresiones del modelo cargado (palabras clave de
 * rules.js INTENTS, o el mapa a mano de server/.vtuber-map.json); lo que no exista no se hace.
 *
 * Canales (InjectParameterDataRequest, modo 'add', unas 20 veces por segundo: VTube Studio suelta el control de un
 * parámetro si pasa ~1 s sin recibirlo):
 *   x y z   FaceAngleX/Y/Z: girar, arriba/abajo, inclinar (el modelo suele mover también el cuerpo)
 *   smile   MouthSmile (en muchos modelos, ojos y boca sonrientes)    brows   Brows (cejas arriba)
 *   armL armR   FMArmLeft / FMArmRight: parámetros propios que se crean al conectar. Solo mueven los brazos si en
 *               VTube Studio se enlazan con los del modelo (README "Avatar VTuber")
 */

'use strict';

const CHANNELS = {
  x: 'FaceAngleX', y: 'FaceAngleY', z: 'FaceAngleZ', smile: 'MouthSmile', brows: 'Brows', armL: 'FMArmLeft', armR: 'FMArmRight',
};
const CUSTOM_PARAMS = [
  { parameterName: 'FMArmLeft', explanation: 'FlagMaster LIVE: brazo izquierdo (-1 abajo, 1 arriba)', min: -1, max: 1, defaultValue: 0 },
  { parameterName: 'FMArmRight', explanation: 'FlagMaster LIVE: brazo derecho (-1 abajo, 1 arriba)', min: -1, max: 1, defaultValue: 0 },
];
const EASE = 0.12;               // cuánto se acerca cada canal a su objetivo en cada paso (suaviza los cambios)
const VOICE_POLL_MS = 150;
const SPEAKING_LEVEL = 0.08;     // VoiceVolume por encima de esto = está hablando

/* Cara a mano para cada intención (se suma a la expresión del modelo, si la tiene) */
const MOODS = {
  happy: { smile: 1 },
  love: { smile: 0.8 },
  surprised: { brows: 1 },
  sad: { smile: 0, brows: 0.35, y: -6 },
  thinking: { brows: 0.5, z: 6, x: -6, y: 4 },
};

const s = Math.sin;
const TAU = 2 * Math.PI;

/* Gestos: desplazamiento de cada canal según el avance p de 0 a 1 */
const GESTURES = {
  nod: { ms: 900, at: p => ({ y: -9 * s(TAU * 2 * p) * (1 - p) }) },
  shake: { ms: 1000, at: p => ({ x: 12 * s(TAU * 2 * p) * (1 - p) }) },
  tilt: { ms: 1600, at: p => ({ z: 12 * s(Math.PI * p) }) },
  bounce: { ms: 1200, at: p => ({ y: 6 * Math.abs(s(TAU * 3 * p)), z: 4 * s(TAU * p), armL: 0.3 * s(Math.PI * p), armR: 0.3 * s(Math.PI * p) }) },
  wave: { ms: 2200, at: p => ({ armR: 0.9 * s(Math.PI * Math.min(1, p * 1.3)), z: 6 * s(TAU * 3 * p) * s(Math.PI * p), x: 5 * s(Math.PI * p), smile: 0.6 * s(Math.PI * p) }) },
  cheer: { ms: 2400, at: p => ({ armL: s(Math.PI * p) * (0.75 + 0.25 * s(TAU * 4 * p)), armR: s(Math.PI * p) * (0.75 - 0.25 * s(TAU * 4 * p)), y: 7 * Math.abs(s(TAU * 4 * p)), smile: s(Math.PI * p) }) },
  laugh: { ms: 1500, at: p => ({ y: 3 * s(TAU * 6 * p) * (1 - p) - 4 * s(Math.PI * p), z: 5 * s(Math.PI * p), smile: s(Math.PI * p) }) },
  shrug: { ms: 1600, at: p => ({ armL: 0.5 * s(Math.PI * p), armR: 0.5 * s(Math.PI * p), z: -8 * s(Math.PI * p), brows: 0.8 * s(Math.PI * p) }) },
  lookAround: { ms: 2600, at: p => ({ x: 16 * s(TAU * p), y: 3 * s(Math.PI * p) }) },
  hop: { ms: 700, at: p => ({ y: 10 * s(Math.PI * p) }) },
  sway: { ms: 2400, at: p => ({ x: 7 * s(TAU * p), z: 5 * s(TAU * p) }) },
  think: { ms: 2200, at: p => ({ z: 9 * s(Math.PI * p), y: 6 * s(Math.PI * p), x: -8 * s(Math.PI * p), brows: 0.5 * s(Math.PI * p), armR: 0.3 * s(Math.PI * p) }) },
};

const norm = v => String(v || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const zero = () => ({ x: 0, y: 0, z: 0, smile: 0, brows: 0, armL: 0, armR: 0 });

function createAvatar({ client, intents = {}, map = {}, tickMs = 50, now = Date.now, log = console.log }) {
  const inv = { model: '', hotkeys: [], expressions: [] };
  const motion = { cur: zero(), idle: zero(), look: null, mood: null, gesture: null, startedAt: now() };
  const voice = { level: 0, polling: false };
  const activeFaces = new Set();   // ficheros de expresión que hemos activado nosotros
  const warned = new Set();
  let channels = Object.keys(CHANNELS).filter(k => !k.startsWith('arm'));   // los brazos, cuando existan sus parámetros
  let loop = null;
  let voiceLoop = null;

  /* Busca un elemento del modelo para la intención: primero el mapa a mano, luego palabras clave */
  function find(list, intent, kind) {
    const wanted = map[kind] && map[kind][intent];
    if (wanted === '' || wanted === false) return null;   // desactivado a mano
    if (wanted) return list.find(i => norm(i.name) === norm(wanted) || norm(i.file) === norm(wanted)) || null;
    const re = intents[intent];
    return re ? list.find(i => re.test(norm(i.name)) || re.test(norm(i.file))) || null : null;
  }

  function warnOnce(key, msg) {
    if (warned.has(key)) return;
    warned.add(key);
    log(msg);
  }

  async function refresh() {
    const [hk, ex] = await Promise.all([
      client.request('HotkeysInCurrentModelRequest', {}),
      client.request('ExpressionStateRequest', { details: false }),
    ]);
    inv.model = hk.modelLoaded ? hk.modelName || '' : '';
    // Los hotkeys de expresión van por face() (con encendido/apagado explícito), no como animación
    inv.hotkeys = (hk.availableHotkeys || []).filter(h => h.type !== 'ToggleExpression' && h.type !== 'RemoveAllExpressions')
      .map(h => ({ id: h.hotkeyID, name: h.name || h.file || '', file: h.file || '', type: h.type }));   // hay hotkeys sin nombre
    inv.expressions = (ex.expressions || []).map(e => ({ name: e.name || '', file: e.file || '' }));
    activeFaces.clear();
    warned.clear();
    // Parámetros propios de los brazos: si no se pueden crear, no se mandan (un parámetro desconocido tumba la petición)
    try {
      for (const p of CUSTOM_PARAMS) await client.request('ParameterCreationRequest', p);
      channels = Object.keys(CHANNELS);
    } catch (err) {
      log(`⚠️  VTuber: no se pudieron crear los parámetros de los brazos: ${err.message}`);
    }
    return inventory();
  }

  function inventory() {
    const resolved = { anim: {}, face: {} };
    for (const intent of Object.keys(intents)) {
      const h = find(inv.hotkeys, intent, 'anim');
      const e = find(inv.expressions, intent, 'face');
      if (h) resolved.anim[intent] = h.name;
      if (e) resolved.face[intent] = e.name;
    }
    return {
      model: inv.model,
      hotkeys: inv.hotkeys.map(h => h.name),
      expressions: inv.expressions.map(e => e.name),
      resolved,
    };
  }

  function anim(intent) {
    if (!client.isReady()) return false;
    const h = find(inv.hotkeys, intent, 'anim');
    if (!h) { warnOnce(`anim:${intent}`, `ℹ️  VTuber: el modelo no tiene animación para "${intent}" (se hace solo el gesto)`); return false; }
    client.send('HotkeyTriggerRequest', { hotkeyID: h.id });
    return true;
  }

  function face(intent, on) {
    if (on) motion.mood = MOODS[intent] || null;
    else if (motion.mood === MOODS[intent]) motion.mood = null;
    if (!client.isReady()) return false;
    const e = find(inv.expressions, intent, 'face');
    if (!e) return !!MOODS[intent];
    if (on === activeFaces.has(e.file)) return true;
    if (on) activeFaces.add(e.file); else activeFaces.delete(e.file);
    client.send('ExpressionActivationRequest', { expressionFile: e.file, active: !!on, fadeTime: 0.25 });
    return true;
  }

  function clearFaces() {
    motion.mood = null;
    for (const file of activeFaces) client.send('ExpressionActivationRequest', { expressionFile: file, active: false, fadeTime: 0.25 });
    activeFaces.clear();
  }

  function gesture(name) {
    const g = GESTURES[name];
    if (g) motion.gesture = { g, start: now() };
    return !!g;
  }

  /* Un paso del movimiento: cada canal se acerca a su objetivo y se le suman gesto, respiración y voz */
  function step() {
    const t = now();
    const target = { ...zero(), ...motion.idle, ...(motion.look || {}), ...(motion.mood || {}) };
    let offset = {};
    if (motion.gesture) {
      const p = (t - motion.gesture.start) / motion.gesture.g.ms;
      if (p >= 1) motion.gesture = null; else offset = motion.gesture.g.at(p);
    }
    // Respiración: un vaivén lento que nunca para, para que no parezca una foto
    const sec = (t - motion.startedAt) / 1000;
    const breath = { y: 1.5 * s(TAU * sec / 4.2), z: 1.2 * s(TAU * sec / 7.3), armL: 0.06 * s(TAU * sec / 4.2), armR: 0.06 * s(TAU * sec / 4.2 + 1) };
    // Al hablar: la cabeza acompaña el volumen de la voz
    const v = voice.level;
    const talk = v > SPEAKING_LEVEL ? { y: -5 * v, x: 3 * s(TAU * sec / 1.7) * v, smile: 0.25 } : {};
    const out = {};
    for (const k of Object.keys(target)) {
      motion.cur[k] += (target[k] - motion.cur[k]) * EASE;
      out[k] = motion.cur[k] + (offset[k] || 0) + (breath[k] || 0) + (talk[k] || 0);
    }
    out.smile = Math.max(0, Math.min(1, out.smile));
    out.brows = Math.max(0, Math.min(1, out.brows));
    out.armL = Math.max(-1, Math.min(1, out.armL));
    out.armR = Math.max(-1, Math.min(1, out.armR));
    return out;
  }

  function tick() {
    const v = step();
    if (!client.isReady()) return;
    client.send('InjectParameterDataRequest', {
      faceFound: false,
      mode: 'add',
      parameterValues: channels.map(k => ({ id: CHANNELS[k], value: Math.round(v[k] * 100) / 100 })),
    });
  }

  async function pollVoice() {
    if (voice.polling || !client.isReady()) return;
    voice.polling = true;
    try {
      const r = await client.request('ParameterValueRequest', { name: 'VoiceVolume' });
      voice.level += ((Number(r.value) || 0) - voice.level) * 0.5;
    } catch { voice.level = 0; }
    voice.polling = false;
  }

  return {
    refresh,
    inventory,
    anim,
    face,
    clearFaces,
    gesture,
    look(target) { motion.look = target || null; },
    idle(target) { motion.idle = { ...target }; },
    isSpeaking: () => voice.level > SPEAKING_LEVEL,
    step,
    start() {
      if (!loop) loop = setInterval(tick, tickMs);
      if (!voiceLoop) voiceLoop = setInterval(pollVoice, VOICE_POLL_MS);
    },
    stop() {
      clearInterval(loop); loop = null;
      clearInterval(voiceLoop); voiceLoop = null;
    },
  };
}

module.exports = { createAvatar, GESTURES, MOODS };
