# CLAUDE.md — FlagMaster LIVE

Directo de TikTok de FlagMaster + estadísticas + web de clasificaciones mensuales. Ver `README.md` para la
arquitectura completa.

## Reglas

- **Las sesiones (`data/sessions/`) son la fuente de verdad.** Meses, histórico y récords se recalculan siempre con
  `shared/stats.js`; nunca guardar totales acumulados a mano. Si cambia el formato de sesión, sube `SCHEMA` y
  mantén la lectura del anterior.
- **El juego no se toca desde aquí.** `game/` es una copia del repo flag-master que solo se cambia con
  `npm run sync:game` (nunca a mano). La capa LIVE (`client/`) se inyecta en su `index.html` (`server/src/live-page.js`); lo que necesite del DOM del juego lo crea en `live-mode.js` (`_injectGameUi`).
  Depende de globales del juego: `renderQuestion`, `showScreen`, `t`, `cn`, `addTempClass`, `AudioFX`, `COUNTRIES`.
- **Sin dependencias en `shared/`, `scripts/aggregate.js` y `site/`**: GitHub Actions los ejecuta sin `npm install`.
- `site/` y `client/` en Vanilla JS. Todo texto de usuario (nicks, @) se escapa antes de pintarlo.
- Privacidad: nunca publicar el id real de TikTok (usar `identity.playerId`); respetar `data/moderation.json`.
- `npm test` antes de dar algo por terminado.
