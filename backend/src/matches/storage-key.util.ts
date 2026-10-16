/**
 * Layout lógico de storage: complejo/cancha/año/mes/día/hora (§10) — invisible para el frontend.
 *
 * Extraído de un método privado de MatchesService a un util compartido para que AgentService
 * ("Escenario B" — subida directa a R2 desde el mini-PC, ver backend/AGENTE.md) pueda calcular
 * la MISMA key base para un partido sin duplicar esta lógica: si el layout cambia en el futuro,
 * hay un solo lugar para actualizar y los dos flujos (el pipeline legacy de FFmpeg-en-el-backend
 * y la subida directa) siguen escribiendo al mismo sitio que después lee StreamController.
 */
export function buildStorageBaseKey(match: { complexId: string; courtId: string; startTime: Date }): string {
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
