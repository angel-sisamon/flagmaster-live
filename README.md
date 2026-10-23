# FlagMaster LIVE

FlagMaster en directo por TikTok: el chat responde con **A/B/C/D**, cada directo se graba y se acumula en una
**clasificación mensual** pública (GitHub Pages) que además lleva a la descarga del juego.

```
TikTok LIVE ──chat/likes/regalos──▶ server/ ──Socket.io──▶ página del directo (juego + client/)
                                       │
                         al terminar el directo: git commit + push de data/sessions/
                                       ▼
                     GitHub Actions: scripts/aggregate.js ──▶ site/ en GitHub Pages
```

## Estructura

| Carpeta | Qué hay |
|---|---|
| `game/` | Copia del juego (index, css, js, assets) con la que se juega el directo. Se actualiza con `npm run sync:game` |
| `server/` | Servidor del directo (Node). `index.js` conecta las piezas de `src/`: `tiktok.js` (conexión), `game.js` (rondas y puntos), `recorder.js` (graba cada directo), `standings.js` (TOP del mes en directo), `moderation.js` (`!optout`), `publisher.js` (sube a GitHub), `live-page.js` (página del directo) |
| `client/` | Capa LIVE que se inyecta sobre el juego: pantallas, estilos, voz, fuegos artificiales y textos |
| `shared/stats.js` | Cálculo de clasificaciones, común al servidor y a la web |
| `data/sessions/AAAA-MM/` | **Fuente de verdad**: un JSON por directo. Se sube al repo |
| `data/moderation.json` | Quién no sale en la web (`optout` desde el chat, `banned` a mano) |
| `scripts/` | `aggregate.js` (sesiones → JSON de la web), `publish.js`, `demo-data.js`, `serve-site.js` |
| `site/` | Web estática de clasificaciones (Vanilla JS). `site/data/` lo genera Actions |

El directo es **independiente del repo del juego**: juega con su propia copia en `game/`, que solo cambia cuando
tú lo decides. El servidor sirve esa copia y le añade la capa de `client/` (de ahí salen también países y modos), y
desactiva el aviso de "Actualización requerida" para que una versión mínima nueva de la app no bloquee el directo.

Para traer una versión nueva del juego (por ejemplo, tras añadir países):

```
npm run sync:game                 # rama development de ../flagmaster-capacitor/www
npm run sync:game -- main         # u otra rama, tag o commit
```

Se copia desde git, así que da igual en qué rama tengas abierto el juego. `game/VERSION.json` dice qué versión hay.
Prueba el directo y haz commit de `game/`.

## Hacer un directo

1. Copia `.env.example` a `.env` y pon `TIKTOK_USERNAME` (y `EULER_API_KEY` si la tienes).
2. Doble clic en `arrancar_live.bat` (o `npm start`).
3. Abre `http://localhost:3000` en el navegador que capturas en TikTok LIVE Studio y pulsa **LIVE**.
4. Al terminar: **Ctrl+C** en la consola. Se guarda el directo y se sube a GitHub; la web se actualiza en 1–2 minutos.

Si se va la luz o se cierra la ventana, nada se pierde: hay una copia continua en `server/.live/`. Al volver a
arrancar en menos de 30 minutos se **retoma el mismo directo**; si no, se guarda y se publica lo que hubo.
Si algo no se pudo subir, se reintenta al arrancar o con `npm run publish:data`.

**Comandos en el chat:** `A`/`B`/`C`/`D` responde · `!yo` (`!me`, `!rank`) muestra tu puesto del mes en pantalla ·
`!optout` te quita de la web.

**Pruebas sin TikTok** (arranca sin usuario = modo prueba, no graba salvo `LIVE_RECORD=1`):
`/api/test-vote?user=pepe&text=b` · `/api/test-chat?user=pepe&text=!yo` · `/api/test-join` · `/api/test-like?count=5` ·
`/api/test-gift?diamonds=10` · `/api/test-follow` · `/api/session` · `/api/session/finish`

## Qué se guarda de cada directo

Por jugador: @usuario, nick, puntos, mensajes en el chat, respuestas, aciertos, veces 1º en acertar, partidas jugadas y ganadas, mejor
racha, acierto más rápido y tiempo medio, aciertos por tipo de pregunta, likes, diamantes regalados, follows y shares.
Por pregunta: país, modo, votos, aciertos y reparto A/B/C/D. Por directo: duración, partidas, rondas, récord de
espectadores, mensajes, likes, regalos, follows, shares y entradas.

La web muestra además los totales históricos (jugadores únicos, quién repite, horas en directo, países distintos,
mensajes…), la evolución de jugadores por mes y récords como "más veces 1º" o "más mensajes".

El id del jugador es el id numérico de TikTok **cifrado** (no cambia aunque cambie el @, y el real nunca se publica).

## La web

- `npm run demo` → genera directos simulados y abre la web en `http://localhost:8080`.
- `npm run build:site && npm run serve:site` → la web con los datos reales de `data/`.
- Ajustes (enlace de Play Store con UTM, App Store, cuenta de TikTok, mínimos de las tablas): `site/js/config.js`.

### Visitas de la web

GitHub no da estadísticas de visitas de Pages (Insights → Traffic es solo del repo). La web trae
[GoatCounter](https://www.goatcounter.com) preparado: gratis, sin cookies (no hace falta banner de consentimiento).
Crea una cuenta, elige un código (p. ej. `flagmaster-live`) y ponlo en `goatcounter` de `site/js/config.js`.
Cuenta visitas por pantalla (portada, meses, fichas de jugador), procedencia, país y dispositivo, y los clics en
Google Play / App Store / TikTok (`download-android`, `download-ios`, `tiktok`). Las descargas reales se ven en
Play Console → Adquisición de usuarios (el enlace lleva UTM `tiktok_live`).

### Activar GitHub Pages (una vez)

1. Repo público en GitHub → **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. Haz push a `main`: el workflow `Web de clasificaciones` publica en `https://angel-sisamon.github.io/flagmaster-live/`.
3. (Opcional) Dominio propio: **Settings → Pages → Custom domain** + registro CNAME en tu DNS, y cambia `LIVE_SITE_URL`.

## Tests

`npm test` (clasificaciones, grabador, recuperación tras cierre, regalos, identidad y página del directo).
