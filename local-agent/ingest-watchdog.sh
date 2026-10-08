#!/usr/bin/env bash
# Vigia del SERVIDOR PUENTE (ver ingest-listen.sh). Corre periodico via el timer systemd que lo
# acompaña (liveplay-ingest-watchdog.timer), NO en loop propio como record.sh/watchdog.sh del
# TV box - acá alcanza con chequear cada par de minutos, no hace falta un proceso siempre vivo.
#
# Por que hace falta esto (incidente real, 2026-10-08, "Los Pinos"): ingest-listen.sh corre
# "ffmpeg -listen 1" en un while-true que solo vuelve a escuchar cuando ese ffmpeg TERMINA. El
# 2026-10-08 a las 11:07 UTC la conexion entrante se cortó con un error de E/S a mitad de
# segmento, y el ffmpeg de esa conexión se quedó colgado intentando cerrar prolijo el archivo
# en vez de terminar — así que el while-true nunca volvió a relanzarlo. `systemctl status`
# siguió diciendo "active (running)" sin parar (el proceso seguía vivo, solo que colgado), y el
# puente quedó sordo a cualquier conexión nueva durante 7 horas, sin que nada lo marcara como
# roto. Se descubrió recién cuando un partido real (13hs hora local) no aparecio y se diagnosticó
# a mano vía SSH.
#
# Este vigia no confía en el estado de systemd (justamente ese fue el engaño): verifica desde
# afuera, por dos señales independientes, si el puente está realmente sirviendo para algo:
#   1. El puerto RTMP está en estado LISTEN (nadie conectado ahora mismo, pero disponible), o
#   2. Hay un segmento de grabación activo que creció en los últimos STALE_SECONDS (alguien
#      está empujando video ahora mismo).
# Si ninguna de las dos es cierta, asume que el ffmpeg de adentro quedó colgado (como en el
# incidente real) y reinicia el servicio — el próximo intento de conexión del TV box (que
# reintenta solo cada 5s, ver push.sh) encuentra el puente escuchando de nuevo.
set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$DIR/lib.sh"
load_agent_config || exit 1

PORT="${RTMP_LISTEN_PORT:-1935}"
SERVICE_NAME="${INGEST_SERVICE_NAME:-liveplay-ingest-listen.service}"
STALE_SECONDS="${INGEST_WATCHDOG_STALE_SECONDS:-90}"

is_listening() {
  command -v ss >/dev/null 2>&1 && ss -tlnp 2>/dev/null | grep -q ":${PORT} "
}

is_recording() {
  find "$RECORDINGS_DIR" -maxdepth 1 -name '*.mp4' -newermt "-${STALE_SECONDS} seconds" 2>/dev/null | grep -q .
}

if is_listening || is_recording; then
  exit 0
fi

log watchdog-puente "ALERTA: el puerto $PORT no esta en LISTEN y no hay ningun segmento activo en los ultimos ${STALE_SECONDS}s - reiniciando $SERVICE_NAME (posible ffmpeg colgado tras un corte de conexion, ver incidente 2026-10-08)."
systemctl restart "$SERVICE_NAME"
