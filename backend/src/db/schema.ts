// LIVEPLAY — esquema de base de datos (Drizzle ORM)
//
// Se optó por Drizzle + node-postgres (`pg`) en lugar de Prisma: Drizzle es 100% TypeScript
// puro (sin binario nativo que descargar en tiempo de generación/instalación), lo cual es más
// robusto para desplegar en entornos con egress de red restringido (exactamente la situación
// de este sandbox: el CDN de binarios de Prisma está bloqueado por la política de red). Es una
// decisión también válida a largo plazo: menos piezas móviles en producción, migraciones SQL
// explícitas y versionadas, y el mismo nivel de type-safety end-to-end.
//
// Ver /docs/DATABASE.md para el diagrama entidad-relación y las decisiones de diseño.

import { randomUUID } from 'crypto';
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  varchar,
  timestamp,
  date,
  boolean,
  integer,
  doublePrecision,
  jsonb,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

const id = () => uuid('id').primaryKey().$defaultFn(() => randomUUID());
const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
};

// ──────────────────────────────────────────────────────────────
// ENUMS
// ──────────────────────────────────────────────────────────────

export const roleEnum = pgEnum('role', ['SUPER_ADMIN', 'COMPLEX_ADMIN', 'PLAYER']);
export const sportTypeEnum = pgEnum('sport_type', ['FUTBOL5', 'PADEL']);
export const courtStatusEnum = pgEnum('court_status', ['ACTIVE', 'MAINTENANCE', 'INACTIVE']);
export const cameraTypeEnum = pgEnum('camera_type', ['IP_CAMERA', 'RTSP', 'NVR', 'DVR', 'IMOU_CLOUD']);
export const cameraStatusEnum = pgEnum('camera_status', ['ONLINE', 'OFFLINE', 'UNKNOWN']);
export const matchStatusEnum = pgEnum('match_status', ['SCHEDULED', 'RECORDING', 'PROCESSING', 'READY', 'FAILED']);
export const videoStatusEnum = pgEnum('video_status', ['PENDING', 'PROCESSING', 'READY', 'FAILED']);
export const segmentStatusEnum = pgEnum('segment_status', ['PENDING', 'PROCESSED', 'FAILED']);
export const eventTypeEnum = pgEnum('event_type', ['GOAL', 'YELLOW_CARD', 'RED_CARD', 'GREAT_SAVE', 'HIGHLIGHT', 'SET_POINT', 'CUSTOM']);
export const clipStatusEnum = pgEnum('clip_status', ['PENDING', 'READY', 'FAILED']);
export const visibilityEnum = pgEnum('visibility', ['PUBLIC', 'PRIVATE', 'REGISTERED_ONLY']);
export const notificationTypeEnum = pgEnum('notification_type', ['MATCH_READY', 'CLIP_READY', 'SYSTEM']);
export const storageProviderEnum = pgEnum('storage_provider', ['LOCAL', 'S3']);
export const subscriptionPlanEnum = pgEnum('subscription_plan', ['FREE', 'BASIC', 'PRO', 'ENTERPRISE']);
export const subscriptionStatusEnum = pgEnum('subscription_status', ['ACTIVE', 'PAST_DUE', 'CANCELED', 'TRIALING']);
/**
 * Pase de acceso pagado a los videos de un complejo (ver `videoAccessPasses` más abajo).
 * PENDING: se creó la preferencia de Mercado Pago, todavía no llegó confirmación de pago.
 * APPROVED: el webhook confirmó el pago — mientras `expiresAt` no haya pasado, desbloquea.
 * REJECTED: Mercado Pago rechazó/canceló el pago (tarjeta rechazada, el usuario abandonó, etc.).
 * EXPIRED: no es un status que el webhook ponga — se calcula en el momento (expiresAt < now())
 *   comparando contra `expiresAt`, queda acá solo para dejar un registro histórico explícito si
 *   en el futuro corremos un job que los marque así (hoy no existe ese job).
 */
export const videoAccessPassStatusEnum = pgEnum('video_access_pass_status', ['PENDING', 'APPROVED', 'REJECTED', 'EXPIRED']);

// ──────────────────────────────────────────────────────────────
// USUARIOS Y AUTENTICACIÓN
// ──────────────────────────────────────────────────────────────

