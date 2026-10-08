#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────
# "Modo puente": reemplazo de record.sh para dispositivos sin disco confiable para grabar
# (el caso real que motivó esto: el TV box de "Los Pinos" Cancha 1, con ~1.9GB libres, donde
# la limpieza de emergencia por disco lleno terminaba borrando segmentos antes de que
# uploader.py los subiera — partidos enteros perdidos el 2026-10-05/06, ver el resumen del
# proyecto).
#
# En vez de grabar localmente, este script EMPUJA el stream RTSP de la cámara tal cual
# (-c copy, sin recodificar, mismo costo de CPU mínimo que record.sh) como RTMP hacia un
# servidor remoto con disco de verdad (ver ingest-listen.sh, que corre allá y es el que
# realmente graba los segmentos — uploader.py sigue siendo el mismo, corriendo en ese
# servidor en vez de en este dispositivo).
#
# Este dispositivo queda sin ninguna copia del video: si se corta la conexión a internet se
# pierde lo que no se llegó a empujar (decisión explícita del usuario, 2026-10-06 — la cámara
# Dahua igual guarda su propia grabación en la SD/NVR como último recurso).
#
# Si ffmpeg se cae (wifi, la cámara se reinicia, el servidor remoto no responde, etc.) este
# script lo vuelve a levantar solo cada 5s, igual que record.sh.
# ──────────────────────────────────────────────────────────────
set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$DIR/lib.sh"
load_agent_config || exit 1

if ! command -v ffmpeg >/dev/null 2>&1; then
  log push "ffmpeg no esta instalado. En Termux: pkg install ffmpeg. Abortando."
  exit 1
fi

if [ -z "${RTSP_URL:-}" ] || [ "$RTSP_URL" = "rtsp://admin:clave@192.168.1.50:554/cam/realmonitor?channel=1&subtype=0" ]; then
  log push "RTSP_URL no esta configurada (revisa $DIR/config.env). Abortando."
  exit 1
fi

if [ -z "${INGEST_RTMP_URL:-}" ] || [ "$INGEST_RTMP_URL" = "rtmp://IP-DEL-SERVIDOR-PUENTE:1935/live/NOMBRE-CANCHA" ]; then
  log push "INGEST_RTMP_URL no esta configurada (revisa $DIR/config.env). Abortando."
  exit 1
fi

log push "Modo puente: empujando $RTSP_URL -> $INGEST_RTMP_URL (sin grabar nada en este dispositivo)"

while true; do
  ffmpeg -hide_banner -loglevel warning \
    -rtsp_transport tcp \
    -i "$RTSP_URL" \
    -c copy \
    -f flv \
    "$INGEST_RTMP_URL" \
    >> "$LOG_DIR/push.log" 2>&1

  log push "ffmpeg termino/se corto (revisa $LOG_DIR/push.log) - reintentando en 5s..."
  sleep 5
done
