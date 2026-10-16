import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';

/**
 * Todos los complejos de este cliente operan en este huso horario (`complexes.timezone` en el
 * backend por ahora siempre vale esto). Se usa como default para no tener que enchufar
 * `match.complex?.timezone` en cada lugar que muestra una hora — si en el futuro hay complejos
 * en otros husos, pasar el segundo argumento de `formatTime` con ese valor.
 *
 * Motivo del fix (2026-09-19): `format(new Date(...), 'HH:mm')` de date-fns usa el huso horario
 * del dispositivo que renderiza, no el del complejo. Como los `startTime` que llegan del backend
 * son instantes UTC correctos, mostrarlos con el huso del viewer daba una hora distinta a la del
 * horario real de la cancha para cualquiera fuera de Argentina (o con el reloj del navegador mal
 * configurado). `Intl.DateTimeFormat` con `timeZone` explícito muestra siempre la hora real de la
 * cancha, sin importar dónde esté mirando la app quien la usa.
 */
export const DEFAULT_TIMEZONE = 'America/Argentina/Buenos_Aires';

export function formatDate(dateStr: string): string {
  try {
    return format(parseISO(dateStr), 'dd/MM/yyyy');
  } catch {
    return dateStr;
  }
}

export function formatTime(isoDateTime: string, timeZone: string = DEFAULT_TIMEZONE): string {
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(
      new Date(isoDateTime),
    );
  } catch {
    return '';
  }
}

export function formatDuration(seconds?: number | null): string {
  if (!seconds || seconds <= 0) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}min`;
  return `${m}min`;
}

export function formatClock(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export { es };
