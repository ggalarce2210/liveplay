import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { and, eq, gte, lte } from 'drizzle-orm';
import { DbService } from '../db/db.service';
import { courts, matches } from '../db/schema';
import { zonedTimeToUtc } from '../common/timezone';

const DEFAULT_TIMEZONE = 'America/Argentina/Buenos_Aires';

/**
 * Forma esperada de `courts.operatingHours` (jsonb) cuando se usa para generar partidos
 * automáticamente por horario fijo de turnos, en vez de que alguien tenga que cargar cada
 * partido a mano (decisión tomada 2026-09-19: en la vida real de un club de pádel/fútbol 5
 * nadie "carga un partido" — la cancha simplemente tiene turnos fijos y hay que grabarlos
 * todos). Si `operatingHours` es null, la cancha no participa de la generación automática
 * (se puede seguir cargando partidos puntuales a mano vía `POST /matches`).
 *
 * Nota a futuro (pedido explícito del usuario, no implementado todavía): hoy se genera un
 * partido por CADA turno de la grilla, se haya jugado o no. Cuando el agente local pueda
 * detectar movimiento en el video, la idea es no generar (o descartar) los turnos sin
 * movimiento en vez de dejarlos como partidos vacíos para siempre.
 */
export interface CourtTurnSchedule {
  /** Días en que la cancha genera turnos. ISO: 1=lunes ... 7=domingo. */
  openDays: number[];
  /** Hora de inicio del primer turno del día, formato "HH:MM" (24hs). */
  turnStart: string;
  /**
   * Hora de inicio del ÚLTIMO turno del día (OJO: no es la hora de cierre) — ej. "23:00" si
   * el último turno arranca a las 23hs y, con turnos de 90 minutos, termina 00:30.
   */
  turnEnd: string;
  turnDurationMinutes: number;
}

/** Cuántos días hacia adelante se mantiene siempre generada la grilla de turnos. */
const HORIZON_DAYS = 14;

function hasValidSchedule(schedule: CourtTurnSchedule | null | undefined): schedule is CourtTurnSchedule {
  return !!schedule?.openDays?.length && !!schedule.turnStart && !!schedule.turnEnd && !!schedule.turnDurationMinutes;
}

@Injectable()
export class MatchSchedulerService {
  private readonly logger = new Logger(MatchSchedulerService.name);

  constructor(private dbService: DbService) {}
  private get db() {
    return this.dbService.db;
  }

  /**
   * Corre solo cada una hora para que la ventana de próximos `HORIZON_DAYS` días nunca se
   * quede corta a medida que pasan los días (sin esto, la grilla generada una sola vez se
   * iría "consumiendo" y nunca avanzaría hacia el futuro).
   */
  @Cron(CronExpression.EVERY_HOUR)
  async ensureUpcomingMatches() {
    const activeCourts = await this.db.query.courts.findMany({
      where: eq(courts.status, 'ACTIVE'),
      with: { complex: true },
    });
    let created = 0;
    for (const court of activeCourts) {
      const schedule = court.operatingHours as CourtTurnSchedule | null;
      if (!hasValidSchedule(schedule)) continue;
      const timezone = court.complex?.timezone || DEFAULT_TIMEZONE;
      created += await this.ensureUpcomingMatchesForCourt(court.id, court.complexId, court.sportType, schedule, timezone);
    }
    if (created > 0) this.logger.log(`Generados ${created} turnos automáticos.`);
    return created;
  }

  /**
   * Backfill inmediato para una cancha puntual. Se llama al crear la cancha o al editar su
   * horario, para que los próximos turnos aparezcan al toque en vez de tener que esperar a la
   * próxima vuelta del cron (hasta una hora).
   */
  async generateForCourt(courtId: string) {
    const court = await this.db.query.courts.findFirst({ where: eq(courts.id, courtId), with: { complex: true } });
    if (!court) return 0;
    const schedule = court.operatingHours as CourtTurnSchedule | null;
    if (!hasValidSchedule(schedule)) return 0;
    const timezone = court.complex?.timezone || DEFAULT_TIMEZONE;
    return this.ensureUpcomingMatchesForCourt(court.id, court.complexId, court.sportType, schedule, timezone);
  }

