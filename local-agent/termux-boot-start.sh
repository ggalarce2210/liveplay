#!/data/data/com.termux/files/usr/bin/bash
# Este archivo se copia a ~/.termux/boot/start-liveplay-agent.sh (lo hace install-termux.sh).
# Termux:Boot lo ejecuta solo cada vez que el dispositivo arranca - sin esto, el agente no
# sobreviviria un reinicio/corte de luz del TV box.
#
# Para correr en Linux "de verdad" (Raspberry Pi, mini PC) no se usa este archivo: se usan
# los .service de ../systemd en cambio.

# install-termux.sh reemplaza este placeholder por la ruta real de ESE checkout al copiar el
# archivo a ~/.termux/boot/ (con sed) - antes esto tenia la ruta "liveplay-repo" hardcodeada a
# mano, que rompia cualquier instalacion cuyo clon tuviera otro nombre de carpeta (bug real
# encontrado el 2026-09-18/19 en "Padel Club Tapalque", el clon se llamaba "liveplay-repro").
DIR="__LIVEPLAY_AGENT_DIR__"
LOG_DIR="$HOME/liveplay-agent/logs"
mkdir -p "$LOG_DIR"

# Evita que Android duerma la CPU mientras el agente corre en segundo plano (requiere el
# paquete termux-api instalado y la app "Termux:API").
command -v termux-wake-lock >/dev/null 2>&1 && termux-wake-lock

# OJO: invocar el interprete explicito (bash/python3) en vez de dejar que nohup resuelva el
# shebang solo - bug real encontrado el 2026-10-01 ("Padel Club Tapalque"/casa del usuario):
# en el contexto minimo en el que Termux:Boot dispara este script justo al terminar el
# arranque, nohup fallaba con "No such file or directory" al ejecutar record.sh/uploader.py
# por su shebang, aunque los archivos existieran y tuvieran permiso de ejecucion. Invocar el
# interprete a mano evita ese mecanismo por completo (verificado con un reinicio real).

# Modo puente (ver push.sh/ingest-listen.sh y la seccion "Modo puente" de AGENTE.md): si
# config.env tiene INGEST_RTMP_URL cargado con un valor real (no el placeholder de
# config.example.env), este dispositivo solo empuja el stream en vivo - no graba nada local ni
# corre uploader.py/watchdog.sh (eso corre del lado del servidor puente). Deteccion agregada el
# 2026-10-07 tras un reinicio real del TV box de "Los Pinos": este script todavia apuntaba al
# modo viejo (record.sh+uploader.py+watchdog.sh) desde antes de migrar a modo puente, asi que al
# reiniciarse el dispositivo no volvio a arrancar nada util solo (el partido de las 13hs se
# perdio por esto, no por un fallo del puente en si).
CONFIG_FILE="$DIR/config.env"
INGEST_URL=""
if [ -f "$CONFIG_FILE" ]; then
  INGEST_URL="$(grep -E '^INGEST_RTMP_URL=' "$CONFIG_FILE" | tail -n1 | cut -d= -f2- | tr -d '"'"'"'"')"
fi

if [ -n "$INGEST_URL" ] && [ "$INGEST_URL" != "rtmp://IP-DEL-SERVIDOR-PUENTE:1935/live/NOMBRE-CANCHA" ]; then
  nohup bash "$DIR/push.sh" >> "$LOG_DIR/push-boot.log" 2>&1 &
  echo "$(date -u +'%Y-%m-%dT%H:%M:%SZ') agente de LivePlay arrancado en MODO PUENTE (push.sh)" >> "$LOG_DIR/boot.log"
else
  nohup bash "$DIR/record.sh" >> "$LOG_DIR/record-boot.log" 2>&1 &
  nohup python3 "$DIR/uploader.py" >> "$LOG_DIR/uploader-boot.log" 2>&1 &

  # Vigia agregado el 2026-10-04: chequea cada pocos minutos que record.sh/ffmpeg/uploader.py
  # sigan vivos y los relanza solo si alguno se murio sin que nadie lo note (ver el comentario
  # largo en watchdog.sh para el incidente real que motivo esto - el disco interno se lleno dos
  # veces el mismo dia en "Complejo Los Pinos" porque ffmpeg/uploader.py se murieron callados).
  nohup bash "$DIR/watchdog.sh" >> "$LOG_DIR/watchdog-boot.log" 2>&1 &

  echo "$(date -u +'%Y-%m-%dT%H:%M:%SZ') agente de LivePlay arrancado (record.sh + uploader.py + watchdog.sh)" >> "$LOG_DIR/boot.log"
fi
