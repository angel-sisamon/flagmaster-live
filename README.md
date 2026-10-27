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
| `server/` | Servidor del directo (Node). `index.js` conecta las piezas de `src/`: `tiktok.js` (conexión), `game.js` (rondas y puntos), `recorder.js` (graba cada directo), `standings.js` (TOP del mes en directo), `moderation.js` (`!optout`), `publisher.js` (sube a GitHub), `live-page.js` (página del directo), `chatbot/` (bot del chat, ver abajo), `vtuber/` (avatar en VTube Studio, ver abajo) |
| `client/` | Capa LIVE que se inyecta sobre el juego: pantallas, estilos, voz, fuegos artificiales y textos. Y `bot-panel.html`, el panel del bot (`/bot`) |
| `shared/stats.js` | Cálculo de clasificaciones, común al servidor y a la web |
| `data/sessions/AAAA-MM/` | **Fuente de verdad**: un JSON por directo. Se sube al repo |
| `data/moderation.json` | Quién no sale en la web (`optout` desde el chat, `banned` a mano) |
| `scripts/` | `aggregate.js` (sesiones → JSON de la web), `publish.js`, `demo-data.js`, `serve-site.js`, `studio-coords.js` y `studio-test.js` (bot) |
| `*.bat` | `arrancar_live.bat` (el directo), `coordenadas_chat.bat` y `probar_studio.bat` (bot → Studio), `probar_vtuber.bat` (avatar) |
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

## Voz del locutor

`client/live-voice.js` habla en inglés con locuciones pregeneradas con Gemini TTS (voz Kore), en
`client/voices/en/<grupo>/*.ogg` con su índice `index.json`: respuesta por país (`answer/jp-1`, `nobody/jp-1`),
saludos, likes, última pregunta, ganador, etc. Las frases no llevan nicks. Si falta un audio, la frase se dice con
la voz del navegador (`speechSynthesis`).

- Textos y estilo: `client/voices/phrases.json`. `npm run voices` genera solo lo nuevo o cambiado (necesita
  `GEMINI_API_KEY` en `.env`; ver opciones al inicio de `scripts/voices.js`).
- `npm run voices:check` transcribe los audios y lista los sospechosos; `npm run voices -- --redo <id>,<id>` los rehace.

## Avatar VTuber (opcional)

Con `VTUBER=1` en `.env`, el servidor mueve un avatar Live2D en **VTube Studio** por su API (WebSocket,
`ws://127.0.0.1:8001`) según lo que pasa en el directo. Si VTube Studio no está abierto, el directo sigue igual y se
reconecta solo cuando lo abras.

**La boca no la mueve el servidor:** VTube Studio hace el lip-sync escuchando un micrófono. El audio del navegador
(la voz del locutor) sale por **CABLE Input** (VB-Audio Virtual Cable) y en VTube Studio se elige como micrófono
**CABLE Output**: lo que suena, lo habla el avatar.

| Prioridad | Cuándo | Qué hace |
|---|---|---|
| Alta (corta lo demás) | Regalo · saludo en el chat · `!wave` `!dance` `!love` `!wow` `!sad` · follow · fin de partida | Celebra, saluda, corazón, sorpresa… |
| Media | Pregunta nueva · quedan 5 s · resultado de la ronda | Pensar; sorpresa si casi nadie acierta, alegría si casi todos, pena si nadie vota |
| Baja | Entra gente · ráfaga de likes · reposo | Asiente, inclina la cabeza, mira a un lado y a otro |

Los comandos del público tienen 20 s de espera por persona y 5 s entre comandos. Una reacción alta que llega mientras
hay otra espera su turno (regalos, follows, fin de partida) o se descarta (saludos, comandos).

