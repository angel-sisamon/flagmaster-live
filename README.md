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
| `server/` | Servidor del directo (Node). `index.js` conecta las piezas de `src/`: `tiktok.js` (conexión), `game.js` (rondas y puntos), `recorder.js` (graba cada directo), `standings.js` (TOP del mes en directo), `moderation.js` (`!optout`), `publisher.js` (sube a GitHub), `live-page.js` (página del directo), `chatbot/` (bot del chat, ver abajo) |
| `client/` | Capa LIVE que se inyecta sobre el juego: pantallas, estilos, voz, fuegos artificiales y textos. Y `bot-panel.html`, el panel del bot (`/bot`) |
| `shared/stats.js` | Cálculo de clasificaciones, común al servidor y a la web |
| `data/sessions/AAAA-MM/` | **Fuente de verdad**: un JSON por directo. Se sube al repo |
| `data/moderation.json` | Quién no sale en la web (`optout` desde el chat, `banned` a mano) |
| `scripts/` | `aggregate.js` (sesiones → JSON de la web), `publish.js`, `demo-data.js`, `serve-site.js`, `studio-coords.js` y `studio-test.js` (bot) |
| `*.bat` | `arrancar_live.bat` (el directo), `coordenadas_chat.bat` y `probar_studio.bat` (bot → Studio) |
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

## Bot del chat (opcional)

Con `CHATBOT=1` en `.env`, al arrancar se abre **`http://localhost:3000/bot`**: un panel que va proponiendo mensajes
para el chat según lo que pasa, en inglés y sin emojis. Cada tarjeta: **Copiar**, **Otra** (otra frase del mismo
tipo), **✕** (descartar) y, con Studio configurado, **Enviar a Studio**. Cuando el mensaje vuelve por el chat se marca
como enviado (y no cuenta en las estadísticas de quien emite). **Pausar** deja de proponer sin parar el juego.

| Prioridad | Cuándo | Qué propone |
|---|---|---|
| 1 | En plena votación alguien escribe el nombre de un país ("España", "spain") | Recordarle que cuenta la letra A/B/C/D (una vez por persona cada 10 min; como mucho uno cada 25 s) |
| 2 | Alguien saluda ("hola", "hey", "buenas noches", "bonjour"…) | Saludarle por su @ (una vez por directo) |
| 3 | Empieza la partida, va por la mitad (≥ 6 rondas), quedan 3 (≥ 8 rondas), última ronda, termina | Un mensaje del momento ("Halfway there!", "Last round!", "GG! Congrats Ana" — no nombra a quien hizo `!optout`) |
| 3 | Si no toca ninguno: acaba una ronda que casi nadie (≤ 25 %) o casi todo el mundo (≥ 85 %) acertó | A veces, una reacción ("That one was tough!") |
| 4 | No se ha propuesto nada en 45–90 s (`CHATBOT_IDLE_MIN/MAX`) | Una frase suelta, curiosidad de banderas o pregunta |

### Piezas (`server/src/chatbot/`)

| Fichero | Qué hace |
|---|---|
| `index.js` | Las reglas de arriba: escucha `handleChat` y los eventos `gameStart` / `roundEnd` / `gameEnd` de `game.js` |
| `brain.js` | Detecta saludos (varios idiomas) y nombres de país (los de `COUNTRIES`), carga y elige frases sin repetir, quita emojis |
| `phrases/en.json` | ~420 frases por categoría: `greetings`, `game_rules_reminder`, `idle_chat`, `round_hard`, `round_easy`, `game_start`, `game_mid`, `game_final_stretch`, `game_last_round`, `game_end`, `game_end_winner`. `{user}` = @ de quien escribe, `{winner}` = nick de quien gana. Otro idioma: `<idioma>.json` + `CHATBOT_LANG` (lo que falte sale de inglés) |
| `content-filter.js` | Veta pedir likes, follows, compartir, regalos y enlaces (al cargar y al enviar; `npm test` falla si alguna frase lo incumple) |
| `queue.js` | Cola de sugerencias: por prioridad, sin caducadas, como mucho 6 por minuto |
| `senders.js` | Adónde van: al panel (`suggest`) o a la consola (`console`, `CHATBOT_SENDER=console`) |
| `studio.js` | Escribe en el chat de TikTok LIVE Studio con ratón y teclado (`@jitsi/robotjs` + `clipboardy`) |
| `win32.js` | Pregunta a Windows (`koffi` → user32): qué ventana hay en un punto, cuál está activa, si es administrador, cuánto hace que se tocó el ratón |
| `autopilot.js` | Envío automático a Studio a ritmo variable |

Sin emojis porque TikTok LIVE Studio los pinta como una X (si alguno se cuela, p. ej. en un nick, se quita antes de enviar).

### Escribir en TikTok LIVE Studio

**Enviar a Studio** (`CHATBOT_STUDIO=1` + `CHAT_X` / `CHAT_Y` en `.env`): el servidor comprueba que en ese punto está
Studio, hace clic en su caja de chat, escribe el mensaje, pulsa Enter y devuelve el ratón y el portapapeles como
estaban. `CHAT_INPUT_METHOD=paste` lo pega de golpe; `type` lo teclea letra a letra a ritmo de persona y se para (sin
pulsar Enter) si cambias de ventana mientras escribe. Al teclear comete de vez en cuando un error (una tecla vecina),
escribe alguna letra más, lo borra con Retroceso y sigue. El botón **Ajustes** del panel cambia en caliente el método,
el ritmo, las pausas y los errores; se guarda en `server/.chatbot-studio.json` (no va al repo) y manda sobre
`CHAT_INPUT_METHOD`. **Restablecer** vuelve a los valores de fábrica.

1. Una vez: abre Studio donde lo vayas a tener (mejor en el monitor principal), doble clic en `coordenadas_chat.bat`,
   deja el ratón sobre la caja de chat 15 s y copia `CHAT_X` / `CHAT_Y` al `.env`. Si mueves o redimensionas Studio,
   repítelo.
2. `probar_studio.bat` lo prueba sin enviar nada: dice qué ventana hay en el punto, si Studio queda activo y deja un
   texto de prueba en la caja (bórralo a mano).
3. **Studio como administrador**: Windows (UIPI) descarta el ratón y el teclado simulados de un programa normal hacia
   uno de administrador; se ve el ratón encima de la caja pero no pasa nada. Abre Studio sin "Ejecutar como
   administrador" (o abre los `.bat` también como administrador). `probar_studio.bat` y el panel lo detectan y lo dicen.

**Manual / Automático** (arriba en el panel, solo con Studio): en automático las sugerencias se escriben solas, sin
ritmo fijo (a veces una, a veces dos o tres seguidas y luego un descanso de 20–70 s, a veces más; las de normas no
esperan) y nunca mientras estés tocando el ratón o el teclado. Arranca siempre en manual y vuelve a manual tras 3 fallos.

**Lo que no se hace (decidido):** escribir desde un navegador automatizado (se probó con Playwright: TikTok oculta esos
comentarios al resto del directo, solo los ve quien los envía).

Control: `/api/chatbot` (estado) · `/api/chatbot/pause` · `/api/chatbot/resume` · `/api/chatbot/say?text=...` (propone
ese texto). En modo prueba (sin usuario de TikTok): `/api/test-chat?user=pepe&text=hola`.

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

`npm test` (clasificaciones, grabador, recuperación tras cierre, regalos, identidad, página del directo y bot del chat).
