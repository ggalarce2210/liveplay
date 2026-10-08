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
sudo cp systemd/liveplay-ingest-listen.service systemd/liveplay-agent-uploader.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now liveplay-ingest-listen.service liveplay-agent-uploader.service
```
(Ajustar `User`/`WorkingDirectory` en los `.service` si no se llama `liveplay` el usuario del
VPS.) Confirmar que arrancó bien: `sudo systemctl status liveplay-ingest-listen.service` y
`journalctl -u liveplay-ingest-listen.service -f`.

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
