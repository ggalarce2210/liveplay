#!/usr/bin/env bash
# Autoconfiguración del agente vía "código de enrolamiento" (ver backend/AGENTE.md y el resumen
# del proyecto, sección 2026-09-30). Reemplaza el paso más engorroso de instalar el agente: tipear
# config.env a mano en el TV box con un control remoto/teclado táctil (fuente de varios bugs
# reales encontrados el 2026-09-18/19: autocorrector corrompiendo el texto, RTSP_URL sin comillas
# rompiéndose por el "&", etc.).
#
# Uso: pedile al admin del panel (/admin/canchas → tu cámara → "🔑 Generar código de
# instalación") un código de 8 caracteres, y corré:
#   ./enroll.sh
# El script pide el código (y, si hace falta, la URL del backend) y arma config.env solo.
set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_API_BASE="https://liveplay-fuh6.onrender.com/api"

if [ -f "$DIR/config.env" ]; then
  echo "Ya existe $DIR/config.env."
  read -r -p "¿Sobreescribirlo con un nuevo código de enrolamiento? [y/N] " confirm
  case "$confirm" in
    y|Y|yes|YES) ;;
    *) echo "Cancelado. config.env no se tocó."; exit 0 ;;
  esac
fi

read -r -p "URL del backend de LivePlay [$DEFAULT_API_BASE]: " api_base
api_base="${api_base:-$DEFAULT_API_BASE}"

read -r -p "Código de instalación (lo genera el admin en /admin/canchas): " code
code="$(echo -n "$code" | tr -d '[:space:]')"
if [ -z "$code" ]; then
  echo "[ERROR] No ingresaste ningún código." >&2
  exit 1
fi

echo
echo "Canjeando el código contra $api_base ..."
response="$(curl -sS -w '\n%{http_code}' -X POST \
  -H 'Content-Type: application/json' \
  -d "{\"code\":\"$code\"}" \
  "$api_base/agent/enroll")"
http_code="$(echo "$response" | tail -n1)"
body="$(echo "$response" | sed '$d')"

if [ "$http_code" != "200" ] && [ "$http_code" != "201" ]; then
  echo "[ERROR] El backend respondió $http_code:" >&2
  echo "$body" >&2
  echo
  echo "Motivos típicos: el código venció (dura 10 min), ya se usó, o está mal tipeado." >&2
  echo "Pedile al admin que genere uno nuevo desde el panel y volvé a correr ./enroll.sh." >&2
  exit 1
fi

# Se delega el parseo de JSON a python3 (ya es una dependencia del agente, ver uploader.py) en
# vez de sumar jq como dependencia nueva de Termux. Si falta algún campo, se corta acá con un
# mensaje claro en vez de generar un config.env a medias.
#
# IMPORTANTE: cada valor se emite con shlex.quote() antes de escribirlo para que este mismo
# script lo pueda "source"-ar sin romperse — sin este quoting, una RTSP_URL de Dahua (que
# siempre lleva un "&" en la query string) reproduce EXACTAMENTE el bug real que este script
# existe para eliminar: bash interpreta el "&" como "correr en segundo plano" y la variable
# queda vacía en silencio (encontrado probando este mismo script contra una URL con "&").
if ! python3 - "$body" > "$DIR/.enroll_fields.tmp" <<'PYEOF'
import json, shlex, sys
data = json.loads(sys.argv[1])
required = ["backendUrl", "agentToken", "rtspUrl", "segmentMinutes", "retentionHours"]
missing = [k for k in required if not data.get(k) and data.get(k) != 0]
if missing:
    print(f"[ERROR] Faltan campos en la respuesta del backend: {missing}", file=sys.stderr)
    sys.exit(1)
for key in required:
    print(f"{key}={shlex.quote(str(data[key]))}")
PYEOF
then
  echo "[ERROR] No se pudo interpretar la respuesta del backend:" >&2
  echo "$body" >&2
  rm -f "$DIR/.enroll_fields.tmp"
  exit 1
fi

# shellcheck disable=SC1090
source "$DIR/.enroll_fields.tmp"
rm -f "$DIR/.enroll_fields.tmp"

segment_seconds=$((segmentMinutes * 60))

cat > "$DIR/config.env" <<EOF
# ──────────────────────────────────────────────────────────────
# Configuración del agente local de LivePlay
# Generado automáticamente por enroll.sh el $(date -u +'%Y-%m-%dT%H:%M:%SZ') —
# canjeando un código de instalación de un solo uso, sin editar nada a mano.
# ──────────────────────────────────────────────────────────────

LIVEPLAY_API_BASE=${backendUrl}

# Token de esta cámara, entregado por /agent/enroll junto con el resto del bundle.
AGENT_KEY=${agentToken}

# URL RTSP de la cámara, tal como está cargada en /admin/canchas — entre comillas siempre
# (evita el bug real del "&" en la query string de Dahua, ver config.example.env).
RTSP_URL="${rtspUrl}"

SEGMENT_SECONDS=${segment_seconds}
RETENTION_HOURS=${retentionHours}
POLL_SECONDS=120
BUFFER_MINUTES=15

RECORDINGS_DIR=\$HOME/liveplay-agent/recordings
TMP_DIR=\$HOME/liveplay-agent/tmp
LOG_DIR=\$HOME/liveplay-agent/logs
EOF

chmod 600 "$DIR/config.env"

echo
echo "Listo — $DIR/config.env generado solo, sin tipear nada a mano."
echo "Siguiente paso: ./check.sh (para confirmar que la cámara y el backend responden)."
