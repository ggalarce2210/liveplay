#!/usr/bin/env bash
# Funciones compartidas por record.sh e install.sh. uploader.py tiene su propio loader de
# config.env en Python (ver load_config() ahi) para no depender de bash desde Python.

# Carga config.env (o config.example.env como fallback, con un warning) desde el directorio
# de este script, y crea las carpetas de trabajo. Pensado para "source"-arse.
load_agent_config() {
  local dir
  dir="$(cd "$(dirname "${BASH_SOURCE[1]:-${BASH_SOURCE[0]}}")" && pwd)"

  if [ -f "$dir/config.env" ]; then
    set -a
    # shellcheck disable=SC1091
    source "$dir/config.env"
    set +a
  else
    echo "[WARN] No existe $dir/config.env - copia config.example.env a config.env y completa tus datos." >&2
    return 1
  fi

  export AGENT_DIR="$dir"
  mkdir -p "$RECORDINGS_DIR" "$TMP_DIR" "$LOG_DIR"
}

log() {
  local scope="$1"; shift
  echo "[$(date -u +'%Y-%m-%dT%H:%M:%SZ')] [$scope] $*"
}