export const users = pgTable('users', {
  id: id(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  firstName: text('first_name').notNull(),
  lastName: text('last_name').notNull(),
  phone: text('phone'),
  avatarUrl: text('avatar_url'),
  role: roleEnum('role').notNull().default('PLAYER'),
  homeComplexId: uuid('home_complex_id'),
  managedComplexId: uuid('managed_complex_id'),
  emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
  emailVerifyToken: text('email_verify_token').unique(),
  passwordResetToken: text('password_reset_token').unique(),
  passwordResetExpiresAt: timestamp('password_reset_expires_at', { withTimezone: true }),
  ...timestamps,
}, (t) => ({
  roleIdx: index('users_role_idx').on(t.role),
}));

export const refreshTokens = pgTable('refresh_tokens', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  userIdx: index('refresh_tokens_user_idx').on(t.userId),
}));

// ──────────────────────────────────────────────────────────────
// COMPLEJOS, CANCHAS Y CÁMARAS
// ──────────────────────────────────────────────────────────────

export const complexes = pgTable('complexes', {
  id: id(),
  name: text('name').notNull(),
  address: text('address'),
  /** Ciudad del complejo — habilita el buscador público por ciudad (§5.1, buscador multi-cancha). */
  city: text('city'),
  timezone: text('timezone').notNull().default('America/Argentina/Buenos_Aires'),
  openingHours: jsonb('opening_hours'),
  logoUrl: text('logo_url'),
  /**
   * Pago por ver videos (2026-10-16): el dueño del complejo puede elegir cobrar por ver los
   * partidos grabados. Cuando `chargesForVideoAccess` es true, `videoAccessPriceArs` y
   * `videoAccessPassDays` tienen que estar cargados (lo valida ComplexesService.update, no una
   * constraint de DB, para no tener que lidiar con CHECK constraints condicionales en Postgres).
   * El pago desbloquea TODO el complejo (no un partido puntual) por `videoAccessPassDays` días
   * desde que se acredita — ver `videoAccessPasses` más abajo y `MercadopagoService`.
   */
  chargesForVideoAccess: boolean('charges_for_video_access').notNull().default(false),
  /** Precio del pase en pesos argentinos (ARS), con decimales (ej. 1500.50). Null si el
   * complejo no cobra. */
  videoAccessPriceArs: doublePrecision('video_access_price_ars'),
  /** Cuántos días dura el pase una vez acreditado el pago. Null si el complejo no cobra. */
  videoAccessPassDays: integer('video_access_pass_days'),
  ...timestamps,
}, (t) => ({
  cityIdx: index('complexes_city_idx').on(t.city),
}));

/**
 * Credenciales OAuth de la cuenta de Mercado Pago DEL PROPIO COMPLEJO (modelo marketplace: la
 * plata del pago entra directo a esta cuenta, no a una cuenta central de LivePlay — ver
 * MercadopagoService.createPreference, que usa `accessToken` de ACÁ, no uno global, y manda
 * `marketplace_fee` para que LivePlay se quede con su comisión al vuelo). Tabla separada de
 * `complexes` a propósito: `GET /complexes/:id` es público (buscador de complejos) y nunca
 * tiene que poder filtrar un access_token/refresh_token en esa respuesta — esta tabla no tiene
 * relación Drizzle agregada a `complexesRelations` para que nadie la traiga sin querer con un
 * `with: {...}` genérico; se consulta siempre explícita y solo desde MercadopagoService.
 */
export const complexMercadoPagoAccounts = pgTable('complex_mercadopago_accounts', {
  id: id(),
  complexId: uuid('complex_id').notNull().unique().references(() => complexes.id, { onDelete: 'cascade' }),
  /** "collector_id" / user_id del vendedor en Mercado Pago — identifica la cuenta conectada. */
  mpUserId: text('mp_user_id').notNull(),
  accessToken: text('access_token').notNull(),
  refreshToken: text('refresh_token').notNull(),
  publicKey: text('public_key'),
  /** Cuándo vence `accessToken` — MercadopagoService lo renueva solo (con `refreshToken`) antes
   * de que esto llegue, nunca esperamos a que falle un pago por un token vencido. */
  tokenExpiresAt: timestamp('token_expires_at', { withTimezone: true }).notNull(),
  connectedAt: timestamp('connected_at', { withTimezone: true }).defaultNow().notNull(),
  ...timestamps,
});

