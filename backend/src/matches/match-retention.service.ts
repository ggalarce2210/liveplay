import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { inArray, lt } from 'drizzle-orm';
import { DbService } from '../db/db.service';
import { matches } from '../db/schema';
import { STORAGE_DRIVER } from '../storage/storage.module';
import { StorageDriver } from '../storage/storage.types';

/**
 * Cuántos días se conserva un partido COMPLETO (video + registro) antes de borrarlo de verdad,
 * para no llenar el storage del servidor (pedido explícito del usuario 2026-10-05: "los
 * partidos enteros tienen que estar disponibles 7 dias... luego del 7mo dia se tienen que
 * borrar para no llenar los 5tb del servidor"). Mismo número que `MATCH_AVAILABILITY_DAYS` en
 * `matches.service.ts` — ahí ese límite solo OCULTA el partido del buscador, nunca borra nada;
 * este servicio es el que hace el borrado real. Si alguna vez se quiere desacoplar ambos
 * números (ej. ocultar a los 7 días pero borrar recién a los 14), hay que separarlos ahí.
 */
const MATCH_RETENTION_DAYS = 7;

/**
 * Borra partidos COMPLETOS (no solo el video) pasados los `MATCH_RETENTION_DAYS` días — decisión
 * explícita del usuario (ver AskUserQuestion del 2026-10-05): se eligió borrar el registro entero
 * en vez de dejarlo como "historial sin video", para mantener la base simple.
 *
 * Los clips ya generados a partir de esos partidos NO se tocan: son archivos independientes en
 * storage (`clips.storageKey`, generados por FFmpeg sin tocar el original) y, desde este mismo
 * cambio, `clips.matchId` pasa a ser nullable con `onDelete: 'set null'` (antes `cascade`) — así
 * que un clip sobrevive al borrado de su partido de origen, con `matchId` en null, consistente
 * con la regla ya existente de que los clips no vencen (ver `MatchesService`/sección "4 fixes
 * pre-lanzamiento" del resumen del proyecto). Ver migración 0006_clips_match_id_nullable.sql.
 */
@Injectable()
export class MatchRetentionService {
  private readonly logger = new Logger(MatchRetentionService.name);

  constructor(
    private dbService: DbService,
    @Inject(STORAGE_DRIVER) private storage: StorageDriver,
  ) {}
  private get db() {
    return this.dbService.db;
  }

  /**
   * Corre una vez por día, de madrugada (hora servidor), para no competir con el pico de uso.
   * Devuelve la cantidad de partidos borrados (0 si no había ninguno vencido) — pensado para
   * poder disparar el método a mano en un test o desde un endpoint de admin más adelante, igual
   * que ya se hace con `MatchSchedulerService.generateForCourt`.
   */
  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async purgeExpiredMatches() {
    const cutoff = new Date(Date.now() - MATCH_RETENTION_DAYS * 24 * 60 * 60 * 1000);

    const expired = await this.db.query.matches.findMany({
      where: lt(matches.startTime, cutoff),
      columns: { id: true, startTime: true },
      with: { video: { columns: { id: true, storageBaseKey: true, sizeBytes: true } } },
    });
    if (expired.length === 0) return 0;

    let bytesFreed = 0;
    const failedStorageIds = new Set<string>();
    for (const match of expired) {
      const video = match.video;
      if (!video) continue; // partido sin video (nunca se grabó, o falló antes de subir) — nada que borrar del storage, se puede borrar igual
      try {
        // Un solo `deletePrefix` sobre la carpeta base del video se lleva puesto todo lo que
        // tenga adentro (manifest HLS, segmentos .ts, poster, sprite/vtt de miniaturas) sin
        // tener que enumerar cada key a mano — más simple y no deja nada huérfano bajo esa
        // carpeta aunque se haya generado algo que esta función no conozca explícitamente.
        await this.storage.deletePrefix(video.storageBaseKey);
        bytesFreed += video.sizeBytes ?? 0;
      } catch (err) {
        // Si el storage falla, preferimos NO borrar el registro del partido todavía (mejor
        // reintentar mañana que perder la referencia a un video que puede haber quedado a
        // medio borrar) — se excluye este partido puntual del DELETE de abajo y se loguea
        // para revisar a mano.
        this.logger.warn(`No se pudo borrar el storage del partido ${match.id} (se reintenta mañana): ${err}`);
        failedStorageIds.add(match.id);
      }
    }

    // El DELETE de `matches` se lleva en cascada: teams, matchPlayers, events, bookmarks,
    // videos (y sus videoSegments, que cascadean desde videos) — ver schema.ts. Los `clips` NO
    // se borran (onDelete 'set null' desde este mismo cambio), y los `shareLinks` con
    // `matchId` apuntando a este partido sí se borran (cascade, sin implicancia de storage).
    const deletableIds = expired.filter((m) => !failedStorageIds.has(m.id)).map((m) => m.id);
    if (deletableIds.length === 0) return 0;
    await this.db.delete(matches).where(inArray(matches.id, deletableIds));

    this.logger.log(
      `Borrados ${deletableIds.length} partidos de más de ${MATCH_RETENTION_DAYS} días (~${Math.round(bytesFreed / 1_000_000)} MB liberados de storage).`,
    );
    return deletableIds.length;
  }
}
