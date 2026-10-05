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
#
# Segunda vuelta (2026-10-05): relanzar los procesos no alcanza si la CAUSA de que se mueran
# sigue presente. Se repitio el mismo escenario en "Los Pinos": el disco interno volvio a
# llegar al 100%, lo cual mata a ffmpeg/uploader.py (no pueden escribir) y ademas los deja en un
# punto muerto - la limpieza por RETENTION_HOURS vive DENTRO de uploader.py, asi que si
# uploader.py ya murio por falta de espacio, nadie libera espacio para que pueda volver a
# arrancar. Relanzarlos sin mas simplemente los hace morir de nuevo al toque. Por eso el vigia
# ahora chequea el % de disco usado el mismo, de forma independiente de si los procesos estan
# vivos o no, y si esta critico libera espacio el mismo ANTES de que todo se caiga - no espera a
# que alguien note el problema y corra fix-disk.sh a mano.
#
# Tercera vuelta (2026-10-05, mas tarde el mismo dia): "Los Pinos" volvio a llenar el disco, pero
# esta vez la causa fue OTRO bug, en el reinicio de record.sh de mas abajo. Cuando record.sh
# estaba vivo pero sin ffmpeg real adentro, este vigia lo reiniciaba con `pkill -f "record\.sh"` -
# pero record.sh corre ffmpeg en PRIMER PLANO dentro de su propio loop (sin `exec`), y ese pkill
# solo matea al wrapper de bash (su linea de comando SI contiene "record.sh"), nunca al ffmpeg
# que tiene adentro (su linea de comando es "ffmpeg ...", no contiene "record.sh" en ningun
# lado). Bash no reenvia SIGTERM a sus hijos por default, asi que el ffmpeg viejo quedaba
# huerfano y siguiendo vivo, grabando en paralelo al ffmpeg nuevo que arrancaba el record.sh
# relanzado - cada reinicio sumaba un ffmpeg mas, todos escribiendo al mismo RECORDINGS_DIR al
# mismo tiempo, duplicando (o cuadriplicando) la velocidad real de consumo de disco sin que se
# notara en ningun ps aux puntual. Por eso ahora, antes de relanzar record.sh por cualquier
# motivo, se matan explicitamente TANTO el wrapper COMO cualquier ffmpeg suelto (`stop_record`).
set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$DIR/lib.sh"
load_agent_config || exit 1

INTERVAL="${WATCHDOG_INTERVAL_SECONDS:-180}"
DISK_CRITICAL_PERCENT="${DISK_CRITICAL_PERCENT:-90}"
DISK_SAFE_PERCENT="${DISK_SAFE_PERCENT:-75}"

log_watchdog() {
  log watchdog "$*" >> "$LOG_DIR/watchdog.log" 2>&1
}

record_alive() { pgrep -f "record\.sh" >/dev/null 2>&1; }
ffmpeg_alive() { pgrep -x ffmpeg >/dev/null 2>&1; }
uploader_alive() { pgrep -f "uploader\.py" >/dev/null 2>&1; }

# % de uso (0-100, solo el numero) de la particion que contiene RECORDINGS_DIR - en el TV box
# de "Los Pinos" es el almacenamiento interno compartido con el resto de Android, el mismo que
# se llena. `df -P` para formato POSIX estable entre Termux/busybox/coreutils.
disk_usage_percent() {
  df -P "$RECORDINGS_DIR" 2>/dev/null | awk 'NR==2 { gsub("%","",$5); print $5 }'
}

# Libera espacio sin esperar a que record.sh/uploader.py se mueran por falta de el. Primero lo
# mas facil y siempre seguro (TMP_DIR entero son archivos de trabajo descartables - clips a
# medio armar, uploader.py los reconstruye solos). Si con eso no alcanza, borra los segmentos de
# grabacion MAS VIEJOS primero (list_segments en uploader.py y record.sh los nombran por su hora
# de inicio en UTC via -strftime, asi que el orden alfabetico es el orden cronologico) hasta
# bajar de DISK_SAFE_PERCENT - nunca los mas nuevos, para no arriesgar la franja horaria de un
# partido que pueda estar jugandose ahora mismo.
emergency_disk_cleanup() {
  local usage
  usage="$(disk_usage_percent)"
  if [ -z "$usage" ] || [ "$usage" -lt "$DISK_CRITICAL_PERCENT" ]; then
    return 0
  fi

  log_watchdog "disco al ${usage}% (umbral critico ${DISK_CRITICAL_PERCENT}%) - liberando espacio antes de que mate ffmpeg/uploader.py"

  find "$TMP_DIR" -type f -delete 2>/dev/null

  usage="$(disk_usage_percent)"
  if [ -n "$usage" ] && [ "$usage" -ge "$DISK_CRITICAL_PERCENT" ]; then
    local f
    while IFS= read -r f; do
      [ -z "$f" ] && continue
      rm -f "$f" 2>/dev/null
      log_watchdog "borrado por espacio critico: $(basename "$f")"
      usage="$(disk_usage_percent)"
      [ -z "$usage" ] && break
      [ "$usage" -le "$DISK_SAFE_PERCENT" ] && break
    done < <(find "$RECORDINGS_DIR" -type f -name '*.mp4' 2>/dev/null | sort)
  fi

  usage="$(disk_usage_percent)"
  log_watchdog "limpieza de emergencia terminada - disco ahora al ${usage:-?}%"
}

# Mata el wrapper de record.sh Y cualquier ffmpeg suelto antes de relanzar - ver el comentario
# "Tercera vuelta" de arriba. pkill -x ffmpeg es seguro aca: este dispositivo solo graba UNA
# camara, asi que no hay otro ffmpeg legitimo al que se le pueda pisar el cable.
stop_record() {
  pkill -f "record\.sh" 2>/dev/null
  pkill -x ffmpeg 2>/dev/null
}

start_record() {
  nohup bash "$DIR/record.sh" >> "$LOG_DIR/record-boot.log" 2>&1 &
  log_watchdog "record.sh relanzado (PID $!)"
}

start_uploader() {
  nohup python3 "$DIR/uploader.py" >> "$LOG_DIR/uploader-boot.log" 2>&1 &
  log_watchdog "uploader.py relanzado (PID $!)"
}

command -v termux-wake-lock >/dev/null 2>&1 && termux-wake-lock
log_watchdog "vigia arrancado (chequeo cada ${INTERVAL}s, disco critico >=${DISK_CRITICAL_PERCENT}%)"
emergency_disk_cleanup

while true; do
  sleep "$INTERVAL"

  emergency_disk_cleanup

  if ! record_alive; then
    log_watchdog "record.sh no esta corriendo - relanzando"
    # stop_record por las dudas de que haya quedado un ffmpeg huerfano de un ciclo anterior
    # (ver "Tercera vuelta" arriba) aunque el wrapper ya este muerto.
    stop_record
    sleep 2
    start_record
  elif ! ffmpeg_alive; then
    # El wrapper de record.sh esta vivo pero no tiene ningun ffmpeg real adentro - es
    # exactamente el bug del 2026-10-04 (ver comentario de arriba). record.sh deberia relanzar
    # ffmpeg solo con su propio loop interno, pero por las dudas reiniciamos el wrapper entero
    # en vez de confiar en que se recupere solo.
    log_watchdog "record.sh esta vivo pero ffmpeg no - wrapper colgado, reiniciando record.sh"
    stop_record
    sleep 2
    start_record
  fi

  if ! uploader_alive; then
    log_watchdog "uploader.py no esta corriendo - relanzando"
    start_uploader
  fi
done
