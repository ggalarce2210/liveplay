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
  width?: number | null;
  height?: number | null;
  segments?: VideoSegment[];
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
  matchId: string;
  title: string;
  startSeconds: number;
  endSeconds: number;
  status: 'PENDING' | 'READY' | 'FAILED';
  errorMessage?: string | null;
  match?: Match;
}

export interface PlaybackUrls {
  status: VideoStatus;
  manifestUrl: string | null;
  thumbnailsVttUrl: string | null;
  durationSeconds?: number;
  width?: number;
  height?: number;
}
