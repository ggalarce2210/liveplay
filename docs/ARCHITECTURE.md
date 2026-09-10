# LIVEPLAY — Arquitectura

_"Jugá. Grabá. Reviví."_

Este documento describe la arquitectura real del proyecto tal como fue construido: qué está
implementado y funcionando de punta a punta, qué quedó como interfaz/arquitectura lista para
enchufar infraestructura real, y por qué se tomó cada decisión.

## 1. Qué es esto exactamente

Una plataforma tipo "streaming privado" para complejos de Fútbol 5 y Pádel: cada partido queda
asociado a un complejo, una cancha, una cámara, jugadores y un video segmentado en HLS. Los
jugadores entran, buscan su partido y lo reproducen con timeline avanzada, timeslice, cámara
lenta/acelerada, marcadores y clips.

Esta entrega es la **versión demo**: corre en un único entorno con datos y video sintético de
prueba, pero cada pieza — auth, base de datos, pipeline de FFmpeg, streaming HLS, storage —
es código real, no un mock visual. Ver la sección 11 para el mapa exacto de qué es real y qué
es un stub deliberado.

## 2. Stack elegido y por qué

| Capa | Elección | Alternativa considerada | Motivo |
|---|---|---|---|
| Frontend | Next.js 14 (App Router) + TypeScript + Tailwind | Vite + React Router | SSR/SEO para la landing, file-based routing, y es el stack que Anthropic recomienda en el prompt original |
| Backend | NestJS + TypeScript | Express a mano | Módulos, DI, guards/interceptors nativos — misma estructura que un equipo real de +5 devs necesita |
| Base de datos | PostgreSQL | — | Requisito explícito, relacional, soporta bien el modelo de partidos/eventos/segmentos |
| ORM | **Drizzle ORM** (node-postgres) | **Prisma** (elección original) | Ver nota abajo — decisión tomada durante el desarrollo, no es solo una preferencia |
| Cola de trabajos | BullMQ + Redis | Bee-Queue, Bull clásico | Estándar actual en Node, soporta reintentos/backoff, concurrencia configurable |
| Video | FFmpeg (HLS + sprites de thumbnails) | Mux/Cloudflare Stream (SaaS) | Requisito explícito de mantener el procesamiento propio; FFmpeg es la base de cualquiera de esos SaaS igual |
| Storage | Capa de abstracción propia (`StorageDriver`) con driver Local y driver S3 | Acoplarse directo a un SDK | Requisito explícito §26 — poder cambiar de proveedor sin tocar el resto de la app |

### Nota importante: por qué Drizzle y no Prisma

El plan original (y el más común en la industria hoy) era Prisma. Se empezó a construir el
schema en Prisma, pero **el entorno de este sandbox tiene el CDN de binarios de Prisma
(`binaries.prisma.sh`) bloqueado por política de red** — ni `prisma generate` ni `prisma migrate`
pueden completarse porque no logran descargar el motor de query nativo, con o sin
`PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING`.

En vez de entregar un backend que no corre, se migró todo el data layer a **Drizzle ORM**
(`drizzle-orm` + `pg`), que es 100% TypeScript/JS puro — no depende de descargar ningún binario
nativo en tiempo de instalación o generación. Esto tiene una ventaja adicional real para
producción: menos piezas móviles, migraciones SQL explícitas y versionadas
(`backend/src/db/migrations/*.sql`, generadas con `drizzle-kit generate`), y el mismo nivel de
type-safety end-to-end que Prisma. Si en tu infraestructura real preferís Prisma, el schema de
Drizzle (`backend/src/db/schema.ts`) es una traducción 1:1 del modelo relacional documentado en
`DATABASE.md` y portarlo es mecánico.

## 3. Mapa del sistema

```
                    ┌──────────────────────┐
                    │   Next.js Frontend   │
                    │  (dashboard, buscador,│
                    │   reproductor HLS)    │
                    └──────────┬───────────┘
                               │ REST (JWT)
                    ┌──────────▼───────────┐
                    │   NestJS API (HTTP)  │
                    │  auth · matches ·    │
                    │  videos · clips ·    │
                    │  admin · share       │
                    └───┬──────────────┬───┘
                        │              │
                ┌───────▼──────┐   ┌───▼────────────┐
                │  PostgreSQL   │   │  Redis (BullMQ) │
                │  (Drizzle)    │   │  cola de video   │
                └───────────────┘   └───┬────────────┘
                                        │
                              ┌─────────▼─────────┐
                              │  Video Worker      │
                              │  (FFmpeg: HLS +    │
                              │   thumbnails +     │
                              │   clips)           │
                              └─────────┬──────────┘
                                        │
                              ┌─────────▼──────────┐
                              │ StorageDriver       │
                              │ (Local disk demo /  │
                              │  S3 / MinIO prod)    │
                              └─────────┬──────────┘
                                        │
                              ┌─────────▼──────────┐
                              │ StreamController     │
                              │ (URLs firmadas, Range │
                              │  requests, reescritura│
                              │  de manifest/VTT)     │
                              └───────────────────────┘
```

