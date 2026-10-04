#!/usr/bin/env bash
# Vigia: corre para siempre en segundo plano (lo arranca termux-boot-start.sh, igual que
# record.sh/uploader.py) y cada WATCHDOG_INTERVAL_SECONDS revisa que record.sh, ffmpeg y
# uploader.py sigan vivos. Si alguno se murio sin que nadie lo note, lo vuelve a levantar solo.
#
# Por que hace falta esto: el 2026-10-04, dos veces en el mismo dia, en "Complejo Los Pinos" el
# disco interno de Termux se lleno por completo porque ffmpeg y uploader.py se murieron solos
# (quedo vivo unicamente el wrapper de bash de record.sh, sin ningun ffmpeg real corriendo
# adentro, y uploader.py ni siquiera tenia proceso ni log) y la limpieza automatica de
# RETENTION_HOURS -que corre dentro de uploader.py- dejo de ejecutarse junto con el resto. Nadie
# se entero hasta que un partido quedo sin grabar. record.sh ya tiene su propio loop interno que
# relanza ffmpeg si se cae (ver record.sh), pero esa vez ese mecanismo tampoco alcanzo - este
# vigia es una segunda red de seguridad, independiente, que chequea los tres procesos desde
# afuera en vez de confiar en que cada script se cuide solo.
set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$DIR/lib.sh"
load_agent_config || exit 1

INTERVAL="${WATCHDOG_INTERVAL_SECONDS:-180}"

log_watchdog() {
  log watchdog "$*" >> "$LOG_DIR/watchdog.log" 2>&1
}

record_alive() { pgrep -f "record\.sh" >/dev/null 2>&1; }
ffmpeg_alive() { pgrep -x ffmpeg >/dev/null 2>&1; }
uploader_alive() { pgrep -f "uploader\.py" >/dev/null 2>&1; }

start_record() {
  nohup bash "$DIR/record.sh" >> "$LOG_DIR/record-boot.log" 2>&1 &
  log_watchdog "record.sh relanzado (PID $!)"
}

start_uploader() {
  nohup python3 "$DIR/uploader.py" >> "$LOG_DIR/uploader-boot.log" 2>&1 &
  log_watchdog "uploader.py relanzado (PID $!)"
}

command -v termux-wake-lock >/dev/null 2>&1 && termux-wake-lock
log_watchdog "vigia arrancado (chequeo cada ${INTERVAL}s)"

while true; do
  sleep "$INTERVAL"

  if ! record_alive; then
    log_watchdog "record.sh no esta corriendo - relanzando"
    start_record
  elif ! ffmpeg_alive; then
    # El wrapper de record.sh esta vivo pero no tiene ningun ffmpeg real adentro - es
    # exactamente el bug del 2026-10-04 (ver comentario de arriba). record.sh deberia relanzar
    # ffmpeg solo con su propio loop interno, pero por las dudas reiniciamos el wrapper entero
    # en vez de confiar en que se recupere solo.
    log_watchdog "record.sh esta vivo pero ffmpeg no - wrapper colgado, reiniciando record.sh"
    pkill -f "record\.sh" 2>/dev/null
    sleep 2
    start_record
  fi

  if ! uploader_alive; then
    log_watchdog "uploader.py no esta corriendo - relanzando"
    start_uploader
  fi
done
