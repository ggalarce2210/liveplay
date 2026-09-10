import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, gte, inArray, lte } from 'drizzle-orm';
import { DbService } from '../db/db.service';
import { matches, matchPlayers, teams, videos } from '../db/schema';
import { VideoProcessingService } from '../video-processing/video-processing.service';
import { SearchMatchesDto } from './dto/search-matches.dto';
import { AuthUser } from '../common/decorators/current-user.decorator';

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function endOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

@Injectable()
export class MatchesService {
  constructor(private dbService: DbService, private videoProcessing: VideoProcessingService) {}
  private get db() {
    return this.dbService.db;
  }

  /**
   * Buscador avanzado (§5). Combina filtros indexados (fecha/deporte/cancha/complejo) en la
   * consulta SQL, y el filtro de franja horaria (hora del día, independiente de la fecha) se
   * aplica en memoria sobre el resultado ya acotado — a la escala de un complejo esto es
   * instantáneo; para miles de complejos en simultáneo se migraría a un índice funcional
   * (EXTRACT(HOUR FROM start_time)) o a Elasticsearch/OpenSearch (ver §27 en ARCHITECTURE.md).
   */
  async search(query: SearchMatchesDto, requester: AuthUser) {
    const conditions = [] as any[];

    if (requester.role === 'PLAYER') {
      const rows = await this.db.query.matchPlayers.findMany({ where: eq(matchPlayers.userId, requester.userId), columns: { matchId: true } });
      const matchIds = rows.map((r) => r.matchId);
      if (matchIds.length === 0) return [];
      conditions.push(inArray(matches.id, matchIds));
    }

    if (query.complexId) conditions.push(eq(matches.complexId, query.complexId));
    if (query.courtId) conditions.push(eq(matches.courtId, query.courtId));
    if (query.sportType) conditions.push(eq(matches.sportType, query.sportType));

    const now = new Date();
    if (query.date) {
      conditions.push(eq(matches.date, query.date));
    } else if (query.dateFrom || query.dateTo) {
      if (query.dateFrom) conditions.push(gte(matches.date, query.dateFrom));
      if (query.dateTo) conditions.push(lte(matches.date, query.dateTo));
    } else if (query.datePreset === 'today') {
      conditions.push(gte(matches.startTime, startOfDay(now)), lte(matches.startTime, endOfDay(now)));
    } else if (query.datePreset === 'yesterday') {
      const y = new Date(now);
      y.setDate(y.getDate() - 1);
      conditions.push(gte(matches.startTime, startOfDay(y)), lte(matches.startTime, endOfDay(y)));
    } else if (query.datePreset === 'week') {
      const weekAgo = new Date(now);
      weekAgo.setDate(weekAgo.getDate() - 7);
      conditions.push(gte(matches.startTime, startOfDay(weekAgo)), lte(matches.startTime, endOfDay(now)));
    } else if (query.datePreset === 'month') {
      const monthAgo = new Date(now);
      monthAgo.setMonth(monthAgo.getMonth() - 1);
      conditions.push(gte(matches.startTime, startOfDay(monthAgo)), lte(matches.startTime, endOfDay(now)));
    }

    let result = await this.db.query.matches.findMany({
      where: conditions.length ? and(...conditions) : undefined,
      with: {
        court: true,
        complex: true,
        video: true,
        teams: true,
        players: { with: { user: true } },
      },
      orderBy: [desc(matches.startTime)],
    });

    if (query.timeFrom || query.timeTo) {
      result = result.filter((m) => {
        const hh = String(m.startTime.getHours()).padStart(2, '0');
        const mm = String(m.startTime.getMinutes()).padStart(2, '0');
        const t = `${hh}:${mm}`;
        if (query.timeFrom && t < query.timeFrom) return false;
        if (query.timeTo && t > query.timeTo) return false;
        return true;
      });
    }

    return result;
  }

