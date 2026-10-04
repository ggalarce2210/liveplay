import { BadRequestException, Injectable } from '@nestjs/common';
import { and, asc, eq, gte, lt, lte } from 'drizzle-orm';
import { DbService } from '../db/db.service';
import { matches } from '../db/schema';
import { DEFAULT_TIMEZONE, addDaysToDateStr, addMonthsToDateStr, dayRangeUtc, formatInTimeZone, todayInTimeZone } from '../common/timezone';

export interface PublicMatchesQuery {
  courtId: string;
  date?: string;
  dateFrom?: string;
  dateTo?: string;
  datePreset?: 'today' | 'yesterday' | 'week' | 'month';
  timeFrom?: string;
  timeTo?: string;
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

    // Mismo huso horario que usa el resto del cliente (ver DEFAULT_TIMEZONE) — "hoy"/"ayer" acá
    // significan el día de calendario tal como lo vive el complejo, no el día UTC del servidor
    // (ver el comentario largo en `dayRangeUtc`, que documenta el bug real que esto corrige).
    const today = todayInTimeZone(DEFAULT_TIMEZONE);
    if (query.date) {
      conditions.push(eq(matches.date, query.date));
    } else if (query.dateFrom || query.dateTo) {
      if (query.dateFrom) conditions.push(gte(matches.date, query.dateFrom));
      if (query.dateTo) conditions.push(lte(matches.date, query.dateTo));
    } else if (query.datePreset === 'today') {
      const { start, end } = dayRangeUtc(today, DEFAULT_TIMEZONE);
      conditions.push(gte(matches.startTime, start), lt(matches.startTime, end));
    } else if (query.datePreset === 'yesterday') {
      const { start, end } = dayRangeUtc(addDaysToDateStr(today, -1), DEFAULT_TIMEZONE);
      conditions.push(gte(matches.startTime, start), lt(matches.startTime, end));
    } else if (query.datePreset === 'week') {
      const { start } = dayRangeUtc(addDaysToDateStr(today, -7), DEFAULT_TIMEZONE);
      const { end } = dayRangeUtc(today, DEFAULT_TIMEZONE);
      conditions.push(gte(matches.startTime, start), lt(matches.startTime, end));
    } else if (query.datePreset === 'month') {
      const { start } = dayRangeUtc(addMonthsToDateStr(today, -1), DEFAULT_TIMEZONE);
      const { end } = dayRangeUtc(today, DEFAULT_TIMEZONE);
      conditions.push(gte(matches.startTime, start), lt(matches.startTime, end));
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

    // Mismo bug de huso horario que el de arriba (ver `dayRangeUtc`), en su variante de franja
    // horaria en vez de día completo: `getHours()`/`getMinutes()` devuelven la hora LOCAL AL
    // SERVIDOR, no la del complejo. Se formatea con el huso horario real (igual que ya hace
    // `MatchesService.search` para este mismo filtro) para no repetir el desfasaje de 3hs.
    if (query.timeFrom || query.timeTo) {
      result = result.filter((m) => {
        const t = formatInTimeZone(m.startTime, DEFAULT_TIMEZONE);
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
