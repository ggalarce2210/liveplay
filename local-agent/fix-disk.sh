#!/usr/bin/env bash
# Diagnostico + arreglo de un solo comando para el bug real encontrado el 2026-10-04 en el TV
# box de "Complejo Los Pinos": el almacenamiento interno de Termux (la particion /data del
# equipo, de pocos GB) se llena una y otra vez con grabaciones/temporales mientras la tarjeta
# SD de 32GB que esta insertada en el TV box queda practicamente sin usar - Termux NO graba ahi
# solo porque este insertada, hay que decirselo explicitamente (ver mas abajo, paso 4).
#
# Pensado para correrse con un solo renglon (sin copiar/pegar un script largo a mano, que en
# este TV box via AnyDesk resulto muy lento de tipear):
#   curl -sSL https://raw.githubusercontent.com/ggalarce2210/liveplay/main/local-agent/fix-disk.sh | bash
#
# Que hace, en orden:
#   1) Muestra cuanto ocupan recordings/ y tmp/ antes de tocar nada.
#   2) Los vacia (son archivos de trabajo descartables - record.sh y uploader.py los regeneran
#      solos; nunca se toca config.env ni los logs).
#   3) Mata record.sh/uploader.py/ffmpeg si quedaron corriendo (aunque sea a medias) y los
#      vuelve a levantar, invocando el interprete explicito (bash/python3) en vez de depender
#      del shebang - mismo fix ya aplicado a mano en este dispositivo el 2026-10-01 para el bug
#      de Termux:Boot, acá se repite para esta relanzada manual.
#   4) Prueba si se puede ESCRIBIR en alguna tarjeta SD montada (cualquier carpeta bajo
#      /storage/ que no sea la interna) - si encuentra una, lo avisa con instrucciones para
#      moverse ahi de forma permanente en vez de la interna.
set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$DIR/lib.sh"
load_agent_config || exit 1

echo "== 1) Ocupacion actual de recordings/ y tmp/ =="
du -sh "$RECORDINGS_DIR" "$TMP_DIR" 2>/dev/null || true
echo
df -h /data 2>/dev/null || df -h "$HOME"

echo
echo "== 2) Vaciando recordings/ y tmp/ (config.env y los logs NO se tocan) =="
rm -rf "${RECORDINGS_DIR:?}"/* "${TMP_DIR:?}"/* 2>/dev/null
echo "Listo. Espacio despues de limpiar:"
df -h /data 2>/dev/null || df -h "$HOME"

echo
echo "== 3) Reiniciando record.sh y uploader.py =="
pkill -f "record.sh" 2>/dev/null
pkill -f "uploader.py" 2>/dev/null
pkill ffmpeg 2>/dev/null
sleep 1
command -v termux-wake-lock >/dev/null 2>&1 && termux-wake-lock
nohup bash "$DIR/record.sh" >> "$LOG_DIR/record-boot.log" 2>&1 &
nohup python3 "$DIR/uploader.py" >> "$LOG_DIR/uploader-boot.log" 2>&1 &
sleep 4
echo "Procesos corriendo ahora:"
ps aux | grep -E "ffmpeg|record.sh|uploader.py" | grep -v grep || echo "(NINGUNO - algo sigue mal, revisa $LOG_DIR/record-boot.log y $LOG_DIR/uploader-boot.log)"

echo
echo "== 4) Buscando una SD donde grabar en vez de la interna =="
found_writable=""
for d in /storage/*; do
  name="$(basename "$d")"
  [ "$name" = "emulated" ] && continue
  [ "$name" = "self" ] && continue
  [ -d "$d" ] || continue
  testfile="$d/.liveplay_write_test"
  if ( echo ok > "$testfile" ) 2>/dev/null && [ "$(cat "$testfile" 2>/dev/null)" = "ok" ]; then
    rm -f "$testfile"
    echo "✅ Se puede escribir en: $d"
    found_writable="$d"
  else
    echo "❌ NO se puede escribir en: $d (falta permiso)"
  fi
done

if [ -n "$found_writable" ]; then
  echo
  echo "Encontre una SD escribible en $found_writable. Para que el agente grabe ahi en vez de"
  echo "la memoria interna, edita config.env (nano $DIR/config.env) y cambia estas 3 lineas:"
  echo "  RECORDINGS_DIR=$found_writable/liveplay-agent/recordings"
  echo "  TMP_DIR=$found_writable/liveplay-agent/tmp"
  echo "  LOG_DIR=$found_writable/liveplay-agent/logs"
  echo "y despues volve a correr este mismo script para que arranque con la config nueva."
else
  echo
  echo "Ninguna carpeta en /storage/ (aparte de la interna) resulto escribible todavia - hace"
  echo "falta darle permiso a Termux para la tarjeta SD desde Android (Ajustes > Apps > Termux >"
  echo "Permisos > Archivos y multimedia > Acceso a todos los archivos), o volver a correr"
  echo "termux-setup-storage despues de eso."
fi
