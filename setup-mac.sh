#!/usr/bin/env bash
# LivePlay — instalación y arranque local en macOS (con Homebrew).
# Uso: abrí Terminal, andá a la carpeta donde descomprimiste el proyecto y corré:
#   chmod +x setup-mac.sh && ./setup-mac.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "=========================================="
echo " LivePlay — instalación local (macOS)"
echo "=========================================="
echo ""

# ---------- 1. Homebrew ----------
if ! command -v brew >/dev/null 2>&1; then
  echo "❌ No encontré Homebrew instalado."
  echo "   Instalalo desde https://brew.sh (una línea en Terminal) y volvé a correr este script."
  exit 1
fi
echo "✅ Homebrew encontrado."

# ---------- 2. Node ----------
if ! command -v node >/dev/null 2>&1; then
  echo "📦 Instalando Node.js..."
  brew install node
else
  echo "✅ Node encontrado ($(node -v))."
fi

# ---------- 3. PostgreSQL 16 ----------
if ! brew list postgresql@16 >/dev/null 2>&1; then
  echo "📦 Instalando PostgreSQL 16..."
  brew install postgresql@16
else
  echo "✅ PostgreSQL 16 ya está instalado."
fi
PG_BIN="$(brew --prefix postgresql@16)/bin"
export PATH="$PG_BIN:$PATH"

echo "▶️  Arrancando PostgreSQL..."
brew services start postgresql@16 >/dev/null
sleep 3

# ---------- 4. Redis ----------
if ! brew list redis >/dev/null 2>&1; then
  echo "📦 Instalando Redis..."
  brew install redis
else
  echo "✅ Redis ya está instalado."
fi
echo "▶️  Arrancando Redis..."
brew services start redis >/dev/null
sleep 1

# ---------- 5. FFmpeg ----------
if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "📦 Instalando FFmpeg..."
  brew install ffmpeg
else
  echo "✅ FFmpeg encontrado."
fi

# ---------- 6. Base de datos ----------
echo "🗄️  Configurando la base de datos..."
DB_USER_EXISTS=$("$PG_BIN/psql" postgres -tAc "SELECT 1 FROM pg_roles WHERE rolname='ecp_user'" 2>/dev/null || echo "")
if [ "$DB_USER_EXISTS" != "1" ]; then
  "$PG_BIN/psql" postgres -c "CREATE ROLE ecp_user LOGIN PASSWORD 'ecp_pass';"
fi
DB_EXISTS=$("$PG_BIN/psql" postgres -tAc "SELECT 1 FROM pg_database WHERE datname='elcampito_play'" 2>/dev/null || echo "")
if [ "$DB_EXISTS" != "1" ]; then
  "$PG_BIN/psql" postgres -c "CREATE DATABASE elcampito_play OWNER ecp_user;"
fi
echo "✅ Base de datos lista."

# ---------- 7. Backend ----------
echo ""
echo "📦 Instalando dependencias del backend (puede tardar un par de minutos)..."
cd "$SCRIPT_DIR/backend"
[ -f .env ] || cp .env.example .env
npm install --silent

echo "🔧 Aplicando migraciones..."
npm run db:migrate

echo "🌱 Sembrando datos de demo (esto procesa los videos con FFmpeg, tarda unos segundos)..."
npm run seed

echo "▶️  Arrancando el backend en background..."
nohup npm run start:dev > /tmp/liveplay-backend.log 2>&1 &
echo $! > /tmp/liveplay-backend.pid
sleep 6

# ---------- 8. Frontend ----------
echo ""
echo "📦 Instalando dependencias del frontend (puede tardar un par de minutos)..."
cd "$SCRIPT_DIR/frontend"
npm install --silent

echo "▶️  Arrancando el frontend en background..."
nohup npm run dev > /tmp/liveplay-frontend.log 2>&1 &
echo $! > /tmp/liveplay-frontend.pid
sleep 5

echo ""
echo "=========================================="
echo " ✅ LivePlay está corriendo"
echo "=========================================="
echo ""
echo "Abrí esto en tu navegador:  http://localhost:3000"
echo ""
echo "Usuarios de prueba (contraseña demo1234 para todos):"
echo "  admin@liveplay.com      (SUPER_ADMIN)"
echo "  complejo@liveplay.com   (COMPLEX_ADMIN)"
echo "  juan@demo.com           (PLAYER, jugó ambos partidos)"
echo ""
echo "Logs en vivo: tail -f /tmp/liveplay-backend.log /tmp/liveplay-frontend.log"
echo "Para frenarlo: kill \$(cat /tmp/liveplay-backend.pid) \$(cat /tmp/liveplay-frontend.pid)"
echo ""
