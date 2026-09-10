import { BadRequestException, Injectable } from '@nestjs/common';
import { and, asc, eq, gte, lte } from 'drizzle-orm';
import { DbService } from '../db/db.service';
import { matches } from '../db/schema';

export interface PublicMatchesQuery {
  courtId: string;
  date?: string;
  dateFrom?: string;
  dateTo?: string;
  datePreset?: 'today' | 'yesterday' | 'week' | 'month';
  timeFrom?: string;
  timeTo?: string;
}

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

/**
 * Buscador PÚBLICO de partidos por cancha (§5.1) — a propósito separado de MatchesService.search:
 * ese buscador exige estar logueado y, si sos PLAYER, solo te devuelve tus propios partidos
 * (ver matches.service.ts). Este, en cambio, es la vidriera pública "deporte → ciudad → cancha
 * → fecha" para que cualquier visitante (logueado o no) vea qué partidos hay grabados en una
 * cancha antes de entrar — por eso nunca expone datos personales de los jugadores ni URLs de
 * video firmadas (eso sigue exigiendo login + ser parte del partido, vía /matches/:id).
 */
@Injectable()
export class DiscoveryService {
  constructor(private dbService: DbService) {}
  private get db() {
    return this.dbService.db;
  }

  async matchesByCourt(query: PublicMatchesQuery) {
    if (!query.courtId) throw new BadRequestException('Falta courtId');
    const conditions = [eq(matches.courtId, query.courtId)];

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
      where: and(...conditions),
      columns: { id: true, date: true, startTime: true, endTime: true, sportType: true, status: true },
      with: {
        teams: { columns: { id: true, label: true, score: true, setsWon: true } },
        video: { columns: { status: true } },
      },
      orderBy: [asc(matches.startTime)],
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

    return result.map((m) => ({
        id: m.id,
        date: m.date,
        startTime: m.startTime,
        endTime: m.endTime,
        sportType: m.sportType,
        status: m.status,
        teams: m.teams,
        hasVideo: m.video?.status === 'READY',
      }));
  }
}
