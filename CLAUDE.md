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
- Bot del chat (`server/src/chatbot/`, panel `client/bot-panel.html`; ver README "Bot del chat"): frases sin emojis
  (Studio los pinta como una X) y siempre por `content-filter.js` (nada de pedir likes, follows, compartir, regalos ni
  enlaces). Escribe en TikTok LIVE Studio con ratón/teclado del sistema, no con navegador automatizado (TikTok oculta
  esos comentarios). No se disfraza la automatización ante TikTok: nada de ocultar el navegador automatizado ni de
  errores/borrados de tecleo simulados.
- `npm test` antes de dar algo por terminado.
