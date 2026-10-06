import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { and, eq, gte, inArray, lte } from 'drizzle-orm';
import { DbService } from '../db/db.service';
import { courts, matches } from '../db/schema';
import { DEFAULT_TIMEZONE, addDaysToDateStr, todayInTimeZone, zonedTimeToUtc } from '../common/timezone';

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
    let pruned = 0;
    for (const court of activeCourts) {
      const schedule = court.operatingHours as CourtTurnSchedule | null;
      if (!hasValidSchedule(schedule)) continue;
      const timezone = court.complex?.timezone || DEFAULT_TIMEZONE;
      // Poda primero los turnos sin video que un horario viejo (ya reemplazado) dejó
      // huérfanos, y recién después genera los que falten para el horario vigente -- mismo
      // orden que ya usa CourtsService.update(). Se agregó acá (2026-10-05) porque un caso
      // real en "Los Pinos" mostró que podar solo al guardar el horario no alcanza: 2 turnos
      // sobrantes de un cambio de horario anterior quedaron sin podar y recién se notaron
      // días después, cuando el agente local (caído un rato por el incidente del disco
      // lleno) los encontró "pendientes" y les subió video real de una franja horaria vacía.
      // Corriendo también acá, cualquier sobrante de este tipo se limpia solo en la próxima
      // vuelta del cron (como mucho 1 hora), sin depender de que alguien vuelva a guardar el
      // horario de la cancha a mano.
      pruned += await this.pruneStaleSlots(court.id);
      created += await this.ensureUpcomingMatchesForCourt(court.id, court.complexId, court.sportType, schedule, timezone);
    }
    if (created > 0) this.logger.log(`Generados ${created} turnos automáticos.`);
    if (pruned > 0) this.logger.log(`Podados ${pruned} turnos sin video que quedaron fuera de un horario desactualizado.`);
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

  /**
   * Poda los turnos sin video que quedaron huérfanos al cambiar el horario de una cancha
   * (bug real reportado 2026-10-04: el usuario reconfiguró "Los Pinos" para que arranque a las
   * 13hs, pero 5 turnos ya generados con el horario viejo —8,9,10,11,12hs de ese mismo día—
   * seguían apareciendo en el buscador, porque `ensureUpcomingMatchesForCourt` solo AGREGA los
   * turnos que faltan según el horario vigente, nunca borra los que dejaron de corresponder a
   * uno viejo). Se llama solo al guardar un horario nuevo desde `CourtsService.update()`, no en
   * cada vuelta del cron horario — así el radio de acción queda acotado al momento exacto en
   * que el admin cambia el horario, y no a una limpieza continua que podría interferir con un
   * partido puntual cargado a mano fuera de grilla.
   *
   * Nunca se toca un turno que ya tiene un video asociado (aunque ya no entre en el horario
   * nuevo) ni uno que no esté en estado `SCHEDULED` — solo se borran placeholders vacíos que
   * el propio generador automático creó y que el horario actual ya no contempla.
   */
  async pruneStaleSlots(courtId: string) {
    const court = await this.db.query.courts.findFirst({ where: eq(courts.id, courtId), with: { complex: true } });
    if (!court) return 0;
    const schedule = court.operatingHours as CourtTurnSchedule | null;
    // Sin un horario válido para comparar, no hay forma de saber qué turno "ya no corresponde"
    // — no se borra nada (evita un vaciado accidental si se guarda operatingHours incompleto).
    if (!hasValidSchedule(schedule)) return 0;
    const timezone = court.complex?.timezone || DEFAULT_TIMEZONE;

    const { today, horizonEnd } = this.horizonRange(timezone);

    const validKeys = new Set(this.buildSlots(today, horizonEnd, schedule, timezone).map((s) => s.startTime.getTime()));

    const candidates = await this.db.query.matches.findMany({
      where: and(
        eq(matches.courtId, courtId),
        eq(matches.status, 'SCHEDULED'),
        gte(matches.startTime, today),
        lte(matches.startTime, horizonEnd),
      ),
      columns: { id: true, startTime: true },
      with: { video: { columns: { id: true } } },
    });

    const staleIds = candidates.filter((m) => !m.video && !validKeys.has(m.startTime.getTime())).map((m) => m.id);
    if (staleIds.length === 0) return 0;

    await this.db.delete(matches).where(inArray(matches.id, staleIds));
    this.logger.log(`Podados ${staleIds.length} turnos sin video que quedaron fuera del horario actualizado de la cancha ${courtId}.`);
    return staleIds.length;
  }

  private async ensureUpcomingMatchesForCourt(
    courtId: string,
    complexId: string,
    sportType: 'FUTBOL5' | 'PADEL',
    schedule: CourtTurnSchedule,
    timezone: string,
  ) {
    // Estas dos fechas solo se usan como límites de búsqueda ("¿hasta cuándo ya hay turnos
    // generados?"), no representan un horario de turno puntual, pero el PISO sí tiene que ser
    // "hoy" en el huso horario del complejo (ver `horizonRange` / el bug real de 2026-10-05 más
    // abajo) — alcanza con no quedar cortos del lado del techo.
    const { today, horizonEnd } = this.horizonRange(timezone);

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
   * Piso y techo ("hoy" y "hoy + HORIZON_DAYS") de la ventana en la que se generan/podan turnos,
   * como instantes UTC reales anclados a la MEDIANOCHE DEL COMPLEJO (no del servidor).
   *
   * Quinta vuelta (2026-10-05, mas tarde todavia): este metodo reemplaza a un `new Date();
   * setHours(0,0,0,0)` que quedo sin arreglar ADENTRO de este mismo archivo, pese a que
   * `common/timezone.ts` ya documenta este bug exacto (ver el comentario largo de
   * `dayRangeUtc`) y ya se habia corregido en `DiscoveryService`/`MatchesService.search`. El
   * sintoma real en "Los Pinos": a las 21:46 ART del 2026-10-05 faltaban los turnos de
   * 21/22/23hs de ESE MISMO dia, y ni el cron horario ni volver a guardar el horario de la
   * cancha a mano los generaba. Motivo: en ese momento el reloj UTC del servidor YA es
   * 2026-10-06 (ART = UTC-3, asi que a las 21hs ART el dia UTC ya cambio), asi que `new Date()`
   * sin huso horario daba "hoy = 2026-10-06" - la iteracion de `buildSlots` arrancaba
   * directamente en manana (en terminos ART) y nunca volvia a generar nada para el
   * "2026-10-05" que ART todavia estaba viviendo. Con `todayInTimeZone(timezone)` el piso queda
   * anclado al dia de calendario QUE EL COMPLEJO esta viviendo en ese instante, sin importar que
   * tan lejos ya este el reloj UTC del servidor.
   */
  private horizonRange(timezone: string): { today: Date; horizonEnd: Date } {
    const todayStr = todayInTimeZone(timezone);
    return {
      today: zonedTimeToUtc(todayStr, '00:00', timezone),
      horizonEnd: zonedTimeToUtc(addDaysToDateStr(todayStr, HORIZON_DAYS), '00:00', timezone),
    };
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
