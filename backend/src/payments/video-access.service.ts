import { Injectable } from '@nestjs/common';
import { and, eq, gt } from 'drizzle-orm';
import { DbService } from '../db/db.service';
import { complexes, videoAccessPasses } from '../db/schema';

/**
 * El único chequeo que `VideosService` necesita para saber si hay que mostrar el video o el
 * paywall — deliberadamente separado de `MercadopagoService` (que vive en este mismo módulo):
 * esto es una simple lectura de DB (plata ya acreditada o no), no necesita tocar la API de
 * Mercado Pago para nada, así que `VideosModule` puede importar esto solo sin arrastrar el
 * cliente HTTP de Mercado Pago ni sus credenciales.
 */
@Injectable()
export class VideoAccessService {
  constructor(private dbService: DbService) {}
  private get db() {
    return this.dbService.db;
  }

  /** Config de cobro del complejo, tal como la ve el paywall (nunca expone tokens de MP). */
  async getPaywallConfig(complexId: string) {
    const complex = await this.db.query.complexes.findFirst({
      where: eq(complexes.id, complexId),
      columns: { chargesForVideoAccess: true, videoAccessPriceArs: true, videoAccessPassDays: true },
    });
    return {
      chargesForVideoAccess: complex?.chargesForVideoAccess ?? false,
      priceArs: complex?.videoAccessPriceArs ?? null,
      passDays: complex?.videoAccessPassDays ?? null,
    };
  }

  /** true si `userId` tiene HOY un pase vigente (pago acreditado y no vencido) para ese complejo. */
  async hasActivePass(complexId: string, userId: string): Promise<boolean> {
    const active = await this.db.query.videoAccessPasses.findFirst({
      where: and(
        eq(videoAccessPasses.complexId, complexId),
        eq(videoAccessPasses.userId, userId),
        eq(videoAccessPasses.status, 'APPROVED'),
        gt(videoAccessPasses.expiresAt, new Date()),
      ),
    });
    return !!active;
  }
}
