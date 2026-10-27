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
# BUG REAL de la primera version de este vigia (encontrado 2026-10-27, misma Los Pinos, un dia
# despues de escribir esto): chequeaba frescura con `find -newermt`, que mira la fecha de
# MODIFICACION del archivo - pero un ffmpeg colgado en el corte de segmento sigue escribiendo
# bytes dentro del MISMO archivo sin rotar nunca a uno nuevo, asi que el mtime de ese archivo
# se actualiza todo el tiempo igual. Resultado: un archivo de 17GB que arranco a las 05:00 y
# nunca roto a un segmento nuevo en toda la mañana, con mtime "fresco" a cada rato -> este
# vigia SIEMPRE lo via como "grabando bien" y nunca reinicio nada durante ~18hs seguidas.
#
# Fix: en vez de mirar mtime, parseamos la hora de ARRANQUE que ya viene codificada en el
# nombre del archivo mas nuevo (record.sh usa `-strftime 1` con formato
# %Y-%m-%dT%H-%M-%S.mp4 - ver record.sh) y la comparamos contra "ahora". Si no aparecio NINGUN
# segmento nuevo (por nombre, no por mtime) en los ultimos STALE_SECONDS, asumimos que ffmpeg
# quedo colgado sin rotar y reiniciamos.
set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$DIR/lib.sh"
load_agent_config || exit 1

SERVICE_NAME="${RECORD_SERVICE_NAME:-liveplay-agent-record.service}"
STALE_SECONDS="${RECORD_WATCHDOG_STALE_SECONDS:-600}"

is_recording() {
local latest
latest="$(find "$RECORDINGS_DIR" -maxdepth 1 -name '*.mp4' -printf '%f\n' 2>/dev/null | sort | tail -n1)"
[ -n "$latest" ] || return 1

# latest tiene forma "2026-10-27T23-38-28.mp4" (ver record.sh) - lo pasamos a un formato que
# `date -d` entienda sin ambiguedad (los guiones en la parte de la hora no son validos ahi).
local ts="${latest%.mp4}"
if [ "${#ts}" -ne 19 ]; then
# Nombre con un formato inesperado (no deberia pasar nunca con record.sh actual) - no
# confiamos en parsearlo mal, pero tampoco reiniciamos a ciegas por un parseo raro.
log watchdog-record "AVISO: nombre de segmento con formato inesperado ('$latest'), no se pudo chequear frescura por nombre."
return 0
fi
local iso="${ts:0:10}T${ts:11:2}:${ts:14:2}:${ts:17:2}"
local epoch
epoch="$(date -d "$iso" +%s 2>/dev/null)" || return 1
local now
now="$(date +%s)"
(( now - epoch < STALE_SECONDS ))
}

if is_recording; then
exit 0
fi

log watchdog-record "ALERTA: no aparecio ningun segmento NUEVO en $RECORDINGS_DIR en los ultimos ${STALE_SECONDS}s (chequeado por nombre de archivo, no por mtime) - reiniciando $SERVICE_NAME (posible ffmpeg colgado sin rotar segmento, ver incidentes 2026-10-26 y 2026-10-27 en Los Pinos)."
sudo /usr/bin/systemctl restart "$SERVICE_NAME"
