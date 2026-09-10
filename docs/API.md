# LIVEPLAY — API

Base URL: `http://localhost:3001/api` (todas las rutas están bajo el prefijo `/api`).
Autenticación: `Authorization: Bearer <accessToken>` salvo que se indique lo contrario.
Los códigos de rol entre paréntesis indican quién puede llamar el endpoint; sin anotación =
cualquier usuario autenticado (o público, para `/auth/*` y la landing).

## Auth

**El login exige email confirmado.** `register` YA NO devuelve tokens — crea la cuenta con
`emailVerifiedAt = null` y envía el email de verificación; `login` responde `403 Forbidden` si
esa cuenta todavía no confirmó el email. Confirmar el email (`verify-email/:token`) sí devuelve
tokens y deja logueado en el mismo paso (un solo click desde el mail). En este entorno de
desarrollo no hay SMTP real configurado, así que `MailService` cae a un transporte mock: en ese
modo, `register`, `resend-verification` y `login` (cuando bloquea por email no verificado, vía el
botón de reenvío del frontend) devuelven además un campo `devVerifyUrl` con el link de
confirmación ya armado, para poder probar el flujo completo sin una casilla de correo real. Ese
campo se omite automáticamente en cuanto se configuran las variables `SMTP_*`.

| Método | Ruta | Descripción |
|---|---|---|
| POST | `/auth/register` | Alta de jugador. Responde `{ user, requiresEmailVerification: true, devVerifyUrl? }` — sin tokens. |
| POST | `/auth/login` | Devuelve `{ user, accessToken, refreshToken }`. `403` si el email no está confirmado. |
| POST | `/auth/resend-verification` | `{ email }` → reenvía el link de confirmación (no revela si el email existe). |
| POST | `/auth/refresh` | Rota el refresh token, devuelve un par nuevo. |
| POST | `/auth/logout` | Revoca el refresh token enviado. |
| POST | `/auth/forgot-password` | Genera token de recupero (no revela si el email existe). |
| POST | `/auth/reset-password` | Cambia la contraseña con el token del email. |
| POST | `/auth/change-password` | Cambia la contraseña estando logueado. |
| GET | `/auth/verify-email/:token` | Confirma el email y devuelve `{ success, user, accessToken, refreshToken }` (auto-login). |
| GET | `/auth/me` | Perfil del usuario autenticado. |

## Usuarios

| Método | Ruta | Descripción |
|---|---|---|
| PATCH | `/users/me` | Edita nombre/apellido/teléfono/avatar/complejo habitual. |
| GET | `/players/:id/matches` | Historial de partidos de un jugador (un `PLAYER` solo puede pedir el suyo). |
| GET | `/users` (ADMIN) | Lista de usuarios, filtrable por `?role=`. |

## Complejos / Canchas / Cámaras

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/complexes` | Lista pública de complejos. |
| GET | `/complexes/:id` | Detalle con canchas + suscripción. |
| POST | `/complexes` (SUPER_ADMIN) | Alta de complejo (crea su `subscription` en la misma transacción). |
| PATCH / DELETE | `/complexes/:id` (ADMIN) | Edición/baja. |
| GET | `/courts?complexId=` | Canchas de un complejo. |
| POST / PATCH / DELETE | `/courts` (ADMIN) | CRUD de canchas. |
| GET | `/cameras` (ADMIN) | Lista con estado online/offline. |
| POST / PATCH / DELETE | `/cameras` (ADMIN) | CRUD de cámaras. |
| POST | `/cameras/:id/heartbeat` (ADMIN) | Marca online/offline (ver ARCHITECTURE.md §6 para el health-checker real). |

## Partidos (el buscador — §5)

`GET /matches` — devuelve los partidos visibles para el usuario (un `PLAYER` solo ve los
suyos; un admin los ve todos, filtrable por `complexId`). Query params, todos opcionales y
combinables:

| Param | Valores | Nota |
|---|---|---|
| `datePreset` | `today` \| `yesterday` \| `week` \| `month` | Ignorado si se manda `date` o `dateFrom`/`dateTo` |
| `date` | `YYYY-MM-DD` | Fecha específica |
| `dateFrom`, `dateTo` | `YYYY-MM-DD` | Rango de fechas |
| `sportType` | `FUTBOL5` \| `PADEL` | |
| `courtId` / `complexId` | uuid | |
| `timeFrom`, `timeTo` | `HH:mm` | Franja horaria, ej. `18:00`→`23:00` |

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/matches/:id` | Detalle completo (equipos, jugadores, eventos, video+segmentos). 403 si un `PLAYER` no jugó ese partido. |
| GET | `/matches/:id/events` | Solo los eventos, ordenados por tiempo. |
| POST | `/matches` (ADMIN) | Alta (con `teams` embebidos opcional). |
| PATCH / DELETE | `/matches/:id` (ADMIN) | Edición/baja. |
| POST | `/matches/:id/players` (ADMIN) | Asigna jugadores/invitados a equipos. |
| POST | `/matches/:id/events` (ADMIN) | Carga un evento (gol, tarjeta, etc.) con su timestamp. |
| POST | `/matches/:id/video` (ADMIN, multipart `file`) | Sube el video fuente y **dispara el pipeline FFmpeg** (encola el job). |

## Videos

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/videos/:id` | Metadata + segmentos. |
| GET | `/videos/:id/segments` | Solo los segmentos. |
| GET | `/videos/:id/playback` | `{ status, manifestUrl, thumbnailsVttUrl, durationSeconds }` — URLs **firmadas**, listas para `hls.js`. |
| GET | `/stream/:token` | Sirve los bytes reales (manifest reescrito / segmento `.ts` con Range requests / sprite / vtt reescrito). El token es un JWT de corta duración — nunca se llama a mano. |

## Marcadores (Timeslice privado — §7)

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/matches/:id/bookmarks` | Mis marcadores en ese partido. |
| POST | `/matches/:id/bookmarks` | `{ timestampSeconds, label }`. |
| DELETE | `/bookmarks/:id` | Solo el dueño puede borrar el suyo. |

## Clips ("Mis mejores momentos" — §16)

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/clips` | Mis clips. |
| POST | `/clips` | `{ matchId, title, startSeconds, endSeconds }` — encola la generación. |
| GET | `/clips/:id/playback` | URL firmada una vez que `status === 'READY'`. |

## Compartir (§17)

| Método | Ruta | Descripción |
|---|---|---|
| POST | `/share-links` | `{ matchId? , clipId?, visibility, expiresInHours? }`. |
| GET | `/share/:token` (público si `visibility=PUBLIC`) | Resuelve a una URL de streaming firmada; nunca al archivo real. |

## Notificaciones

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/notifications` | Últimas 50. |
| PATCH | `/notifications/:id/read` | Marca como leída. |

## Admin (§20/§35/§36)

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/admin/stats` (ADMIN) | Usuarios, partidos, horas grabadas, canchas activas, cámaras online, clips. |
| GET | `/admin/storage` (ADMIN) | Usado/disponible, videos más pesados, partidos con +90 días. |
| GET | `/admin/audit-logs` (SUPER_ADMIN) | Últimas 100 acciones auditadas. |

## Convención de errores

Respuestas de error siguen el formato estándar de NestJS:
`{ "statusCode": 403, "message": "No tenés acceso a este partido", "error": "Forbidden" }`.