/**
 * Un pase de acceso a los videos de un complejo, comprado por un usuario puntual (decisión
 * 2026-10-16: el pago desbloquea TODO el complejo por `passDaysSnapshot` días, no un partido
 * individual — ver comentario en `complexes.videoAccessPassDays`). Queda ligado a la cuenta que
 * pagó (no es un link compartible): VideosService.getAuthorized exige un pase propio con
 * `status = 'APPROVED'` y `expiresAt > now()` para ese `(complexId, userId)`.
 *
 * `amountArs`/`passDaysSnapshot` quedan copiados del precio/duración configurados en el
 * complejo AL MOMENTO DE LA COMPRA — si el admin cambia el precio o la duración del pase
 * después, no debe afectar pases ya comprados (ni retroactivamente cobrar de más, ni acortar un
 * pase ya vigente).
 */
export const videoAccessPasses = pgTable('video_access_passes', {
  id: id(),
  complexId: uuid('complex_id').notNull().references(() => complexes.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  status: videoAccessPassStatusEnum('status').notNull().default('PENDING'),
  amountArs: doublePrecision('amount_ars').notNull(),
  passDaysSnapshot: integer('pass_days_snapshot').notNull(),
  /** Token único que viaja como `external_reference` en la preferencia de Mercado Pago — es
   * como el webhook (que solo trae un payment id de Mercado Pago) encuentra de vuelta ESTA
   * fila sin ambigüedad. */
  externalReference: text('external_reference').notNull().unique(),
  mpPreferenceId: text('mp_preference_id'),
  /** Null hasta que el webhook confirma el pago — ahí sí es el id de pago real de Mercado Pago,
   * único (nunca procesamos el mismo pago dos veces aunque el webhook llegue duplicado). */
  mpPaymentId: text('mp_payment_id').unique(),
  /** Cuándo se acreditó el pago (status pasó a APPROVED). Null en PENDING/REJECTED. */
  purchasedAt: timestamp('purchased_at', { withTimezone: true }),
  /** purchasedAt + passDaysSnapshot días. Null hasta que se acredita. */
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  ...timestamps,
}, (t) => ({
  complexUserIdx: index('video_access_passes_complex_user_idx').on(t.complexId, t.userId),
  externalRefIdx: index('video_access_passes_external_ref_idx').on(t.externalReference),
}));

/**
 * Canchas favoritas de un jugador (2026-10-22, pedido del cliente: "si en el filtro pongo padel
 * me dice que no hay nada" — con el gate de ciudad/complejo agregado el mismo día, "Mis
 * partidos" había quedado acotado a UN solo complejo `users.homeComplexId`, así que un jugador
 * que juega Fútbol 5 en un complejo y Pádel en otro nunca encontraba el segundo salvo que tocara
 * "Cambiar cancha"). Reemplaza esa restricción de "un complejo fijo" por una lista: un jugador
 * puede marcar varios complejos como favoritos, y `MatchesService.search` busca en TODOS a la
 * vez (ver `complexIds` en `SearchMatchesDto`) — así el filtro de deporte encuentra el partido
 * sin importar en cuál de los complejos favoritos quedó grabado. `users.homeComplexId` queda sin
 * usar por el frontend nuevo (no se borra la columna: barato de mantener, y
 * `UsersService.listFavoriteComplexes` migra en el momento cualquier valor viejo ahí guardado,
 * convirtiéndolo en el primer favorito la primera vez que se consulta).
 */
export const userFavoriteComplexes = pgTable('user_favorite_complexes', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  complexId: uuid('complex_id').notNull().references(() => complexes.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  userComplexUnique: uniqueIndex('user_favorite_complexes_user_complex_idx').on(t.userId, t.complexId),
  userIdx: index('user_favorite_complexes_user_idx').on(t.userId),
}));

