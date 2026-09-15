#!/data/data/com.termux/files/usr/bin/bash
# Setup de una sola vez dentro de Termux (Android/TV box). Ver ../backend/AGENTE.md para el
# paso a paso completo (instalar Termux desde F-Droid/GitHub, no la Play Store).
set -uo pipefail

echo "== Instalando paquetes (ffmpeg, python, curl) =="
pkg update -y
pkg install -y ffmpeg python curl

echo
echo "== Pidiendo acceso al almacenamiento (para poder ver los archivos desde afuera si hace falta) =="
termux-setup-storage || echo "(si no aparecio el dialogo, correlo a mano: termux-setup-storage)"

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ ! -f "$DIR/config.env" ]; then
  cp "$DIR/config.example.env" "$DIR/config.env"
  echo
  echo "Se creo $DIR/config.env a partir del ejemplo - TENES que editarlo antes de arrancar:"
  echo "  nano $DIR/config.env"
  echo "(completa AGENT_KEY, RTSP_URL, y LIVEPLAY_API_BASE si no es el de produccion)"
fi

echo
echo "== Dejando los scripts como ejecutables =="
chmod +x "$DIR"/*.sh "$DIR"/uploader.py

echo
echo "== Configurando el arranque automatico (Termux:Boot) =="
mkdir -p "$HOME/.termux/boot"
cp "$DIR/termux-boot-start.sh" "$HOME/.termux/boot/start-liveplay-agent.sh"
chmod +x "$HOME/.termux/boot/start-liveplay-agent.sh"

cat <<'EOF'

Listo. Pasos que TE FALTAN hacer a mano (no se pueden automatizar desde aca):

1. Instalar la app "Termux:Boot" (mismo origen que Termux: F-Droid o GitHub, NO Play Store).
2. En los ajustes de bateria de Android, sacarle a Termux cualquier optimizacion/restriccion
   ("sin restricciones" / "permitir en segundo plano").
3. Editar config.env con el token real de la camara y la URL RTSP:
     nano local-agent/config.env
4. Probar que todo funcione ANTES de dejarlo desatendido:
     ./check.sh
5. Recien ahi, reiniciar el TV box una vez para confirmar que Termux:Boot levanta todo solo,
   o arrancarlo a mano ahora mismo con:
     ./termux-boot-start.sh
EOF
