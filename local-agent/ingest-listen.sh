#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────
# Lado "servidor" del modo puente (ver push.sh, que corre en el TV box/dispositivo de la
# cancha). Escucha un push RTMP entrante y graba EXACTAMENTE la misma estructura de
# segmentos UTC que record.sh generaba en el dispositivo ("2026-10-06T13-00-00.mp4" etc.),
# para que uploader.py (sin ningún cambio) siga funcionando igual, solo que corriendo acá
# -con disco de verdad, no el de un TV box- en vez de en el dispositivo de la cancha.
#
# No recodifica (-c copy): solo recibe el stream tal cual lo empujó push.sh y lo trocea en
# segmentos. ffmpeg con "-listen 1" atiende UNA conexión entrante y termina cuando se corta;
# este script lo vuelve a levantar en loop para aceptar la próxima reconexión del dispositivo
# (wifi de la cancha, reinicio del TV box, etc.) — mismo esquema de reintento que record.sh.
# ──────────────────────────────────────────────────────────────
set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$DIR/lib.sh"
load_agent_config || exit 1

if ! command -v ffmpeg >/dev/null 2>&1; then
  log ingest "ffmpeg no esta instalado (en Ubuntu/Debian: sudo apt install ffmpeg). Abortando."
  exit 1
fi

PORT="${RTMP_LISTEN_PORT:-1935}"
APP_PATH="${RTMP_APP_PATH:-live/stream}"

log ingest "Escuchando push RTMP en rtmp://0.0.0.0:${PORT}/${APP_PATH}, segmentos de ${SEGMENT_SECONDS}s -> $RECORDINGS_DIR"

while true; do
  TZ=UTC ffmpeg -hide_banner -loglevel warning \
    -listen 1 \
    -i "rtmp://0.0.0.0:${PORT}/${APP_PATH}" \
    -c copy \
    -f segment -segment_time "$SEGMENT_SECONDS" -reset_timestamps 1 -strftime 1 \
    "$RECORDINGS_DIR/%Y-%m-%dT%H-%M-%S.mp4" \
    >> "$LOG_DIR/ingest.log" 2>&1

  log ingest "Conexion RTMP terminada/se corto (revisa $LOG_DIR/ingest.log) - esperando nueva conexion en 2s..."
  sleep 2
done
