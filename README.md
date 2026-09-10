# LIVEPLAY

_"Jugá. Grabá. Reviví."_

Plataforma de video para complejos de Fútbol 5 y Pádel: buscá tu partido, reproducilo con
timeline avanzada (Timeslice), cámara lenta/acelerada, marcadores y clips.

Este es un proyecto **funcional de punta a punta** — frontend real, backend real, base de
datos real, y un pipeline de video real con FFmpeg generando HLS y thumbnails. No es un
mockup. Ver `docs/ARCHITECTURE.md` sección 11 para el detalle exacto de qué corre real y qué
quedó como interfaz lista para infraestructura que este entorno de desarrollo no tiene
disponible (cámaras físicas, un servidor MinIO, un SMTP real).

## Estructura

```
backend/        API NestJS + worker de procesamiento de video (Drizzle ORM + Postgres + Redis/BullMQ + FFmpeg)
frontend/       Next.js 14 (App Router) + Tailwind + hls.js
sample-media/   Videos sintéticos de prueba (generados con FFmpeg, timestamp quemado en pantalla)
storage-data/   "Bucket" local de desarrollo (se regenera corriendo el seed)
docker-compose.yml   Orquestación de referencia para producción (Postgres + Redis + MinIO + backend + worker + frontend)
docs/           ARCHITECTURE.md · DATABASE.md · API.md
```

## Cómo correrlo (desarrollo local, sin Docker)

Requisitos: Node.js 20+, PostgreSQL 16, Redis, FFmpeg instalados localmente.

### 1. Base de datos y Redis

```bash
# Crear la base y el usuario (una sola vez)
psql -c "CREATE ROLE ecp_user LOGIN PASSWORD 'ecp_pass';"
psql -c "CREATE DATABASE elcampito_play OWNER ecp_user;"

# Levantar Postgres y Redis si no están corriendo ya como servicio
pg_ctlcluster 16 main start   # o el equivalente de tu distro / `brew services start postgresql`
redis-server --daemonize yes
```

### 2. Backend

```bash
cd backend
cp .env.example .env    # o usar el .env ya incluido, ajustando secretos
npm install
npm run db:migrate      # aplica las migraciones SQL (Drizzle)
npm run seed            # crea "Deportivo San Martín", canchas, usuarios demo, y PROCESA los videos de sample-media/ con FFmpeg real
npm run start:dev        # API en http://localhost:3001/api
```

El `seed` corre el pipeline de FFmpeg de verdad (segmentación HLS + sprite de thumbnails) sobre
los videos de `sample-media/` — tarda unos segundos y deja todo listo para reproducir.

### 3. Frontend

```bash
cd frontend
npm install
npm run dev             # http://localhost:3000
```

### 4. Usuarios de prueba (contraseña para todos: `demo1234`)

| Email | Rol |
|---|---|
| `admin@liveplay.com` | SUPER_ADMIN |
| `complejo@liveplay.com` | COMPLEX_ADMIN |
| `juan@demo.com` | PLAYER (jugó ambos partidos de la demo) |
| `pedro@demo.com` | PLAYER (Fútbol 5) |
| `lucas@demo.com` | PLAYER (Pádel) |

## Cómo correrlo con Docker (referencia para producción/staging)

```bash
cp .env.example .env   # definir JWT_ACCESS_SECRET y VIDEO_URL_SIGNING_SECRET
docker compose up --build
docker compose exec backend npm run db:migrate
docker compose exec backend npm run seed
```

Con Docker, el `STORAGE_PROVIDER` pasa a `S3` apuntando al MinIO del compose — ver
`docker-compose.yml` y `docs/ARCHITECTURE.md` sección 5.

## Documentación

- **`docs/ARCHITECTURE.md`** — diseño completo, decisiones técnicas (incluida la razón por la
  que el proyecto usa Drizzle ORM en vez de Prisma), plan de cámaras IP/RTSP/NVR, plan de "ver
  en vivo", seguridad, y plan de escalamiento de 1 complejo a 100+.
- **`docs/DATABASE.md`** — diagrama entidad-relación y el porqué de cada tabla.
- **`docs/API.md`** — todos los endpoints REST.

## Funcionalidades implementadas

Auth completo (registro, login, JWT + refresh con rotación, recuperar/cambiar contraseña,
verificación de email — roles SUPER_ADMIN/COMPLEX_ADMIN/PLAYER) · Dashboard "Mis partidos" con
buscador avanzado (fecha/preset/rango, deporte, cancha, franja horaria) · Reproductor HLS
profesional (play/pause, volumen, pantalla completa, velocidades 0.5x–8x, replay ±5/10/30s,
atajos de teclado) · Timeline avanzada con hora real, zoom, thumbnails al arrastrar el cursor,
eventos del partido y marcadores clickeables · Marcadores/Timeslice privados por jugador ·
Clips ("mis mejores momentos") generados con FFmpeg sin tocar el video original · Compartir
enlaces privados con vencimiento · Fútbol 5 (equipos, goles, tarjetas) y Pádel (parejas, sets,
resultado) modelados explícitamente · Panel de administración (stats, estado de cámaras,
almacenamiento usado/disponible, videos más pesados) · Auditoría de acciones sensibles ·
Notificaciones in-app · Landing page pública · Diseño responsive (desktop/tablet/mobile con
sidebar colapsable).