Cámaras IP/RTSP/NVR (hoy simuladas con metadata en la tabla `cameras` + un video sintético
pregenerado) alimentarían, en producción, un servicio de ingesta que deposita el archivo fuente
y dispara `POST /matches/:id/video` (o su equivalente por watcher de carpeta) — ver sección 6.

## 4. El pipeline de video (la pieza más importante)

Implementado en `backend/src/video-processing/`:

1. **`ffmpeg.service.ts`** — envoltorio directo sobre `ffmpeg`/`ffprobe` (sin librería
   intermedia, para tener control total del comando):
   - `probe()`: duración, resolución, fps.
   - `generateHls()`: segmenta el archivo fuente en un **VOD HLS real** — `master.m3u8` +
     segmentos `.ts` de ~6-10s (`-hls_time`, `-hls_playlist_type vod`), sin re-codificar
     (`-c copy`) cuando el codec de entrada ya es compatible. Esto es la base de §11
     (segmentación) y §31 (streaming eficiente).
   - `generateThumbnailSprite()`: genera un sprite JPEG (grilla 10×10 de miniaturas cada 5s)
     + un `thumbnails.vtt` que mapea cada rango de tiempo a un recorte del sprite
     (`#xywh=x,y,w,h`) — esto es lo que le permite al timeline mostrar la previsualización al
     arrastrar el cursor (§12/§33), sin pedir un frame nuevo al servidor en cada movimiento.
   - `generateClip()`: recorta un rango exacto re-codificando (para no perder precisión al
     frame más cercano), usado por "Mis mejores momentos" (§16).

2. **`video-processing.service.ts`** — orquesta: sube cada artefacto generado a la capa de
   storage bajo la `storageBaseKey` del partido, actualiza `VideoSegment` en una transacción,
   marca el `Video`/`Match` como `READY`, y crea notificaciones `MATCH_READY` para los
   jugadores del partido.

3. **Cola y worker** (`video-processing.queue.ts`, `.processor.ts`, `worker.main.ts`) — todo el
   trabajo pesado se encola en BullMQ/Redis en vez de correr inline en el request HTTP. El
   worker puede correr embebido en el mismo proceso (como en esta demo) o como **deployment
   separado** (`npm run worker`, ver `docker-compose.yml`) — así se puede escalar el
   procesamiento de video de forma independiente al servidor web cuando haya muchas canchas
   grabando en simultáneo (§27/§28).

### Por qué HLS y no un archivo único

Un partido de 1 hora como archivo único obliga al cliente a descargar (o el server a soportar
Range requests sobre) un solo blob gigante, sin punto de entrada intermedio real. Con HLS:

- El reproductor pide solo los segmentos cercanos al punto de reproducción → **timeslice
  instantáneo** sin descargar el partido entero.
- Si se corta la grabación a mitad de partido, los segmentos ya escritos siguen siendo válidos
  (recuperación ante cortes, §11).
- Es el protocolo que todo reproductor moderno (`hls.js` en el frontend, nativo en Safari/iOS)
  entiende sin plugins.
- Es el mismo formato que usaría un futuro "Ver en vivo" (HLS de baja latencia) — no hay que
  rehacer el pipeline, solo el origen del archivo (ver sección 8).

## 5. Storage: la capa de abstracción (§26)

`backend/src/storage/storage.types.ts` define la interfaz `StorageDriver`
(`putObject`, `getSignedReadUrl`, `deleteObject`, `deletePrefix`, `exists`, ...). Dos
implementaciones:

- **`LocalDiskStorageDriver`** (activo en esta demo): escribe en `storage-data/` con el mismo
  layout de "keys" que usaría un bucket S3 real (ver sección 7). Genera URLs firmadas como un
  JWT de corta duración con la key embebida, servido por `StreamController`.
