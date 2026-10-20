# Agente local de LivePlay

Este archivo es al que apuntan los comentarios de `backend/src/agent/` y de la columna
`cameras.agentKeyHash` del schema - hasta el **2026-09-14** solo existia el contrato de API
del lado del backend (`GET /agent/matches/pending`, `POST /agent/matches/:id/video`), sin el
programa que realmente corre al lado de la camara. Ese programa es lo que vive en
[`../local-agent/`](../local-agent/) y lo que documenta este archivo.

## Que problema resuelve

Hoy, para que un video de un partido llegue a LivePlay, alguien tiene que subirlo a mano
(`POST /matches/:id/video` desde el panel). El agente local automatiza ese paso para canchas
que tienen una camara RTSP/IP/NVR/DVR propia (no aplica a camaras `IMOU_CLOUD` - esas no
exponen RTSP, solo streaming en vivo via la nube de Imou, ver el resumen del proyecto).

## Como funciona

Un dispositivo (Raspberry Pi, mini PC, o - para probar gratis - un TV box Android con
Termux) instalado en la red del complejo, con acceso de red a la camara:

1. **`record.sh`** graba la camara **de forma continua**, sin cortes, en segmentos chicos
   (5 minutos por default) nombrados con su hora de inicio en UTC. No recodifica el video
   (`-c copy`) - solo copia el stream tal cual sale de la camara, asi que el uso de CPU es
   minimo (funciona incluso en hardware muy limitado).
2. **`uploader.py`** cada un par de minutos le pregunta al backend
   (`GET /agent/matches/pending`) que partidos de *esa* cancha ya terminaron y todavia no
   tienen video. Para cada uno, junta los segmentos que grabo `record.sh` que corresponden a
   ese horario, los concatena y recorta exactamente a `[startTime, endTime]`, y sube el
   resultado (`POST /agent/matches/:id/video`) - ese endpoint ya dispara el pipeline real de
   HLS + thumbnails que corre en el backend, no hay nada nuevo del lado del servidor.
3. Los segmentos crudos se borran solos despues de `RETENTION_HOURS` para no llenar el
   disco. Si algo falla en el medio (sin internet, el backend caido, etc.) no se pierde nada:
   el partido va a seguir apareciendo en "pendiente" y se reintenta solo en la proxima vuelta.

Es el mismo par de scripts sea cual sea el hardware - lo unico que cambia entre un TV box
Android y una Raspberry/mini PC es *quien los arranca al prender el equipo* (Termux:Boot vs.
systemd), ver mas abajo.

## Camaras Dahua/Imou: RTSP directo cuando estan en la misma red (recomendado)

