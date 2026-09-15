#!/usr/bin/env bash
# Prueba rapida antes de dejar el agente corriendo para siempre: confirma que (1) la camara
# RTSP responde, y (2) el token de agente funciona contra el backend. Pensado para correr a
# mano una vez despues de completar config.env.
set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$DIR/lib.sh"
load_agent_config || exit 1

echo "== 1) Probando la camara RTSP ($RTSP_URL) =="
if command -v ffprobe >/dev/null 2>&1; then
  TZ=UTC timeout 15 ffprobe -v error -rtsp_transport tcp \
    -select_streams v:0 -show_entries stream=width,height,codec_name,r_frame_rate \
    -of default=noprint_wrappers=1 "$RTSP_URL" \
  && echo "OK: la camara respondio." \
  || echo "FALLO: revisa RTSP_URL, usuario/clave, y que el dispositivo este en la misma red que la camara."
else
  echo "ffprobe no esta instalado (viene con el paquete ffmpeg)."
fi

echo
echo "== 2) Probando el token de agente contra el backend =="
resp="$(curl -sS -w '\n%{http_code}' -H "X-Agent-Key: $AGENT_KEY" \
  "$LIVEPLAY_API_BASE/agent/matches/pending?bufferMinutes=$BUFFER_MINUTES")"
code="$(echo "$resp" | tail -n1)"
body="$(echo "$resp" | sed '$d')"
if [ "$code" = "200" ]; then
  echo "OK (HTTP 200). Partidos pendientes ahora mismo:"
  echo "$body"
else
  echo "FALLO (HTTP $code). Respuesta:"
  echo "$body"
  echo "Revisa AGENT_KEY y LIVEPLAY_API_BASE en config.env - el token se genera en el panel de"
  echo "admin (POST /cameras/:id/agent-token) y solo se muestra una vez."
fi