export const courts = pgTable('courts', {
  id: id(),
  complexId: uuid('complex_id').notNull().references(() => complexes.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  sportType: sportTypeEnum('sport_type').notNull(),
  status: courtStatusEnum('status').notNull().default('ACTIVE'),
  location: text('location'),
  /**
   * Horario fijo de turnos de la cancha, usado por `MatchSchedulerService` (backend/src/
   * matches/match-scheduler.service.ts) para generar automáticamente un partido por cada
   * turno de la grilla, sin que nadie tenga que "cargar" un partido a mano (decisión
   * 2026-09-19: en un club real nadie hace eso, la cancha simplemente tiene turnos fijos).
   * Forma esperada (null = esta cancha no genera turnos automáticos):
   *   { openDays: number[] (1=lunes..7=domingo), turnStart: "HH:MM", turnEnd: "HH:MM" (hora
   *     de INICIO del último turno, no de cierre), turnDurationMinutes: number }
   */
  operatingHours: jsonb('operating_hours'),
  ...timestamps,
}, (t) => ({
  complexIdx: index('courts_complex_idx').on(t.complexId),
}));

export const cameras = pgTable('cameras', {
  id: id(),
  courtId: uuid('court_id').notNull().unique().references(() => courts.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  type: cameraTypeEnum('type').notNull(),
  rtspUrl: text('rtsp_url'),
  nvrChannel: integer('nvr_channel'),
  status: cameraStatusEnum('status').notNull().default('UNKNOWN'),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
  /**
   * Hash (sha256) del token que usa el agente local instalado en el complejo (ver
   * backend/AGENTE.md) para autenticarse contra /agent/* sin necesitar un login humano — nunca
   * guardamos el token en texto plano, solo su hash (§25, mismo criterio que las contraseñas).
   */
  agentKeyHash: text('agent_key_hash'),
  /**
   * Campos usados solo cuando `type = 'IMOU_CLOUD'`: la cámara no está en la red del backend
   * (ni tiene agente local) sino vinculada a una cuenta cloud de Imou/Dahua (ver
   * `backend/src/cameras/imou-cloud.client.ts`). `imouDeviceId` es el número de serie del
   * dispositivo tal como lo reconoce el open platform de Imou; `imouChannelId` es casi siempre
   * "0" salvo NVRs multicanal. No guardamos el `code`/contraseña de vinculación una vez que
   * `bindDevice` se ejecutó con éxito — Imou ya asoció el dispositivo a nuestra `appId`.
   */
  imouDeviceId: text('imou_device_id'),
  imouChannelId: text('imou_channel_id'),
  /**
   * Alta simplificada por "código de enrolamiento" (2026-09-30): en vez de tipear config.env a
   * mano en el TV box (proceso "muy engorroso" según feedback del usuario — ver AGENTE.md), el
   * admin genera desde el panel un código corto de un solo uso; el TV box lo canjea contra
   * `POST /agent/enroll` y recibe de vuelta el bundle completo de config (backendUrl, token de
   * agente, RTSP URL). Estos 3 campos son efímeros: se completan al generar el código y se
   * borran los tres apenas se canjea (o quedan vencidos) — nunca conviven con un código ya usado.
   * `pendingAgentToken` es la única excepción al criterio de "nunca texto plano" de
   * `agentKeyHash`: acá vive el token real en texto plano durante la ventana de canje (10 min)
   * porque hace falta poder devolvérselo tal cual al TV box; fuera de esa ventana siempre es
   * null, igual que los otros dos.
   */
  enrollmentCodeHash: text('enrollment_code_hash'),
  enrollmentCodeExpiresAt: timestamp('enrollment_code_expires_at', { withTimezone: true }),
  pendingAgentToken: text('pending_agent_token'),
  ...timestamps,
});

// ──────────────────────────────────────────────────────────────
// PARTIDOS, EQUIPOS/PAREJAS Y JUGADORES
// ──────────────────────────────────────────────────────────────

export const matches = pgTable('matches', {
  id: id(),
  complexId: uuid('complex_id').notNull().references(() => complexes.id, { onDelete: 'cascade' }),
  courtId: uuid('court_id').notNull().references(() => courts.id, { onDelete: 'cascade' }),
  sportType: sportTypeEnum('sport_type').notNull(),
  date: date('date').notNull(),
  startTime: timestamp('start_time', { withTimezone: true }).notNull(),
  endTime: timestamp('end_time', { withTimezone: true }),
  status: matchStatusEnum('status').notNull().default('SCHEDULED'),
  resultSummary: jsonb('result_summary'),
  ...timestamps,
}, (t) => ({
  complexDateIdx: index('matches_complex_date_idx').on(t.complexId, t.date),
  courtDateIdx: index('matches_court_date_idx').on(t.courtId, t.date),
  sportDateIdx: index('matches_sport_date_idx').on(t.sportType, t.date),
}));

/** Fútbol -> "Equipo Azul"; Pádel -> "Pareja A" */
export const teams = pgTable('teams', {
  id: id(),
  matchId: uuid('match_id').notNull().references(() => matches.id, { onDelete: 'cascade' }),
  label: text('label').notNull(),
  score: integer('score'),
  setsWon: integer('sets_won'),
}, (t) => ({
  matchIdx: index('teams_match_idx').on(t.matchId),
}));

export const matchPlayers = pgTable('match_players', {
  id: id(),
  matchId: uuid('match_id').notNull().references(() => matches.id, { onDelete: 'cascade' }),
  teamId: uuid('team_id').references(() => teams.id, { onDelete: 'set null' }),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  guestName: text('guest_name'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  matchIdx: index('match_players_match_idx').on(t.matchId),
  userIdx: index('match_players_user_idx').on(t.userId),
}));

// ──────────────────────────────────────────────────────────────
// VIDEO, SEGMENTACIÓN HLS Y THUMBNAILS
// ──────────────────────────────────────────────────────────────

export const videos = pgTable('videos', {
  id: id(),
  matchId: uuid('match_id').notNull().unique().references(() => matches.id, { onDelete: 'cascade' }),
  status: videoStatusEnum('status').notNull().default('PENDING'),
  storageProvider: storageProviderEnum('storage_provider').notNull().default('LOCAL'),
  storageBaseKey: text('storage_base_key').notNull(),
  originalFileKey: text('original_file_key'),
  hlsManifestKey: text('hls_manifest_key'),
  posterKey: text('poster_key'),
  thumbnailSpriteKey: text('thumbnail_sprite_key'),
  thumbnailVttKey: text('thumbnail_vtt_key'),
  durationSeconds: doublePrecision('duration_seconds'),
  width: integer('width'),
  height: integer('height'),
  fps: doublePrecision('fps'),
  sizeBytes: doublePrecision('size_bytes'),
  errorMessage: text('error_message'),
  /**
   * Incidente 2026-10-08: en "modo puente" (ver backend/AGENTE.md) un corte de wifi en la cancha
   * a mitad de partido puede hacer que la grabación de origen llegue incompleta sin que FFmpeg
   * tire ningún error (procesa fielmente el archivo corto que recibió). `durationWarning` queda
   * en `true` cuando `VideoProcessingService.runMatchVideoPipeline` detecta que la duración real
   * quedó muy por debajo de la esperada para el turno (`matches.endTime - matches.startTime`),
   * para poder distinguir ese caso de un video `READY` genuinamente completo.
   */
  durationWarning: boolean('duration_warning').notNull().default(false),
  ...timestamps,
});

export const videoSegments = pgTable('video_segments', {
  id: id(),
  videoId: uuid('video_id').notNull().references(() => videos.id, { onDelete: 'cascade' }),
  index: integer('index').notNull(),
  startOffsetSeconds: doublePrecision('start_offset_seconds').notNull(),
  endOffsetSeconds: doublePrecision('end_offset_seconds').notNull(),
  storageKey: text('storage_key').notNull(),
  durationSeconds: doublePrecision('duration_seconds').notNull(),
  status: segmentStatusEnum('status').notNull().default('PENDING'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  videoIdxUnique: uniqueIndex('video_segments_video_index_unique').on(t.videoId, t.index),
  videoIdx: index('video_segments_video_idx').on(t.videoId),
}));

// ──────────────────────────────────────────────────────────────
// EVENTOS, MARCADORES Y CLIPS
// ──────────────────────────────────────────────────────────────

export const events = pgTable('events', {
  id: id(),
  matchId: uuid('match_id').notNull().references(() => matches.id, { onDelete: 'cascade' }),
  type: eventTypeEnum('type').notNull(),
  timestampSeconds: doublePrecision('timestamp_seconds').notNull(),
  label: text('label'),
  teamId: uuid('team_id').references(() => teams.id, { onDelete: 'set null' }),
  matchPlayerId: uuid('match_player_id').references(() => matchPlayers.id, { onDelete: 'set null' }),
  createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  matchTimeIdx: index('events_match_time_idx').on(t.matchId, t.timestampSeconds),
}));

export const bookmarks = pgTable('bookmarks', {
  id: id(),
  matchId: uuid('match_id').notNull().references(() => matches.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  timestampSeconds: doublePrecision('timestamp_seconds').notNull(),
  label: text('label').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  matchUserIdx: index('bookmarks_match_user_idx').on(t.matchId, t.userId),
}));

export const clips = pgTable('clips', {
  id: id(),
  // Nullable con onDelete 'set null' (antes 'cascade', not null) desde el 2026-10-05: un clip
  // es un archivo independiente (storageKey propio, generado por FFmpeg a partir del video
  // original sin tocarlo), así que no tiene que desaparecer solo porque el partido de origen
  // se borra — y ahora SÍ se borra de verdad, ver MatchRetentionService (purga partidos de más
  // de MATCH_RETENTION_DAYS). Si el FK siguiera en cascada, borrar un partido viejo borraría
  // también los clips ya generados a partir de él (y dejaría su archivo huérfano en el storage
  // para siempre), contradiciendo la regla ya establecida de que "los clips no vencen" (ver
  // sección "4 fixes pre-lanzamiento" del resumen del proyecto). Ver migración
  // 0006_clips_match_id_nullable.sql.
  matchId: uuid('match_id').references(() => matches.id, { onDelete: 'set null' }),
  createdByUserId: uuid('created_by_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  startSeconds: doublePrecision('start_seconds').notNull(),
  endSeconds: doublePrecision('end_seconds').notNull(),
  status: clipStatusEnum('status').notNull().default('PENDING'),
  storageKey: text('storage_key'),
  visibility: visibilityEnum('visibility').notNull().default('PRIVATE'),
  errorMessage: text('error_message'),
  ...timestamps,
}, (t) => ({
  matchIdx: index('clips_match_idx').on(t.matchId),
  userIdx: index('clips_user_idx').on(t.createdByUserId),
}));

export const shareLinks = pgTable('share_links', {
  id: id(),
  token: text('token').notNull().unique(),
  matchId: uuid('match_id').references(() => matches.id, { onDelete: 'cascade' }),
  clipId: uuid('clip_id').references(() => clips.id, { onDelete: 'cascade' }),
  visibility: visibilityEnum('visibility').notNull().default('PRIVATE'),
  createdByUserId: uuid('created_by_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  viewCount: integer('view_count').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  tokenIdx: index('share_links_token_idx').on(t.token),
}));

// ──────────────────────────────────────────────────────────────
// NOTIFICACIONES Y AUDITORÍA
// ──────────────────────────────────────────────────────────────

export const notifications = pgTable('notifications', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  type: notificationTypeEnum('type').notNull(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  read: boolean('read').notNull().default(false),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  userReadIdx: index('notifications_user_read_idx').on(t.userId, t.read),
}));

export const auditLogs = pgTable('audit_logs', {
  id: id(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  action: text('action').notNull(),
  entity: text('entity'),
  entityId: text('entity_id'),
  metadata: jsonb('metadata'),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  userIdx: index('audit_logs_user_idx').on(t.userId),
  actionIdx: index('audit_logs_action_idx').on(t.action),
}));

// ──────────────────────────────────────────────────────────────
// SUSCRIPCIONES (preparado para monetización futura)
// ──────────────────────────────────────────────────────────────

export const subscriptions = pgTable('subscriptions', {
  id: id(),
  complexId: uuid('complex_id').notNull().unique().references(() => complexes.id, { onDelete: 'cascade' }),
  plan: subscriptionPlanEnum('plan').notNull().default('FREE'),
  status: subscriptionStatusEnum('status').notNull().default('TRIALING'),
  renewsAt: timestamp('renews_at', { withTimezone: true }),
  cameraLimit: integer('camera_limit').notNull().default(5),
  retentionDays: integer('retention_days').notNull().default(60),
  ...timestamps,
});

// ──────────────────────────────────────────────────────────────
// RELACIONES (habilitan db.query.x.findMany({ with: {...} }))
// ──────────────────────────────────────────────────────────────

export const usersRelations = relations(users, ({ one, many }) => ({
  homeComplex: one(complexes, { fields: [users.homeComplexId], references: [complexes.id] }),
  refreshTokens: many(refreshTokens),
  matchPlayers: many(matchPlayers),
  bookmarks: many(bookmarks),
  clips: many(clips),
  videoAccessPasses: many(videoAccessPasses),
  favoriteComplexes: many(userFavoriteComplexes),
}));

export const complexesRelations = relations(complexes, ({ many, one }) => ({
  courts: many(courts),
  matches: many(matches),
  subscription: one(subscriptions, { fields: [complexes.id], references: [subscriptions.complexId] }),
  // OJO: a propósito NO hay una relación `mercadoPagoAccount` acá — ver el comentario grande en
  // `complexMercadoPagoAccounts` sobre por qué esa tabla se consulta siempre explícita.
  videoAccessPasses: many(videoAccessPasses),
  favoritedBy: many(userFavoriteComplexes),
}));

export const userFavoriteComplexesRelations = relations(userFavoriteComplexes, ({ one }) => ({
  user: one(users, { fields: [userFavoriteComplexes.userId], references: [users.id] }),
  complex: one(complexes, { fields: [userFavoriteComplexes.complexId], references: [complexes.id] }),
}));

export const complexMercadoPagoAccountsRelations = relations(complexMercadoPagoAccounts, ({ one }) => ({
  complex: one(complexes, { fields: [complexMercadoPagoAccounts.complexId], references: [complexes.id] }),
}));

export const videoAccessPassesRelations = relations(videoAccessPasses, ({ one }) => ({
  complex: one(complexes, { fields: [videoAccessPasses.complexId], references: [complexes.id] }),
  user: one(users, { fields: [videoAccessPasses.userId], references: [users.id] }),
}));

export const courtsRelations = relations(courts, ({ one, many }) => ({
  complex: one(complexes, { fields: [courts.complexId], references: [complexes.id] }),
  camera: one(cameras, { fields: [courts.id], references: [cameras.courtId] }),
  matches: many(matches),
}));

export const camerasRelations = relations(cameras, ({ one }) => ({
  court: one(courts, { fields: [cameras.courtId], references: [courts.id] }),
}));

export const matchesRelations = relations(matches, ({ one, many }) => ({
  complex: one(complexes, { fields: [matches.complexId], references: [complexes.id] }),
  court: one(courts, { fields: [matches.courtId], references: [courts.id] }),
  teams: many(teams),
  players: many(matchPlayers),
  events: many(events),
  bookmarks: many(bookmarks),
  clips: many(clips),
  video: one(videos, { fields: [matches.id], references: [videos.matchId] }),
}));

export const teamsRelations = relations(teams, ({ one, many }) => ({
  match: one(matches, { fields: [teams.matchId], references: [matches.id] }),
  players: many(matchPlayers),
}));

export const matchPlayersRelations = relations(matchPlayers, ({ one }) => ({
  match: one(matches, { fields: [matchPlayers.matchId], references: [matches.id] }),
  team: one(teams, { fields: [matchPlayers.teamId], references: [teams.id] }),
  user: one(users, { fields: [matchPlayers.userId], references: [users.id] }),
}));

export const videosRelations = relations(videos, ({ one, many }) => ({
  match: one(matches, { fields: [videos.matchId], references: [matches.id] }),
  segments: many(videoSegments),
}));

export const videoSegmentsRelations = relations(videoSegments, ({ one }) => ({
  video: one(videos, { fields: [videoSegments.videoId], references: [videos.id] }),
}));

export const eventsRelations = relations(events, ({ one }) => ({
  match: one(matches, { fields: [events.matchId], references: [matches.id] }),
  team: one(teams, { fields: [events.teamId], references: [teams.id] }),
}));

export const clipsRelations = relations(clips, ({ one }) => ({
  match: one(matches, { fields: [clips.matchId], references: [matches.id] }),
  createdByUser: one(users, { fields: [clips.createdByUserId], references: [users.id] }),
}));

export const shareLinksRelations = relations(shareLinks, ({ one }) => ({
  match: one(matches, { fields: [shareLinks.matchId], references: [matches.id] }),
  clip: one(clips, { fields: [shareLinks.clipId], references: [clips.id] }),
}));

export const subscriptionsRelations = relations(subscriptions, ({ one }) => ({
  complex: one(complexes, { fields: [subscriptions.complexId], references: [complexes.id] }),
}));
