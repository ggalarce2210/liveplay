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
