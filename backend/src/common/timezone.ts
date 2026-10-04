/**
 * Conversión entre "hora de pared" en el huso horario de un complejo (ej. "08:00" un
 * 2026-09-19 en America/Argentina/Buenos_Aires) y el instante UTC real que representa.
 *
 * Se agrega esto porque `MatchSchedulerService` y el filtro de horario del buscador
 * (`MatchesService.search`) generaban/leían horarios usando los métodos locales de `Date`
 * (`setHours`/`getHours`), que en Node.js son locales al huso horario DEL SERVIDOR, no al del
 * complejo. El server corre en UTC (Render, como la mayoría de los hosts), así que un turno
 * configurado como "08:00" terminaba guardado como 08:00 UTC (=05:00 en Argentina) en vez de
 * 11:00 UTC (que sí son las 08:00 en Argentina) — un desfasaje fijo de 3hs entre lo que el
 * cliente configura, lo que se guarda, y lo que se busca. No se agrega ninguna librería nueva:
 * alcanza con `Intl.DateTimeFormat`, que ya trae soporte de husos horarios con reglas de DST
 * (Argentina no tiene DST actualmente, pero esto no asume eso a mano).
 */

/** Offset del huso horario `timeZone`, en minutos, en el instante `date` (ej. -180 para ART). */
function getTimeZoneOffsetMinutes(date: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = dtf.formatToParts(date).reduce<Record<string, string>>((acc, p) => {
    acc[p.type] = p.value;
    return acc;
  }, {});
  // Interpretamos los mismos números de "hora de pared" que el huso horario mostraría para
  // `date`, pero como si fueran UTC — la diferencia contra `date` es el offset del huso.
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) === 24 ? 0 : Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return (asUtc - date.getTime()) / 60_000;
}

/**
 * Convierte una fecha+hora de pared ("YYYY-MM-DD", "HH:MM") en el huso horario indicado al
 * instante UTC (`Date`) que realmente representa.
 */
export function zonedTimeToUtc(dateStr: string, timeStr: string, timeZone: string): Date {
  const [year, month, day] = dateStr.split('-').map(Number);
  const [hour, minute] = timeStr.split(':').map(Number);
  // Primera aproximación: tratamos los números de pared como si ya fueran UTC.
  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  const offsetMinutes = getTimeZoneOffsetMinutes(utcGuess, timeZone);
  // Si el huso está detrás de UTC (offset negativo, ej. ART=-180), el instante real es más
  // tarde en UTC que la aproximación — restar un offset negativo lo suma.
  return new Date(utcGuess.getTime() - offsetMinutes * 60_000);
}

/** Formatea un instante como "HH:MM" en la hora de pared del huso horario indicado. */
export function formatInTimeZone(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date);
}

/**
 * Único huso horario que maneja este cliente hoy (todos sus complejos operan acá) — fallback
 * cuando `complex.timezone` no está cargado. Fuente única: antes `MatchSchedulerService`,
 * `MatchesService` y `frontend/src/lib/format.ts` tenían cada uno su propia copia de este mismo
 * string literal.
 */
export const DEFAULT_TIMEZONE = 'America/Argentina/Buenos_Aires';

/**
 * "Hoy" como fecha de calendario ("YYYY-MM-DD") en el huso horario indicado — NO en el huso del
 * servidor. Se usa `Intl.DateTimeFormat` con `en-CA` porque ese locale ya formatea en
 * `YYYY-MM-DD`.
 */
export function todayInTimeZone(timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(
    new Date(),
  );
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

// Las siguientes dos funciones solo hacen aritmética de CALENDARIO sobre un string "YYYY-MM-DD"
// (sumar/restar días o meses) — se anclan a mediodía UTC únicamente para evitar que un
// `setDate`/`setMonth` cruce un borde de horario de verano en el huso horario LOCAL DEL
// SERVIDOR y corra el día de calendario resultante; no representan ningún instante real ni
// dependen del huso horario del complejo (eso lo resuelve después `dayRangeUtc`/`zonedTimeToUtc`).
function toUtcNoon(dateStr: string): Date {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12));
}
function fromUtcNoon(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Suma (o resta, con `days` negativo) días de calendario a una fecha "YYYY-MM-DD". */
export function addDaysToDateStr(dateStr: string, days: number): string {
  const d = toUtcNoon(dateStr);
  d.setUTCDate(d.getUTCDate() + days);
  return fromUtcNoon(d);
}

/** Suma (o resta, con `months` negativo) meses de calendario a una fecha "YYYY-MM-DD". */
export function addMonthsToDateStr(dateStr: string, months: number): string {
  const d = toUtcNoon(dateStr);
  d.setUTCMonth(d.getUTCMonth() + months);
  return fromUtcNoon(d);
}

/**
 * Rango [inicio, fin) del día de calendario `dateStr` en el huso horario indicado, como
 * instantes UTC reales — pensado para filtrar `matches.startTime` (que sí es un instante UTC)
 * por "ese día tal como lo vive el complejo", no por el día de calendario DEL SERVIDOR. El techo
 * es EXCLUSIVO (`fin` = medianoche del día siguiente) para no depender de un "23:59:59.999" que
 * además nunca es exacto en husos horarios con fracciones de minuto raras.
 *
 * Este es el fix del bug real (2026-10-04): `DiscoveryService.matchesByCourt` y
 * `MatchesService.search` armaban "hoy"/"ayer"/"semana"/"mes" con `new Date()` +
 * `setHours(0,0,0,0)`, que corre en el huso horario DEL SERVIDOR (UTC en Render) — un turno de
 * las 21-23hs de Argentina (instante UTC correcto, ya con el fix de `zonedTimeToUtc` en el
 * generador de turnos) cae recién en el UTC del día SIGUIENTE, así que cualquier filtro de "hoy"
 * basado en el día UTC del servidor terminaba mostrando los turnos de las 21-23hs de AYER (su
 * instante UTC sí cae "hoy" en UTC) y escondiendo los de las 21-23hs de HOY (su instante UTC ya
 * es "mañana" en UTC) — exactamente lo que reportó el usuario viendo el buscador público.
 */
export function dayRangeUtc(dateStr: string, timeZone: string): { start: Date; end: Date } {
  const start = zonedTimeToUtc(dateStr, '00:00', timeZone);
  const end = zonedTimeToUtc(addDaysToDateStr(dateStr, 1), '00:00', timeZone);
  return { start, end };
}
