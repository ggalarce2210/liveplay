#!/usr/bin/env bash
# --------------------------------------------------------------
# Grabacion continua de la camara RTSP de esta cancha, en segmentos de SEGMENT_SECONDS,
# con nombre = su hora de inicio en UTC ("2026-09-14T20-05-00.mp4"). No transcodifica
# (-c copy): solo copia el stream tal cual viene de la camara, asi que el uso de CPU es
# minimo - corre comodo hasta en un TV box Android por Termux.
#
# uploader.py despues arma el recorte de cada partido concatenando los segmentos que
# corresponden a su horario, sin que este script tenga que saber nada de partidos.
#
# Si ffmpeg se cae (wifi, la camara se reinicia, etc.) este script lo vuelve a levantar
# solo cada 5s - pensado para dejarlo corriendo para siempre (ver termux-boot/start-agent.sh
# o systemd/liveplay-agent-record.service).
# --------------------------------------------------------------
set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$DIR/lib.sh"
load_agent_config || exit 1

if ! command -v ffmpeg >/dev/null 2>&1; then
  log record "ffmpeg no esta instalado. En Termux: pkg install ffmpeg. Abortando."
    exit 1
    fi

    if [ -z "${RTSP_URL:-}" ] || [ "$RTSP_URL" = "rtsp://usuario:clave@192.168.1.50:554/stream1" ]; then
      log record "RTSP_URL no esta configurada (revisa $DIR/config.env). Abortando."
        exit 1
        fi

        log record "Arrancando grabacion continua de $RTSP_URL en segmentos de ${SEGMENT_SECONDS}s -> $RECORDINGS_DIR"

        # TZ=UTC es clave: asi el nombre de archivo (%Y-%m-%dT%H-%M-%S via -strftime 1) queda en
        # UTC, que es como el backend guarda/devuelve startTime/endTime de los partidos (timestamptz
        # -> JSON siempre en UTC). Sin esto, uploader.py tendria que lidiar con el huso horario del
        # dispositivo, que en un TV box puede estar mal configurado o cambiar solo.
        while true; do
          TZ=UTC ffmpeg -hide_banner -loglevel warning \
              -rtsp_transport tcp \
                  -i "$RTSP_URL" \
                      -c copy \
                          -f segment -segment_time "$SEGMENT_SECONDS" -reset_timestamps 1 -strftime 1 \
                              "$RECORDINGS_DIR/%Y-%m-%dT%H-%M-%S.mp4" \
                                  >> "$LOG_DIR/record.log" 2>&1

                                    log record "ffmpeg termino/se corto (revisa $LOG_DIR/record.log) - reintentando en 5s..."
                                      sleep 5
                                      done
                                      