  async get(id: string, requester: AuthUser) {
    const match = await this.db.query.matches.findFirst({
      where: eq(matches.id, id),
      with: {
        court: { with: { complex: true } },
        complex: true,
        video: { with: { segments: { orderBy: (s, { asc }) => [asc(s.index)] } } },
        teams: true,
        players: { with: { user: true } },
        events: { orderBy: (e, { asc }) => [asc(e.timestampSeconds)] },
      },
    });
    if (!match) throw new NotFoundException('Partido no encontrado');
    this.assertCanAccess(match, requester);
    return match;
  }

  /** Un jugador solo puede acceder a los partidos donde figura como jugador (§25). */
  private assertCanAccess(match: { players: { userId: string | null }[] }, requester: AuthUser) {
    if (requester.role === 'PLAYER') {
      const isPlayer = match.players.some((p) => p.userId === requester.userId);
      if (!isPlayer) throw new ForbiddenException('No tenés acceso a este partido');
    }
  }

  async create(data: any) {
    return this.db.transaction(async (tx) => {
      const [match] = await tx
        .insert(matches)
        .values({
          complexId: data.complexId,
          courtId: data.courtId,
          sportType: data.sportType,
          date: data.date,
          startTime: new Date(data.startTime),
          endTime: data.endTime ? new Date(data.endTime) : null,
          status: 'SCHEDULED',
        })
        .returning();
      if (data.teams?.length) {
        await tx.insert(teams).values(data.teams.map((t: any) => ({ ...t, matchId: match.id })));
      }
      return tx.query.matches.findFirst({ where: eq(matches.id, match.id), with: { teams: true } });
    });
  }

  async update(id: string, data: any) {
    const [updated] = await this.db.update(matches).set({ ...data, updatedAt: new Date() }).where(eq(matches.id, id)).returning();
    return updated;
  }

  async remove(id: string) {
    const [deleted] = await this.db.delete(matches).where(eq(matches.id, id)).returning();
    return deleted;
  }

  async addPlayers(matchId: string, players: { userId?: string; guestName?: string; teamId?: string }[]) {
    if (players.length) {
      await this.db.insert(matchPlayers).values(players.map((p) => ({ matchId, ...p })));
    }
    return this.db.query.matchPlayers.findMany({ where: eq(matchPlayers.matchId, matchId), with: { user: true, team: true } });
  }

  /**
   * Asocia un video subido (o llegado desde el NVR) a un partido y dispara el pipeline de
   * procesamiento (FFmpeg -> HLS -> thumbnails) de forma asíncrona (§10, §28).
   */
  async attachVideo(matchId: string, sourceFilePath: string) {
    const match = await this.db.query.matches.findFirst({ where: eq(matches.id, matchId) });
    if (!match) throw new NotFoundException('Partido no encontrado');
    const storageBaseKey = this.buildStorageBaseKey(match);

    const existing = await this.db.query.videos.findFirst({ where: eq(videos.matchId, matchId) });
    let video;
    if (existing) {
      [video] = await this.db.update(videos).set({ storageBaseKey, status: 'PENDING' }).where(eq(videos.id, existing.id)).returning();
    } else {
      [video] = await this.db.insert(videos).values({ matchId, storageBaseKey, status: 'PENDING' }).returning();
    }
    await this.videoProcessing.enqueueProcessMatchVideo(video.id, sourceFilePath);
    return video;
  }

  /** Layout lógico de storage: complejo/cancha/año/mes/día/hora (§10) — invisible para el frontend. */
  private buildStorageBaseKey(match: { complexId: string; courtId: string; startTime: Date }): string {
    const d = match.startTime;
    const pad = (n: number) => String(n).padStart(2, '0');
    return [
      `complex-${match.complexId}`,
      `court-${match.courtId}`,
      d.getFullYear(),
      pad(d.getMonth() + 1),
      pad(d.getDate()),
      `${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`,
    ].join('/');
  }
}