  private async ensureUpcomingMatchesForCourt(
    courtId: string,
    complexId: string,
    sportType: 'FUTBOL5' | 'PADEL',
    schedule: CourtTurnSchedule,
    timezone: string,
  ) {
    // Estas dos fechas solo se usan como límites de búsqueda ("¿hasta cuándo ya hay turnos
    // generados?"), no representan un horario de turno puntual — no hace falta que estén
    // ajustadas al minuto exacto del huso horario del complejo, alcanza con no quedar cortos.
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const horizonEnd = new Date(today);
    horizonEnd.setDate(horizonEnd.getDate() + HORIZON_DAYS);

    const slots = this.buildSlots(today, horizonEnd, schedule, timezone);
    if (slots.length === 0) return 0;

    // Se compara por `startTime` exacto para no duplicar turnos ya generados en una vuelta
    // anterior del cron (o un partido "real" que un admin haya cargado a mano justo en ese
    // horario).
    const existing = await this.db.query.matches.findMany({
      where: and(eq(matches.courtId, courtId), gte(matches.startTime, today), lte(matches.startTime, horizonEnd)),
      columns: { startTime: true },
    });
    const existingKeys = new Set(existing.map((m) => m.startTime.getTime()));

    const toInsert = slots
      .filter((s) => !existingKeys.has(s.startTime.getTime()))
      .map((s) => ({
        complexId,
        courtId,
        sportType,
        date: s.date,
        startTime: s.startTime,
        endTime: s.endTime,
        status: 'SCHEDULED' as const,
      }));

    if (toInsert.length === 0) return 0;
    await this.db.insert(matches).values(toInsert);
    return toInsert.length;
  }

  /**
   * Arma la grilla de turnos entre `from` y `to` (ambos límites de búsqueda, ver más arriba)
   * convirtiendo cada "hora de pared" (`turnStart`..`turnEnd` tal como los carga el cliente,
   * en la hora real del complejo) al instante UTC que corresponde según `timezone` — antes esto
   * se armaba con `Date.setHours`, que es local AL SERVIDOR (UTC en producción) y no al
   * complejo, generando turnos desfasados 3hs contra el horario real (ver `common/timezone.ts`).
   *
   * `date` (el día "de calendario" al que pertenece el turno, para agrupar/mostrar) se guarda
   * tal cual el día que se está iterando, no derivado del instante UTC ya convertido — así un
   * turno que arranca tarde en la noche sigue perteneciendo al día en que el cliente lo espera,
   * aunque su instante UTC caiga después de medianoche.
   */
  private buildSlots(from: Date, to: Date, schedule: CourtTurnSchedule, timezone: string) {
    const openDays = new Set(schedule.openDays);
    const [startH, startM] = schedule.turnStart.split(':').map(Number);
    const [endH, endM] = schedule.turnEnd.split(':').map(Number);
    const startMinutes = startH * 60 + startM;
    const lastTurnStartMinutes = endH * 60 + endM;
    const slots: { startTime: Date; endTime: Date; date: string }[] = [];

    for (let day = new Date(from); day < to; day.setDate(day.getDate() + 1)) {
      const isoWeekday = ((day.getDay() + 6) % 7) + 1; // JS: 0=domingo..6=sábado -> ISO: 1=lunes..7=domingo
      if (!openDays.has(isoWeekday)) continue;
      const dateStr = this.formatDate(day);
      for (let m = startMinutes; m <= lastTurnStartMinutes; m += schedule.turnDurationMinutes) {
        const hh = String(Math.floor(m / 60)).padStart(2, '0');
        const mm = String(m % 60).padStart(2, '0');
        const startTime = zonedTimeToUtc(dateStr, `${hh}:${mm}`, timezone);
        const endTime = new Date(startTime.getTime() + schedule.turnDurationMinutes * 60_000);
        slots.push({ startTime, endTime, date: dateStr });
      }
    }
    return slots;
  }

  private formatDate(d: Date): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
}
