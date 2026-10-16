export type Role = 'SUPER_ADMIN' | 'COMPLEX_ADMIN' | 'PLAYER';
export type SportType = 'FUTBOL5' | 'PADEL';
export type CourtStatus = 'ACTIVE' | 'MAINTENANCE' | 'INACTIVE';
export type CameraType = 'IP_CAMERA' | 'RTSP' | 'NVR' | 'DVR' | 'IMOU_CLOUD';
export type MatchStatus = 'SCHEDULED' | 'RECORDING' | 'PROCESSING' | 'READY' | 'FAILED';
export type VideoStatus = 'PENDING' | 'PROCESSING' | 'READY' | 'FAILED';
export type EventType = 'GOAL' | 'YELLOW_CARD' | 'RED_CARD' | 'GREAT_SAVE' | 'HIGHLIGHT' | 'SET_POINT' | 'CUSTOM';

export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone?: string | null;
  avatarUrl?: string | null;
  role: Role;
  homeComplexId?: string | null;
}

export interface Complex {
  id: string;
  name: string;
  address?: string | null;
  city?: string | null;
  timezone?: string;
  courts?: Court[];
  /** Pago por ver videos (ver backend/src/payments) — null en priceArs/passDays mientras
   * chargesForVideoAccess es false. */
  chargesForVideoAccess?: boolean;
  videoAccessPriceArs?: number | null;
  videoAccessPassDays?: number | null;
}

/** Estado de conexión de la cuenta de Mercado Pago del complejo (GET .../mercadopago/status). */
export interface MercadoPagoConnectionStatus {
  connected: boolean;
  mpUserId: string | null;
  connectedAt: string | null;
}

/** Respuesta de POST /complexes (ver ComplexesService.create): además del complejo, devuelve el
 * usuario COMPLEX_ADMIN recién creado y su contraseña temporal EN TEXTO PLANO — solo viaja acá,
 * una vez, nunca se puede volver a consultar. */
export interface ComplexCreationResult {
  complex: Complex;
  admin: { id: string; email: string; firstName: string; lastName: string };
  adminTempPassword: string;
}

/** Un pase de acceso a videos vendido (GET .../video-access/payments) — ver `videoAccessPasses`
 * en el backend. `user` puede venir null si el usuario que pagó fue borrado después. */
export interface VideoAccessPass {
  id: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED';
  amountArs: number;
  purchasedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  user: { firstName: string; lastName: string; email: string } | null;
}

export interface VideoAccessPassesResponse {
  passes: VideoAccessPass[];
  totalApprovedArs: number;
}

/** Horario fijo de turnos de una cancha — ver `MatchSchedulerService` en el backend. */
export interface CourtOperatingHours {
  /** 1=lunes ... 7=domingo */
  openDays: number[];
  /** "HH:MM" (24hs) */
  turnStart: string;
  /** "HH:MM" (24hs) — hora de INICIO del último turno del día, no de cierre */
  turnEnd: string;
  turnDurationMinutes: number;
}

export interface Court {
  id: string;
  complexId?: string;
  name: string;
  sportType: SportType;
  status: CourtStatus | string;
  location?: string | null;
  operatingHours?: CourtOperatingHours | null;
  complex?: Complex;
  camera?: Camera | null;
}

export interface Camera {
  id: string;
  courtId?: string;
  name: string;
  type: CameraType | string;
  status: 'ONLINE' | 'OFFLINE' | 'UNKNOWN';
  lastSeenAt?: string | null;
  rtspUrl?: string | null;
  nvrChannel?: number | null;
  imouDeviceId?: string | null;
  imouChannelId?: string | null;
  court?: Court;
}

/** Dispositivo que el Imou Open Platform ya reconoce como vinculado/compartido a nuestra appId
 * (GET /cameras/imou/devices) — ver backend/src/cameras/imou-cloud.client.ts. */
export interface ImouDevice {
  bindId: number;
  deviceId: string;
  channels: { channelId: string; channelName: string }[];
}

export interface Team {
  id: string;
  label: string;
  score?: number | null;
  setsWon?: number | null;
}

/** Resultado liviano del buscador público (GET /discovery/matches) — sin datos personales de
 * jugadores ni URLs de video, ver backend/src/discovery/discovery.service.ts. */
export interface PublicMatchSummary {
  id: string;
  date: string;
  startTime: string;
  endTime?: string | null;
  sportType: SportType;
  status: MatchStatus;
  teams: Team[];
  hasVideo: boolean;
}

export interface MatchPlayerUser {
  id: string;
  matchId: string;
  teamId?: string | null;
  userId?: string | null;
  guestName?: string | null;
  user?: User | null;
  team?: Team | null;
}

export interface VideoSegment {
  id: string;
  index: number;
  startOffsetSeconds: number;
  endOffsetSeconds: number;
  durationSeconds: number;
}

export interface Video {
  id: string;
  status: VideoStatus;
  durationSeconds?: number | null;
  /**
   * Incidente 2026-10-08: en "modo puente" (ver backend/AGENTE.md) un corte de wifi en la
   * cancha a mitad de partido puede hacer que la grabación de origen llegue incompleta sin que
   * FFmpeg tire ningún error (procesa fielmente el archivo corto que recibió). `true` cuando
   * `VideoProcessingService.runMatchVideoPipeline` detectó que la duración real quedó muy por
   * debajo de la esperada para el turno — el video queda `READY` igual, pero esto lo marca
   * para revisión manual en vez de pasar desapercibido.
   */
  durationWarning?: boolean | null;
  sizeBytes?: number | null;
  width?: number | null;
  height?: number | null;
  segments?: VideoSegment[];
  /** URL firmada de corta duración a un frame del video, para usar de portada en las tarjetas. */
  posterUrl?: string | null;
}

export interface MatchEvent {
  id: string;
  type: EventType;
  timestampSeconds: number;
  label?: string | null;
  teamId?: string | null;
}

export interface Match {
  id: string;
  complexId: string;
  courtId: string;
  sportType: SportType;
  date: string;
  startTime: string;
  endTime?: string | null;
  status: MatchStatus;
  resultSummary?: Record<string, any> | null;
  court?: Court;
  complex?: Complex;
  teams?: Team[];
  players?: MatchPlayerUser[];
  events?: MatchEvent[];
  video?: Video | null;
}

export interface Bookmark {
  id: string;
  matchId: string;
  timestampSeconds: number;
  label: string;
}

export interface Clip {
  id: string;
  // Puede quedar en null: el partido de origen se borra a los 7 días (ver MatchRetentionService
  // en el backend), pero el clip en sí sigue existiendo — es un archivo independiente.
  matchId: string | null;
  title: string;
  startSeconds: number;
  endSeconds: number;
  status: 'PENDING' | 'READY' | 'FAILED';
  errorMessage?: string | null;
  createdAt?: string;
  match?: Match | null;
}

export interface PlaybackUrls {
  status: VideoStatus | 'PAYMENT_REQUIRED';
  manifestUrl: string | null;
  thumbnailsVttUrl: string | null;
  durationSeconds?: number;
  width?: number;
  height?: number;
  /** Solo cuando status === 'PAYMENT_REQUIRED' (ver VideosService.checkPaywall). */
  complexId?: string;
  priceArs?: number | null;
  passDays?: number | null;
}