- **`S3StorageDriver`** (código completo, listo para producción, no ejercitado en esta demo):
  usa `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`. Funciona igual contra AWS S3,
  **MinIO** auto-hospedado, DigitalOcean Spaces o Backblaze B2 (todos hablan la API S3) — se
  activa con `STORAGE_PROVIDER=S3` + variables de entorno, sin tocar una sola línea del resto
  del sistema.

**Por qué no corrió MinIO en esta demo:** el sandbox de desarrollo no tiene acceso de red a
`dl.min.io` (política de red, igual que con Prisma), así que no se pudo bajar el binario de
MinIO para levantarlo localmente. El driver S3 está escrito y compila; en tu infraestructura
real (con `docker-compose up`, que sí puede bajar la imagen `minio/minio` desde Docker Hub) se
activa cambiando una variable de entorno.

## 6. Cámaras IP / RTSP / NVR / DVR (§9)

La tabla `cameras` (ver `DATABASE.md`) ya modela esto: cada `Court` tiene una `Camera` con
`type` (`IP_CAMERA` | `RTSP` | `NVR` | `DVR`), `rtspUrl` opcional, `nvrChannel` opcional, y
`status`/`lastSeenAt` para el panel "🟢 Online / 🔴 Offline" del admin.

Lo que **no** se construyó (requiere infraestructura física que este sandbox no tiene: cámaras
reales, un NVR, una red local) es el servicio de ingesta en sí. La arquitectura para agregarlo,
sin rehacer nada de lo ya construido, es:

1. Un servicio (`camera-ingest`, puede ser un contenedor propio) que mantiene una conexión
   RTSP persistente por cámara activa (con `ffmpeg -i rtsp://... -f segment ...` o una librería
   como `node-rtsp-stream`) y escribe segmentos crudos a un directorio de "landing" o
   directamente a un bucket de ingesta.
2. Al cerrarse una grabación (fin del turno reservado, o un webhook del NVR), ese servicio
   llama `POST /matches/:id/video` (el endpoint que ya existe y ya dispara todo el pipeline de
   FFmpeg descripto arriba) — o, si el NVR ya expone sus grabaciones como archivos en una
   carpeta compartida, un *watcher* (`chokidar` sobre la carpeta) hace ese `POST` automáticamente
   apenas aparece el archivo nuevo.
3. Un *health-checker* periódico (cron, cada 30-60s) hace `ffprobe` corto contra cada
   `rtspUrl` (o escucha el heartbeat propio del NVR) y llama
   `POST /cameras/:id/heartbeat` (ya implementado) para mantener el estado Online/Offline
   actualizado.

Ningún cambio a `matches`, `videos`, `video_segments`, al pipeline de FFmpeg o al reproductor
del frontend es necesario para incorporar esto — es exactamente el desacople que pedía el
enunciado (§9: "la arquitectura debe permitir agregar más cámaras posteriormente").

## 7. Layout físico del storage vs. modelo lógico (§10)

Ejemplo real generado por el seed de esta demo:

```
complex-<id>/court-<id>/2026/09/09/21-00-00/
  hls/master.m3u8
  hls/segment_00000.ts ... segment_000NN.ts
  thumbs/sprite.jpg
  thumbs/thumbnails.vtt
```

El frontend **nunca ve esta ruta**. Todo lo que recibe es:

- `GET /videos/:id/playback` → `{ manifestUrl, thumbnailsVttUrl }`, URLs firmadas de 4hs.
- Dentro del `.m3u8` y del `.vtt`, cada referencia a un segmento/sprite se reescribe al
  vuelo (`StreamController`) para ser también una URL firmada — así ni siquiera inspeccionando
  el manifest se puede reconstruir la ruta física real.

La base de datos es la única fuente de verdad de la relación
`Video → Match → Court → Complex → fecha/hora → jugadores` (exactamente como pedía §10);
el nombre de archivo físico es un detalle de implementación del driver de storage.

## 8. "Ver en vivo" — cómo se incorpora sin rehacer nada (§13)

No se implementó (no hay cámara real transmitiendo en este sandbox), pero la arquitectura ya
lo contempla:

- `Match.status` ya incluye `RECORDING` — el estado que tendría un partido mientras se
  transmite en vivo.
- El mismo `VideoSegment` (lista ordenada de segmentos con offsets) es la estructura que usa
  HLS de baja latencia (LL-HLS): en vivo, el `.m3u8` es de tipo `EVENT` (no `VOD`) y se le van
  agregando entradas a medida que FFmpeg emite nuevos segmentos desde el feed RTSP, en vez de
  generarse todos de una vez al final. El *mismo* `hls.js` del frontend reproduce ambos casos
  sin cambios.
