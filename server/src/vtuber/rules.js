/**
 * server/src/vtuber/rules.js — BehaviorRules: qué hace el avatar con cada cosa que pasa en el directo.
 *
 * Solo datos: reactionFor(evento, datos) → reacción para behavior.request() o null. Las intenciones (anim / face)
 * se buscan por nombre en el modelo (INTENTS); si el modelo no tiene esa animación o expresión, queda el gesto.
 *
 *   Evento            Prioridad  Qué hace
 *   gift              high       celebra (más rato con regalos de ≥ 100 diamantes)
 *   greeting          high       saluda con la mano ("hola", "hey"... en el chat)
 *   command           high       comandos del público: !wave !dance !love !wow !sad !laugh
 *   follow            high       sonríe y asiente
 *   game:over         high       celebra el final de la partida
 *   round:question    medium     pone cara de pensar
 *   round:tick        medium     a 5 s del final de la votación, da un salto
 *   round:results     medium     sorpresa si casi nadie acierta, encoge los hombros si falla la mitad, alegría si
 *                                aciertan casi todos, pena si nadie vota
 *   live:join / like  low        asiente / inclina la cabeza (solo si no está haciendo otra cosa)
 */

'use strict';

/* Palabras clave para encontrar hotkeys y expresiones en el modelo (nombre o fichero, sin acentos ni mayúsculas) */
const INTENTS = {
  happy: /happy|smile|joy|glad|feliz|alegr|sonri/,
  surprised: /surpris|shock|wow|gasp|sorpr|asombr/,
  sad: /sad|cry|tear|triste|llor/,
  thinking: /think|curious|hmm|pensa|duda/,
  love: /love|heart|kiss|amor|coraz|beso/,
  wave: /wave|hello|greet|salud|hola/,
  celebrate: /celebr|cheer|party|clap|dance|yay|aplau|fiesta|bail/,
};

/* Comandos del público (el mensaje entero) */
const COMMANDS = [
  { re: /^!(wave|hi|hello|hola|saluda)$/i, action: { anim: 'wave', face: 'happy', gesture: 'wave', ms: 2500 } },
  { re: /^!(dance|baila|party|fiesta)$/i, action: { anim: 'celebrate', face: 'happy', gesture: 'cheer', ms: 3500 } },
  { re: /^!(love|heart|amor)$/i, action: { anim: 'love', face: 'love', gesture: 'tilt', ms: 3000 } },
  { re: /^!(wow|omg)$/i, action: { face: 'surprised', gesture: 'hop', ms: 2500 } },
  { re: /^!(sad|triste)$/i, action: { face: 'sad', gesture: 'tilt', ms: 2500 } },
  { re: /^!(laugh|lol|jaja|xd)$/i, action: { face: 'happy', gesture: 'laugh', ms: 2200 } },
];

const BIG_GIFT_DIAMONDS = 100;
const LIKE_BURST = 15;
const HURRY_AT_SECONDS = 5;

function commandFor(text) {
  const t = String(text || '').trim();
  const c = COMMANDS.find(cmd => cmd.re.test(t));
  return c ? c.action : null;
}

function reactionFor(event, d) {
  d = d || {};
  switch (event) {
    case 'gift':
      if (!(d.diamonds > 0)) return null;
      return { priority: 'high', key: 'gift', cooldownMs: 3000, queue: true, anim: 'celebrate', face: 'happy', gesture: 'cheer', ms: d.diamonds >= BIG_GIFT_DIAMONDS ? 5000 : 3200 };
    case 'greeting':
      return { priority: 'high', key: 'greeting', cooldownMs: 15000, anim: 'wave', face: 'happy', gesture: 'wave', ms: 2500 };
    case 'command': {
      const a = commandFor(d.text);
      return a ? { priority: 'high', key: 'command', cooldownMs: 5000, ...a } : null;
    }
    case 'follow':
      return { priority: 'high', key: 'follow', cooldownMs: 8000, queue: true, face: 'happy', gesture: 'nod', ms: 2200 };
    case 'game:over':
      return { priority: 'high', key: 'game:over', queue: true, anim: 'celebrate', face: 'happy', gesture: 'cheer', ms: 5000 };
    case 'round:question':
      return { priority: 'medium', key: 'round', face: 'thinking', gesture: 'think', ms: 2500 };
    case 'round:tick':
      if (d.phase !== 'answer' || d.remaining !== HURRY_AT_SECONDS) return null;
      return { priority: 'medium', key: 'hurry', face: 'surprised', gesture: 'hop', ms: 1500 };
    case 'round:results': {
      if (!d.totalVotes) return { priority: 'medium', key: 'round', face: 'sad', gesture: 'tilt', ms: 2800 };
      if (d.correctPct <= 25) return { priority: 'medium', key: 'round', face: 'surprised', gesture: 'shake', ms: 3000 };
      if (d.correctPct >= 85) return { priority: 'medium', key: 'round', face: 'happy', gesture: 'bounce', ms: 3000 };
      if (d.correctPct <= 50) return { priority: 'medium', key: 'round', face: 'surprised', gesture: 'shrug', ms: 2500 };
      return { priority: 'medium', key: 'round', face: 'happy', gesture: 'nod', ms: 2500 };
    }
    case 'live:join':
      return { priority: 'low', key: 'join', cooldownMs: 20000, gesture: 'nod', ms: 1200 };
    case 'live:like':
      if (!(d.count >= LIKE_BURST)) return null;
      return { priority: 'low', key: 'like', cooldownMs: 25000, face: 'happy', gesture: 'tilt', ms: 1800 };
    default:
      return null;
  }
}

module.exports = { INTENTS, COMMANDS, reactionFor, commandFor };
