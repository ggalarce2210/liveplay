#!/data/data/com.termux/files/usr/bin/bash
# Este archivo se copia a ~/.termux/boot/start-liveplay-agent.sh (lo hace install-termux.sh).
# Termux:Boot lo ejecuta solo cada vez que el dispositivo arranca - sin esto, el agente no
# sobreviviria un reinicio/corte de luz del TV box.
#
# Para correr en Linux "de verdad" (Raspberry Pi, mini PC) no se usa este archivo: se usan
# los .service de ../systemd en cambio.

DIR="$HOME/liveplay-repo/local-agent"   # ajusta esta ruta si clonaste el repo en otro lado
LOG_DIR="$HOME/liveplay-agent/logs"
mkdir -p "$LOG_DIR"

# Evita que Android duerma la CPU mientras el agente corre en segundo plano (requiere el
# paquete termux-api instalado y la app "Termux:API").
command -v termux-wake-lock >/dev/null 2>&1 && termux-wake-lock

nohup "$DIR/record.sh" >> "$LOG_DIR/record-boot.log" 2>&1 &
nohup "$DIR/uploader.py" >> "$LOG_DIR/uploader-boot.log" 2>&1 &

echo "$(date -u +'%Y-%m-%dT%H:%M:%SZ') agente de LivePlay arrancado (record.sh + uploader.py)" >> "$LOG_DIR/boot.log"