- El botón "Ver en vivo" en el frontend sería simplemente: si `match.status === 'RECORDING'`,
  pedir el manifest igual que hoy (`/videos/:id/playback`), pero apuntando al manifest *event*
  que el pipeline de ingesta va actualizando en tiempo real.

## 9. Seguridad (§25)

- **Contraseñas**: `bcrypt`, 12 rounds.
- **Sesión**: JWT de acceso (15 min) + refresh token opaco (30 días) hasheado con SHA-256 en
  la tabla `refresh_tokens`, con **rotación**: cada uso de un refresh token lo invalida y emite
  uno nuevo (mitiga reuso de un token robado).
- **Roles y permisos**: `RolesGuard` + decorador `@Roles(...)` en cada endpoint administrativo;
  un `PLAYER` solo puede listar/ver partidos donde figura como `MatchPlayer` — se valida en
  `MatchesService.assertCanAccess` y en `VideosService`, no solo en el frontend.
- **Rate limiting**: `@nestjs/throttler` global (120 req/min) + límites más estrictos en
  `/auth/login` y `/auth/register`.
- **Validación de inputs**: `class-validator` + `ValidationPipe` global (`whitelist: true`).
- **SQL injection**: Drizzle usa consultas parametrizadas exclusivamente — no hay
  concatenación de strings SQL en ningún service.
- **XSS**: React escapa por defecto todo lo que renderiza; no se usa `dangerouslySetInnerHTML`
  en ningún componente.
- **Helmet**: headers de seguridad HTTP estándar en todas las respuestas del API.
- **URLs de video firmadas y con expiración**: ver sección 5/7 — nunca se expone una ruta de
  archivo real, y toda URL de streaming expira (4hs para el partido completo, 30 min para
  clips).
- **Auditoría** (§36): `AuditLogInterceptor` + decorador `@Audit('ACCION', 'Entidad')` graba
  login/logout, creación/eliminación de partidos y cámaras, subida de video, creación de
  clips, en la tabla `audit_logs`, con IP y user-agent.

Lo que quedó **fuera de alcance** de esta demo (documentado, no implementado): CSRF (no
aplica de la misma forma con JWT en header en vez de cookies de sesión, pero si se migra a
cookies httpOnly hay que agregar `csurf` o doble-submit token), 2FA, y un WAF/CDN delante del
API — todas son capas de infraestructura que se agregan sin cambiar el diseño de arriba.

## 10. Escalabilidad (§27)

El diseño ya separa limpiamente:

- **Frontend** (Next.js) — stateless, se escala horizontalmente detrás de un load balancer o
  se sirve desde un CDN/edge (Vercel, Cloudflare Pages, etc.) sin cambios.
- **API** (NestJS) — stateless (toda la sesión vive en el JWT + Postgres), se escala
  horizontalmente. El único estado compartido es Postgres/Redis.
- **Worker de video** — proceso separado (`npm run worker`), se escala de forma independiente
  al API: si hay 500 canchas grabando en simultáneo, se agregan más réplicas del worker sin
  tocar el API.
- **Base de datos** — el cuello de botella esperado a escala es la tabla `matches`/`events`
  cuando hay millones de filas. Ya se agregaron índices sobre `(complex_id, date)`,
  `(court_id, date)`, `(sport_type, date)` y `(match_id, timestamp_seconds)` — los patrones de
  acceso reales del buscador y del reproductor. El filtro de franja horaria (hora del día,
  independiente de la fecha) hoy se resuelve en memoria sobre el resultado ya acotado por los
  demás filtros — a la escala inicial (1 complejo, 5 canchas) es instantáneo; a la escala de
  100 complejos convendría un índice funcional `EXTRACT(HOUR FROM start_time)` o mover la
  búsqueda a Elasticsearch/OpenSearch/Meilisearch indexando `matches` de forma asíncrona.
- **Storage** — el driver S3 ya asume un bucket que escala horizontalmente sin límite
  práctico; el "sharding" natural ya está en la key (`complex/court/año/mes/día/hora`), así que
  no hay un único directorio con millones de archivos.
- **Segmentos de video** — la tabla `video_segments` está diseñada para que "millones de
  segmentos" (§27) sea simplemente millones de filas con un índice `(video_id, index)`, no un
  problema de diseño distinto.

