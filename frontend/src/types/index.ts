export type Role = 'SUPER_ADMIN' | 'COMPLEX_ADMIN' | 'PLAYER';
export type SportType = 'FUTBOL5' | 'PADEL';
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
}

export interface Court {
  id: string;
  name: string;
  sportType: SportType;
  status: string;
  complex?: Complex;
  camera?: Camera | null;
}

export interface Camera {
  id: string;
  name: string;
  type: string;
  status: 'ONLINE' | 'OFFLINE' | 'UNKNOWN';
  lastSeenAt?: string | null;
}

export interface Team {
  id: string;
  label: string;
  score?: number | null;
  setsWon?: number | null;
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
