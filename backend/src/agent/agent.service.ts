import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DbService } from '../db/db.service';
import { matches } from '../db/schema';

@Injectable()
export class AgentService {
  constructor(private dbService: DbService) {}
  private get db() {
    return this.dbService.db;
  }

  /**
   * Partidos de ESTA cancha (la de la cámara autenticada) que ya deberían haber terminado y
   * todavía no tienen un video listo — candidatos para que el agente local le pida a la cámara
   * (Dahua u otra) la grabación de esa ventana horaria y la suba.
   *
   * "Terminado" se decide así: si el partido tiene `endTime` cargado, alcanza con que ya haya
   * pasado; si no (lo más común: hoy `endTime` casi nunca se carga), asumimos que terminó
   * `bufferMinutes` después de `startTime` — el agente puede ajustar ese margen según la
   * duración típica de un turno en esa cancha.
   */
  async pendingMatches(courtId: string, bufferMinutes: number) {
    const now = new Date();
    const assumedEndCutoff = new Date(now.getTime() - bufferMinutes * 60_000);

    // Se trae todo lo de esta cancha y se filtra en memoria: a la escala de UNA cancha (decenas
    // de partidos activos, no miles) es más simple y más claro que armar en Drizzle un
    // `endTime pasado O (sin endTime Y startTime + buffer pasado)` con `or`/`and` anidados.
    const candidates = await this.db.query.matches.findMany({
      where: eq(matches.courtId, courtId),
      with: { video: true, teams: true },
      orderBy: (m, { asc }) => [asc(m.startTime)],
    });

    const ended = candidates.filter((m) => (m.endTime ? m.endTime <= now : m.startTime <= assumedEndCutoff));

    return ended
      .filter((m) => !m.video || m.video.status === 'FAILED')
      .map((m) => ({
        id: m.id,
        date: m.date,
        startTime: m.startTime,
        endTime: m.endTime,
        sportType: m.sportType,
        teams: m.teams.map((t) => t.label),
        videoStatus: m.video?.status ?? null,
      }));
  }

  async assertMatchBelongsToCourt(matchId: string, courtId: string) {
    const match = await this.db.query.matches.findFirst({ where: eq(matches.id, matchId) });
    return match && match.courtId === courtId ? match : null;
  }
}