Si la camara (aunque sea marca Dahua o Imou) esta en la **misma red local** que el dispositivo
que corre este agente - el caso tipico de una cancha propia -, **no hace falta pasar por Imou
Cloud**: esa integracion (ver el resumen del proyecto, seccion "Integracion de camaras
Dahua/Imou") es solo para el caso en el que la camara *no* esta en la red del backend/agente,
sino asociada a una cuenta cloud. Con la camara en la misma red, conviene siempre RTSP directo
con este agente - es mas simple, no depende de un tercero (Imou), y no tiene el limite de una
sesion de streaming en vivo a la vez.

Las camaras Dahua (y la mayoria de las marcas que reusan su firmware/OEM) exponen RTSP en el
puerto 554 con este formato de URL:

```
rtsp://usuario:clave@IP-DE-LA-CAMARA:554/cam/realmonitor?channel=N&subtype=0
```

- `channel`: el numero de camara - `1` si es una camara IP standalone, o el numero de puerto
  correspondiente si el video sale de un NVR con varias camaras conectadas.
- `subtype`: `0` = stream principal (mejor calidad - recomendado para grabar, ya que
  `record.sh` no recodifica y esa va a ser la calidad final del clip), `1` = substream (mas
  liviano, util solo si la red del dispositivo no aguanta el stream principal).
- Usuario/clave: los mismos que usas para entrar a la camara por su app o interfaz web (no son
  las credenciales de la cuenta Imou Cloud, que aca no hace falta).

Esa URL es la que va en `RTSP_URL` dentro de `config.env` (ver
[`../local-agent/config.example.env`](../local-agent/config.example.env)) y tambien la que se
carga al agregar la camara en `/admin/canchas` eligiendo el modo **"RTSP / IP / NVR / DVR"**
(no "Imou Cloud").

## Paso 1: generar el token de la camara (desde el panel de admin)

Cada camara necesita su propio token. Se genera una sola vez desde el panel
(`/admin/canchas`, proximamente un boton dedicado) o llamando directo al endpoint con tu
sesion de SUPER_ADMIN/COMPLEX_ADMIN:

```
POST /cameras/:id/agent-token
```

La respuesta trae `{ "token": "..." }` - **es la unica vez que ese valor viaja en texto
plano**, no queda guardado en ningun lado mas que en el `config.env` del agente. Si se
pierde, se puede volver a generar (invalida el anterior).

## Paso 2 (recomendado para probar): instalar en un TV box Android con Termux

1. Instalar **Termux** - desde [F-Droid](https://f-droid.org/packages/com.termux/) o los
   [releases de GitHub](https://github.com/termux/termux-app/releases). **No** desde la Play
   Store (esa version quedo discontinuada y no se puede actualizar).
2. Instalar **Termux:Boot** - mismo origen (F-Droid/GitHub), es la app que hace que el
   agente arranque solo cuando prende el TV box.
3. (Opcional pero recomendado) Instalar **Termux:API**, para poder usar `termux-wake-lock`
   y evitar que Android pause el proceso en segundo plano.
4. En los ajustes de bateria de Android, sacarle a Termux cualquier restriccion de segundo
   plano ("sin restricciones"/"sin optimizar").
5. Dentro de Termux:
   ```bash
   pkg install git
   git clone <URL-del-repo> liveplay-repo
   cd liveplay-repo/local-agent
   bash install-termux.sh
   ```
   (`bash install-termux.sh`, no `./install-termux.sh` - git no siempre preserva el bit de
   ejecutable de los archivos al clonar/descargar, asi que el script se banca que lo llames
   asi la primera vez; a partir de ahi el mismo le da `chmod +x` a todo lo demas)
6. Editar `config.env` con el token del paso 1 y la URL RTSP real de la camara:
   ```bash
   nano config.env
   ```
7. **Probar antes de dejarlo desatendido**:
   ```bash
   ./check.sh
   ```
   Tiene que confirmar que la camara responde por RTSP y que el token es valido contra el
   backend.
8. Reiniciar el TV box una vez para confirmar que todo arranca solo, o arrancarlo a mano ya
   mismo con `./termux-boot-start.sh`.

Ver [`../local-agent/config.example.env`](../local-agent/config.example.env) para el
detalle de cada variable, y los logs quedan en `~/liveplay-agent/logs/` dentro del TV box.

## Paso 2 (alternativo, para produccion): Raspberry Pi / mini PC con Linux

Mismos scripts, sin Termux de por medio:
```bash
sudo apt install ffmpeg python3 curl
git clone <URL-del-repo> liveplay-repo
cd liveplay-repo/local-agent
cp config.example.env config.env   # y completarlo
chmod +x *.sh uploader.py
./check.sh                         # probar antes de instalar el servicio
sudo cp systemd/*.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now liveplay-agent-record.service liveplay-agent-uploader.service
```

## Modo puente (streaming en vivo, sin grabar en el dispositivo de la cancha)

Agregado el 2026-10-06 a raíz de un incidente real: el TV box de "Los Pinos" Cancha 1 tiene
muy poco disco libre (~1.9GB). Con el modo normal (`record.sh` grabando localmente),
cualquier pico de uso o corte de red hacía que la limpieza de emergencia por disco lleno
borrara segmentos crudos antes de que `uploader.py` llegara a subirlos — se perdieron
partidos enteros el 2026-10-05/06 (ver el resumen del proyecto).

La idea: sacarle a ese dispositivo la responsabilidad de grabar. En vez de eso, solo reenvía
("hace de puente") el video en vivo de la cámara a un servidor con disco de verdad (un VPS
cualquiera), que es el que realmente graba. Si se corta internet en el medio, se pierde lo
que no se llegó a empujar — a diferencia del modo normal, acá no hay colchón local — pero la
cámara Dahua igual guarda su propia grabación en la SD/NVR como último recurso.

### Qué corre dónde

**En el dispositivo de la cancha** (el TV box, con acceso RTSP a la cámara):
- `push.sh` en vez de `record.sh` — toma el RTSP de la cámara y lo empuja (`-c copy`, sin
  recodificar) como RTMP al servidor puente. No escribe nada a disco.
- Nada de `uploader.py` ni `watchdog.sh` acá — no hay segmentos locales que subir ni disco
  que cuidar.

**En el servidor puente** (un VPS con Linux, con una IP pública alcanzable desde la cancha):
- `ingest-listen.sh` en vez de `record.sh` — escucha el push RTMP entrante y graba los
  mismos segmentos UTC (`2026-10-06T13-00-00.mp4`, etc.) que `record.sh` grababa antes en el
  dispositivo.
- `uploader.py`, SIN NINGÚN CAMBIO — sigue preguntando al backend qué partidos faltan y
  subiendo el recorte, exactamente igual que siempre, solo que ahora lee los segmentos de
  acá en vez de del TV box.
- `ingest-watchdog.sh` + su timer systemd (`liveplay-ingest-watchdog.timer`) — chequeo de
  salud independiente, agregado el 2026-10-08 (ver la sección "Vigia del servidor puente" más
  abajo). No reemplaza nada, es una red de seguridad adicional.

### Instalación

**1. Generar credenciales nuevas para la cámara** (desde el panel de admin, o a mano:
`POST /cameras/:id/enrollment-code` con sesión de SUPER_ADMIN/COMPLEX_ADMIN, y canjear el
código con `POST /agent/enroll` — ver `enroll.sh`). Rota el token viejo, así que si el TV box
todavía tiene el agente clásico corriendo, dejá de usarlo antes de este paso.

**2. En el servidor puente** (ej. un droplet de DigitalOcean con Ubuntu):
```bash
sudo apt update && sudo apt install -y ffmpeg python3 git
git clone <URL-del-repo> liveplay-repo
cd liveplay-repo/local-agent
cp config.example.env config.env
nano config.env   # completar LIVEPLAY_API_BASE, AGENT_KEY (del paso 1), RTMP_LISTEN_PORT,
                   # RTMP_APP_PATH, y dejar RECORDINGS_DIR/TMP_DIR/LOG_DIR por default
chmod +x *.sh uploader.py
sudo ufw allow 1935/tcp   # si usás ufw: abrir el puerto RTMP
sudo cp systemd/liveplay-ingest-listen.service systemd/liveplay-agent-uploader.service systemd/liveplay-ingest-watchdog.service systemd/liveplay-ingest-watchdog.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now liveplay-ingest-listen.service liveplay-agent-uploader.service liveplay-ingest-watchdog.timer
```
(Ajustar `User`/`WorkingDirectory` en los `.service` si no se llama `liveplay` el usuario del
VPS — `liveplay-ingest-watchdog.service` es la excepción, ese va con `User=root` siempre, ver
el comentario en el archivo.) Confirmar que arrancó bien: `sudo systemctl status
liveplay-ingest-listen.service` y `journalctl -u liveplay-ingest-listen.service -f`. El
`.timer` del vigia NO hace falta confirmarlo enseguida (recién actúa si algo se cuelga), pero
se puede chequear que quedó programado con `systemctl list-timers | grep ingest-watchdog`.

**3. En el dispositivo de la cancha** (el TV box ya instalado, reemplazando el modo normal):
```bash
cd liveplay-repo/local-agent
# detener lo viejo primero (record.sh/uploader.py/watchdog.sh si estaban corriendo)
nano config.env   # completar/revisar RTSP_URL (igual que antes) e INGEST_RTMP_URL apuntando
                   # a rtmp://IP-DEL-DROPLET:1935/live/NOMBRE-CANCHA (mismo RTMP_APP_PATH
                   # que se configuró en el servidor puente)
chmod +x push.sh
bash push.sh   # probar a mano un rato, confirmar en el log del servidor puente que llega
```
Si funciona, dejarlo arrancando solo igual que antes (`termux-boot-start.sh` en Termux,
apuntando a `push.sh` en vez de `record.sh`+`uploader.py`+`watchdog.sh`).

### Limitaciones de este modo (además de las generales, más abajo)

- Sin colchón local: un corte de internet en la cancha durante el partido pierde ese tramo
  sin forma de recuperarlo desde el servidor (sí puede seguir estando en la grabación propia
  de la cámara/NVR, fuera de LivePlay).
- `ingest-listen.sh` solo acepta UNA conexión entrante a la vez por puerto — correcto para
  una cámara por servidor puente; para varias canchas en el mismo VPS, cada una necesita su
  propio `RTMP_LISTEN_PORT` (o su propio `RTMP_APP_PATH` con un servidor RTMP real en vez de
  este `ffmpeg -listen 1` minimalista, si en algún momento hace falta escalar a muchas
  cámaras en un mismo servidor).

### Vigia del servidor puente (`ingest-watchdog.sh`), agregado 2026-10-08

**Incidente real que motivó esto**: el 2026-10-08 a las 11:07 UTC, en "Los Pinos", la conexión
RTMP entrante se cortó con un error de E/S a mitad de un segmento. El `ffmpeg -listen 1` de
esa conexión no pudo cerrar prolijo el archivo y se quedó colgado en vez de terminar — y como
`ingest-listen.sh` solo vuelve a escuchar cuando ese `ffmpeg` termina (`while true; do ffmpeg
...; done`), el puente quedó sordo a cualquier conexión nueva durante **7 horas** (hasta que
se reinició el servicio a mano). Lo insidioso: `systemctl status` decía `active (running)`
todo ese tiempo, sin parar — el proceso seguía vivo, solo que colgado — así que nada avisó
que estaba roto hasta que un partido real no apareció y se diagnosticó por SSH.

**Fix**: `ingest-watchdog.sh` + `liveplay-ingest-watchdog.timer` (corre cada 2 minutos, ver
instalación más arriba). El vigia no confía en el estado de systemd (justamente ese fue el
engaño) — chequea desde afuera, con dos señales independientes, si el puente sirve para algo
ahora mismo: (1) el puerto `RTMP_LISTEN_PORT` está en estado `LISTEN` (`ss -tlnp`), o (2) hay
un segmento `.mp4` en `RECORDINGS_DIR` modificado en los últimos 90s (`INGEST_WATCHDOG_STALE_SECONDS`,
configurable). Si ninguna de las dos es cierta, asume que el `ffmpeg` de adentro quedó
colgado y corre `systemctl restart liveplay-ingest-listen.service` — el próximo intento de
reconexión del TV box (que reintenta solo cada 5s, ver `push.sh`) encuentra el puente
escuchando de nuevo sin que nadie tenga que notarlo ni intervenir a mano.

No reemplaza ningún mecanismo existente: es un chequeo adicional, igual en espíritu a
`watchdog.sh` del lado del TV box (ver la sección de arriba sobre ese), pero del lado del
servidor y apuntado específicamente al modo de falla real que ya se vio una vez.

## Escenario B: subida directa a storage (sin pasar por este backend)

Agregado el 2026-10-15 para "Complejo Los Pinos": un mini-PC con Windows (no un TV box ni una
Raspberry chica) con CPU y disco de sobra, donde conviene gastar ESA CPU local en vez de la
del backend (instancia chica de Render) — y de paso evitar que el video crudo de cada partido
tenga que viajar entero por la red de ingesta del backend antes de poder procesarse.

**Qué cambia respecto al modo normal**: `record.sh` sigue exactamente igual (sigue grabando
segmentos crudos sin tocar). Lo que cambia es el script que los convierte en el video final:
en vez de `uploader.py` (sube el recorte crudo a `POST /agent/matches/:id/video`, y es EL
BACKEND el que corre FFmpeg — HLS + thumbnails + poster), acá corre
[`uploader_direct.py`](../local-agent/uploader_direct.py), que:

1. Arma el mismo recorte exacto del partido que armaría `uploader.py` (mismo `build_clip`,
   compartido entre los dos en `agent_lib.py` para que nunca diverjan).
2. Corre FFmpeg LOCALMENTE para generar HLS + sprite de miniaturas + WebVTT + poster — réplica
   exacta, flag por flag, de `generateHls`/`generateThumbnailSprite`/`generatePoster` en
   `backend/src/video-processing/ffmpeg.service.ts` (con `-c:v copy` porque la cámara real de
   Los Pinos graba H.264 — si algún día no fuera así, el script detecta el codec con `ffprobe`
   y re-codifica solo, igual que el backend).
3. Pide `POST /agent/matches/:id/upload-plan` (ver `AgentService.createUploadPlan`): el
   backend deja el `video` en `PENDING` con su `storageBaseKey` de siempre, y devuelve una URL
   PUT firmada de 1h por archivo — nunca una credencial del bucket completo.
4. Sube cada archivo (manifest, ~segmentos .ts, sprite, vtt, poster) directo a esa URL.
5. Llama `POST /agent/matches/:id/finalize` (ver `AgentService.finalizeDirectUpload`): el
   backend verifica que lo esperable esté en storage (spot-check barato, no los ~600 segmentos
   uno por uno) y recién ahí escribe `videoSegments` + `videos.status=READY` +
   `matches.status=READY` + notificación `MATCH_READY` — mismo cierre que el pipeline legacy,
   en una implementación separada a propósito (ver el comentario en `AgentService` para el
   porqué de no reutilizar `VideoProcessingService`).

El pipeline legacy (`VideoProcessingService.runMatchVideoPipeline`) sigue sin tocarse — los
demás complejos siguen subiendo el video crudo y procesándolo en el backend, sin ningún cambio.

**Por qué hace falta STATE_DIR**: a diferencia del modo normal, acá `upload-plan` YA le avisa
al backend "este partido está en proceso" — a partir de ese momento el partido deja de
aparecer en `/agent/matches/pending` (solo lista partidos SIN video o con video `FAILED`), así
que si el script se cortara a mitad de camino sin guardar nada, ese partido quedaría colgado en
`PROCESSING` para siempre, sin que nada lo reintente solo. Por eso `uploader_direct.py` guarda
en `TMP_DIR/direct-uploads/<matchId>/` todo lo necesario para retomar exactamente donde quedó
(los archivos de FFmpeg ya generados, el upload-plan con sus URLs, y qué archivos ya se
subieron con éxito) — en cada vuelta, ANTES de preguntar por partidos nuevos, primero retoma
cualquier partido que haya quedado a medio subir. Ver el comentario grande al principio de
`uploader_direct.py` para el detalle completo (incluye cómo se renueva el upload-plan si pasó
demasiado tiempo y las URLs firmadas ya vencieron).

### Instalación en un mini-PC con Windows — WSL2 (recomendado)

Windows no tiene bash/systemd nativo, así que hace falta algo que corra los scripts de
`local-agent/` sin reescribirlos. Se eligió **WSL2 con systemd habilitado** en vez de portar
todo a PowerShell nativo, por dos motivos concretos: (a) `record.sh`/`watchdog.sh` ya tienen
varios bugs reales ya encontrados y arreglados (ver los comentarios largos en `watchdog.sh` —
el caso de `pgrep` faltante, el de los ffmpeg huérfanos, etc.) que una reescritura desde cero
en PowerShell arriesgaría reintroducir; (b) `uploader_direct.py` (como `uploader.py`) ya es
Python puro + llamadas a `ffmpeg`/`curl`, 100% portable sin cambios bajo WSL.

1. **Habilitar WSL2 y una distro** (PowerShell como administrador, una sola vez):
   ```powershell
   wsl --install -d Ubuntu
   ```
   Reiniciar si lo pide, y completar la creación de usuario de la distro cuando abra.

2. **Habilitar systemd dentro de la distro** (sin esto no se puede usar `systemctl` adentro de
   WSL): dentro de la distro Ubuntu,
   ```bash
   sudo tee -a /etc/wsl.conf <<'EOF'
   [boot]
   systemd=true
   EOF
   ```
   y desde PowerShell: `wsl --shutdown` (cierra WSL del todo) y volver a abrir la distro para
   que el cambio tome efecto.

3. **Instalar dependencias e instalar el agente** — desde acá en adelante es EXACTAMENTE el
   mismo paso a paso que ["Paso 2 (alternativo, para producción): Raspberry Pi / mini PC con
   Linux"](#paso-2-alternativo-para-produccion-raspberry-pi--mini-pc-con-linux) de más arriba,
   corrido DENTRO de la distro Ubuntu de WSL, con dos diferencias: en el paso de `systemctl
   enable --now`, habilitar `liveplay-agent-record.service` +
   [`liveplay-agent-uploader-direct.service`](../local-agent/systemd/liveplay-agent-uploader-direct.service)
   (NO `liveplay-agent-uploader.service` — son mutuamente excluyentes, instalar solo uno de los
   dos) y, en vez de `./check.sh`, usar `./check.sh` igual (prueba la cámara y el token, no
   depende del modo de subida).

4. **Arrancar WSL solo al prender la PC**: por default, WSL2 no arranca solo con Windows. La
   forma más simple es una tarea en el Programador de tareas de Windows que corra al iniciar
   sesión:
   - Programador de tareas → Crear tarea básica → Desencadenador: "Al iniciar sesión" →
     Acción: "Iniciar un programa" → Programa: `wsl.exe` → Argumentos: `-d Ubuntu -u root -e
     true` (alcanza con que WSL arranque una vez; systemd adentro ya deja corriendo los
     servicios solo).
   - En las propiedades de esa tarea, marcar "Ejecutar tanto si el usuario inició sesión como
     si no" y "Ejecutar con los privilegios más altos", así funciona incluso si la PC arranca
     sin que nadie haga login a Windows (caso típico de un mini-PC desatendido en una cancha).

5. **Red**: la cámara RTSP y el backend de LivePlay se alcanzan con conexiones SALIENTES desde
   WSL2 (modo NAT por default) — no hace falta "mirrored networking" ni abrir ningún puerto en
   el firewall de Windows para que esto funcione, a diferencia de si quisiéramos que algo DE
   AFUERA se conecte hacia adentro de WSL (no es el caso acá).

### Limitaciones de este modo (además de las generales, más abajo)

- Usa la CPU/disco del mini-PC en vez de la del backend — tiene que ser efectivamente un
  equipo con margen (no un TV box Android limitado; para esos sigue siendo mejor el modo
  normal o el modo puente).
- Requiere `ffmpeg`/`ffprobe` instalados en el dispositivo (ya hace falta para `record.sh`, así
  que en la práctica ya están).
- Las URLs de subida vencen a la hora — no es un problema en uso normal (`uploader_direct.py`
  pide un upload-plan nuevo solo si hace falta), pero una conexión MUY lenta subiendo un
  partido MUY largo en teoría podría necesitar más de un refresh; no se vio en la práctica
  todavía.
- Probado de punta a punta en sandbox (incluyendo el camino de reintento con `STATE_DIR` a
  propósito simulando un corte a mitad de subida) pero todavía no instalado en producción real
  en Los Pinos — ese es el próximo paso.

## Chequeo de movimiento (sin reservas reales, agregado 2026-10-20)

LivePlay genera un partido "placeholder" por cada hora de funcionamiento de la cancha
(`MatchSchedulerService.ensureUpcomingMatches`, cron horario), haya o no una reserva real —
hoy no está integrado con el sistema de turnos que usa cada complejo para que la gente reserve
cancha (en "Los Pinos" es [CanchaYa](https://canchaya.ar/), un SaaS de terceros sin API/webhook
documentado — investigado el 2026-10-20: solo tiene paneles pensados para que los mire una
persona, nada pensado para que otro sistema lea sus reservas). Resultado: la mayoría de los
partidos "pendientes" corresponden a horas en las que la cancha estuvo vacía, y procesar/subir
un video de eso (FFmpeg local + ancho de banda) es tiempo tirado.

En vez de depender de CanchaYa (requeriría o acceso de partner, incierto, o scraping de su web
logueada — frágil, probablemente contra sus términos de servicio), se mide actividad directo
sobre la grabación propia: `agent_lib.measure_motion` usa el filtro `signalstats` de FFmpeg
(que ya usamos en todos lados en este mismo directorio) para calcular el MAFD ("Mean Absolute
Frame Difference") de una ventana corta del partido — un número que crece cuanto más cambia la
imagen de un frame al siguiente. Cancha vacía: MAFD bajo y estable (ruido de cámara, cambios de
luz). Gente jugando: MAFD alto y sostenido. No es "IA"/machine learning, es un filtro de FFmpeg
con un umbral.

`uploader_direct.py` (`check_motion_for_match`) arma un clip CORTO (no el partido entero,
`MOTION_CHECK_OFFSET_SECONDS`/`MOTION_CHECK_DURATION_SECONDS` en `config.env`, default 10 min
de offset + 5 min de muestra) antes de decidir si vale la pena armar el HLS completo y subirlo.
`MOTION_CHECK_MODE` controla qué hace con el resultado:

- `off`: no chequea nada (comportamiento de antes de esto).
- `dry_run` (**default**): mide y loguea el MAFD, pero sigue procesando el partido igual —
  pensado para calibrar `MOTION_CHECK_MAFD_THRESHOLD` con partidos reales (revisar los logs de
  `uploader-direct` después de un partido real y comparar el MAFD logueado contra "hubo gente
  jugando o no") antes de confiar en que esto no se coma un partido de verdad.
- `enforce`: si el chequeo da "sin movimiento", llama a `POST /agent/matches/:id/mark-empty`
  (`AgentService.markEmpty`) en vez de procesar — marca el partido `FAILED` (mismo estado que
  ya excluye `AgentService.pendingMatches`, sin necesidad de ningún estado/columna nueva) con
  el MAFD medido guardado en `matches.resultSummary` solo a fines de diagnóstico.

**No pasar a `enforce` sin antes revisar un puñado de partidos reales en modo `dry_run`** — un
umbral mal calibrado en `enforce` puede marcar como "vacía" una cancha que sí tuvo partido (por
ejemplo pádel con jugadores quietos en las esquinas, o mala luz) y esa grabación real nunca
llega a subirse. Mientras tanto, dejar corriendo en `dry_run`.

## Limitaciones conocidas de esta primera version

- El corte del video al horario exacto del partido usa `-c copy` (sin recodificar) en las
  dos etapas, asi que el arranque/final puede quedar en el keyframe mas cercano en vez de al
  segundo exacto - un desfasaje de hasta un par de segundos, no un problema para ver el
  partido completo, pero algo a mejorar si en algun momento se necesita precision de frame.
- Si el partido no tiene `endTime` cargado (lo mas comun hoy), el agente asume que termino
  `BUFFER_MINUTES` despues de `startTime` - mismo criterio que ya usa
  `AgentService.pendingMatches` del lado del backend.
- No hay reintentos de subida con backoff explicito mas alla de "esperar a la proxima
  vuelta del loop" (cada `POLL_SECONDS`) - es suficiente porque el partido sigue apareciendo
  como pendiente hasta que se suba con exito, pero no hay alertas si queda fallando muchas
  veces seguidas (a futuro: un endpoint de heartbeat/estado del agente, o notificar al admin).
- No se probo todavia en un TV box real corriendo varios dias seguidos - la persistencia de
  procesos en segundo plano en Android puede variar segun el fabricante/version, ver la
  conversacion del 2026-09-14 en el resumen del proyecto para el detalle de ese riesgo.
