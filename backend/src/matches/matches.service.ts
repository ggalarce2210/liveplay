import { Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, gte, lte } from 'drizzle-orm';
import { DbService } from '../db/db.service';
import { matches, matchPlayers, teams, videos } from '../db/schema';
import { VideoProcessingService } from '../video-processing/video-processing.service';
import { SearchMatchesDto } from './dto/search-matches.dto';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { formatInTimeZone } from '../common/timezone';

const DEFAULT_TIMEZONE = 'America/Argentina/Buenos_Aires';

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

    // Antes esto acotaba la búsqueda de un PLAYER a solo los partidos donde alguien lo había
    // asignado a mano en `matchPlayers`. Desde que los partidos se generan solos por horario
    // de turno (ver MatchSchedulerService, 2026-09-19) nadie asigna jugadores nunca, así que
    // esa restricción dejaba la búsqueda vacía para siempre. Decisión del cliente: cualquier
    // jugador logueado puede buscar y ver cualquier turno grabado (mismo criterio que ya
    // aplicaba para SUPER_ADMIN/COMPLEX_ADMIN) — ver discusión en el chat del 2026-09-19.
    // Si en el futuro se quiere volver a acotar (ej. con un código por turno), es acá.

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

    // OJO timezone: `m.startTime` es un instante UTC; `Date.getHours()`/`getMinutes()` devuelven
    // la hora LOCAL AL SERVIDOR (UTC en producción), no la del complejo — comparar eso contra un
    // horario que el usuario tipeó pensando en la hora real de la cancha (ej. "08:00") quedaba
    // desalineado en 3hs contra lo que la UI le mostraba para ese mismo partido. Se formatea en
    // el huso horario del complejo (`m.complex.timezone`, con fallback al único huso que maneja
    // este cliente) para que coincida con lo que ve el usuario en pantalla.
    if (query.timeFrom || query.timeTo) {
      result = result.filter((m) => {
        const t = formatInTimeZone(m.startTime, m.complex?.timezone || DEFAULT_TIMEZONE);
        if (query.timeFrom && t < query.timeFrom) return false;
        if (query.timeTo && t > query.timeTo) return false;
        return true;
      });
    }

    // Decisión del cliente (2026-09-19, reunión con el club): el buscador es para revisar
    // partidos ya grabados, no para mostrar el calendario completo de turnos. Desde que los
    // turnos se generan solos por horario (ver MatchSchedulerService) la enorme mayoría de los
    // resultados eran turnos "Programado" sin video todavía — ruido que tapaba el partido que
    // el usuario realmente buscaba. Se filtran acá (después de los demás filtros, así no hay
    // que tocar la lógica de arriba): solo se devuelven partidos con un video ya asociado. Si
    // en el futuro se quiere un buscador de turnos disponibles para reservar, es un endpoint
    // aparte — no reutilizar este quitando el filtro.
    result = result.filter((m) => !!m.video);

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
    return match;
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