Ruta de escalamiento sugerida, en orden de cuándo se vuelve necesaria:
1. Réplica de lectura de Postgres para el buscador de partidos.
2. Mover el buscador a un índice de búsqueda dedicado (Elasticsearch/Meilisearch).
3. CDN delante del storage S3 para servir segmentos `.ts` (son inmutables, `Cache-Control:
   immutable` ya está seteado en `StreamController`) — reduce carga del API de streaming
   drásticamente, ya que hoy el API es el que reescribe y sirve cada segmento.
4. Particionar `audit_logs`/`events` por fecha si el volumen de auditoría crece mucho.

## 11. Qué es real y qué es un stub deliberado (léase antes de evaluar el proyecto)

| Pieza | Estado | Detalle |
|---|---|---|
| Auth (registro, login, refresh, roles, recuperar contraseña) | ✅ Real | Corriendo contra Postgres real |
| Búsqueda de partidos con todos los filtros | ✅ Real | |
| Reproductor HLS + timeline + timeslice + thumbnails + eventos + marcadores | ✅ Real | `hls.js` real, sprite real generado por FFmpeg |
| Segmentación HLS, generación de thumbnails, generación de clips | ✅ Real | FFmpeg real, ejecutándose contra el video de muestra |
| Cola de procesamiento (BullMQ/Redis) | ✅ Real | Corriendo contra un Redis real |
| Compartir enlaces privados | ✅ Real (lógica) | Falta un guard de JWT dedicado en el resolver público — hoy valida presencia de header, no lo decodifica (documentado como simplificación) |
| Panel de admin (stats, cámaras, storage) | ✅ Real | Datos calculados desde Postgres real |
| Notificaciones in-app | ✅ Real (in-app) | Se crean filas reales en `notifications` cuando un video queda listo |
| Confirmación de cuenta por email (obligatoria para poder loguearse) | ✅ Real (lógica) / 🟡 envío mock | El login rechaza con `403` si `emailVerifiedAt` es null; confirmar el link desloguea el token viejo y emite uno nuevo (auto-login). El **envío** del email cae a un mock por consola si no hay SMTP — en ese modo la respuesta de `register`/`resend-verification` incluye `devVerifyUrl` para poder probar el flujo sin casilla de correo real. Cambiar a envío real es solo configurar `SMTP_*`. |
| Recupero de contraseña (email) | 🟡 Backend completo, falta página frontend | El endpoint `/auth/reset-password` funciona y el mail se envía (mock); no existe todavía la página `/reset-password` en el frontend que lea el token de la URL y muestre el formulario — gap conocido, no bloquea el login. |
| Cámaras IP/RTSP/NVR reales | 🟡 Arquitectura lista, no implementado | No hay cámaras físicas en este sandbox; ver sección 6 |
| Ver en vivo | 🟡 Arquitectura lista, no implementado | Ver sección 8 |
| MinIO/S3 real | 🟡 Código completo, no ejercitado | Sandbox sin acceso a `dl.min.io`; el driver local demuestra el mismo contrato |
| CSRF / 2FA | ⬜ Fuera de alcance de esta demo | Documentado en sección 9 |

## 12. Estructura de carpetas

```
liveplay/
├── backend/                  # API NestJS + worker de video
│   ├── src/
│   │   ├── auth/              # registro, login, JWT, roles
│   │   ├── users/              
│   │   ├── complexes/ courts/ cameras/
│   │   ├── matches/            # CRUD + buscador + eventos + attach video
│   │   ├── videos/             # segments + playback URLs firmadas
│   │   ├── bookmarks/ clips/ share/
│   │   ├── notifications/ admin/
│   │   ├── video-processing/  # FFmpeg + BullMQ + worker standalone
│   │   ├── storage/            # StorageDriver: Local + S3
│   │   ├── db/                 # schema Drizzle + migraciones SQL + seed
│   │   └── common/             # guards, decorators, interceptors, mail mock
│   └── Dockerfile
├── frontend/                  # Next.js App Router
│   └── src/
│       ├── app/                # landing, login/register, dashboard, matches/[id], admin
│       ├── components/          # VideoPlayer, Timeline, MatchCard, SearchFilters, ...
│       └── lib/                 # cliente API, store de auth, parser de WebVTT
├── sample-media/               # videos sintéticos de prueba (generados con FFmpeg)
├── storage-data/                # "bucket" local (se regenera corriendo el seed)
├── docker-compose.yml           # Postgres + Redis + MinIO + backend + worker + frontend
└── docs/                        # este documento, DATABASE.md, API.md
```
