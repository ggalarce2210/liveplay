#!/usr/bin/env bash
# Vigia de la grabacion continua (ver record.sh / liveplay-agent-record.service). Corre
# periodico via el timer systemd que lo acompaña (liveplay-agent-record-watchdog.timer), NO en
# loop propio - alcanza con chequear cada par de minutos.
#
# Por que hace falta esto (incidente real, "Los Pinos", detectado 2026-10-26): el ffmpeg que
# lanza record.sh quedo colgado (sin escribir ningun segmento nuevo) durante varios dias
# seguidos, pero seguia figurando como "activo" tanto en `ps aux` como en `systemctl status`
# - el proceso nunca terminaba, solo dejaba de progresar - asi que record.sh (que solo reinicia
# ffmpeg cuando el proceso TERMINA) nunca lo relanzo. 42 partidos quedaron sin grabacion antes
# de que alguien lo notara a mano. Mismo patron exacto que el incidente de ingest-watchdog.sh
# del 2026-10-08 (ver ese archivo), solo que ahi ya tenian vigia y aca no.
#
# Este vigia no confia en el estado de systemd (justamente ese fue el engaño): verifica desde
# afuera si hay un segmento de grabacion que haya crecido/aparecido en los ultimos
# STALE_SECONDS. Si no, asume que ffmpeg quedo colgado y reinicia el servicio.
set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$DIR/lib.sh"
load_agent_config || exit 1

SERVICE_NAME="${RECORD_SERVICE_NAME:-liveplay-agent-record.service}"
STALE_SECONDS="${RECORD_WATCHDOG_STALE_SECONDS:-600}"

is_recording() {
  find "$RECORDINGS_DIR" -maxdepth 1 -name '*.mp4' -newermt "-${STALE_SECONDS} seconds" 2>/dev/null | grep -q .
}

if is_recording; then
  exit 0
fi

log watchdog-record "ALERTA: no hay ningun segmento nuevo en $RECORDINGS_DIR en los ultimos ${STALE_SECONDS}s - reiniciando $SERVICE_NAME (posible ffmpeg colgado, ver incidente 2026-10-26 en Los Pinos)."
sudo /usr/bin/systemctl restart "$SERVICE_NAME"