**Qué hace con tu modelo:** busca por nombre (sin mayúsculas ni acentos) en sus hotkeys y expresiones: `happy`
(happy, smile, sonrisa…), `surprised` (surprise, shock, wow…), `sad`, `thinking`, `love` (heart, kiss…), `wave`
(wave, hello, saludo…), `celebrate` (cheer, clap, dance, baile…). Lo que no encuentra no lo hace, pero los gestos de
cabeza y cara (asentir, negar, inclinar, saltar, reír, pensar, encoger los hombros, mirar alrededor; sonrisa y cejas
para alegría y sorpresa) funcionan con cualquier modelo, y los de brazos si se enlazan (abajo). Para elegir a mano, `server/.vtuber-map.json`
(no va al repo; `""` desactiva):

```json
{ "anim": { "wave": "Saludo mano", "celebrate": "" }, "face": { "happy": "Smile.exp3.json" } }
```

### Piezas (`server/src/vtuber/`)

| Fichero | Qué hace |
|---|---|
| `vts-client.js` | Conexión (librería `ws` sin compresión: con el WebSocket de Node las respuestas de VTube Studio llegan vacías), token (`server/.vtuber-token`), latido cada 5 s y reconexión 1 s → 30 s |
| `avatar.js` | Hotkeys, expresiones y movimiento (cabeza `FaceAngleX/Y/Z`, sonrisa `MouthSmile`, cejas `Brows`, brazos `FMArmLeft/Right`, en modo suma, 20 veces por segundo): gestos, respiración y acompañar la voz (lee `VoiceVolume`) |
| `behavior.js` | Prioridades alta / media / baja con duración, cola corta, esperas por tipo y reposo |
| `rules.js` | Evento → reacción (tabla de arriba) y palabras clave de cada intención |
| `index.js` | Engancha juego, chat, regalos y follows |

### Preparar VTube Studio (una vez)

1. VTube Studio (Steam) con un modelo cargado. **Ajustes (rueda) → "Iniciar API"** activado, puerto 8001.
2. **Micrófono:** en los ajustes de VTube Studio, sección de micrófono, elige **CABLE Output**, activa el micrófono y
   el lip-sync simple (por volumen). En los ajustes del modelo, el parámetro de la boca (*Mouth Open*) con entrada
   `VoiceVolume` (o `VoiceVolumePlusMouthOpen` si además usas cámara). Sube la ganancia hasta que la boca se abra
   bien con la voz.
3. `probar_vtuber.bat`: la primera vez VTube Studio pregunta si permites "FlagMaster LIVE" → **Permitir**. Lista los
   hotkeys y expresiones, dice cuáles ha reconocido y hace una tanda de reacciones.
4. **Brazos** (opcional): al conectar se crean las entradas `FMArmLeft` y `FMArmRight` (-1 abajo, 1 arriba). En los
   ajustes del modelo, añade un parámetro por brazo: entrada `FMArmLeft` → salida `ParamArmLeftA` (y `FMArmRight` →
   `ParamArmRightA`), rangos -1…1 en los dos lados. Los nombres de salida dependen del modelo.
5. **Fondo para TikTok LIVE Studio:** fondo *Color Picker* verde puro (`00FF00`) en VTube Studio, cámara virtual de
   VTube Studio activada y, en Studio, fuente de cámara "VTube Studio Cam" con *recortar fondo → croma* en `00FF00`.
   Si Studio no ofrece croma, pasa por OBS (captura con *Transparent in capture* o Spout2 → cámara virtual de OBS).
6. **Sitio en pantalla:** con `VTUBER=1` las pantallas del directo dejan libre la **esquina inferior derecha** (38 % del
   ancho × 50 % del ancho de alto, con una luz de escenario). Coloca ahí la fuente del avatar en Studio, por encima de
   la captura del navegador. Para verlo sin VTube Studio: abre la página con `?avatar=1`.

Control: `/api/vtuber` (estado, modelo y lo reconocido) · `/api/vtuber/test?event=gift` (también `greeting`, `follow`,
`game:over`, `round:question`, `round:results&pct=10`, `command&text=!love`) · `/api/vtuber/refresh` (tras cambiar de
modelo) · `/api/vtuber/pause` · `/api/vtuber/resume`.

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

`npm test` (clasificaciones, grabador, recuperación tras cierre, regalos, identidad, página del directo, bot del chat y avatar).
