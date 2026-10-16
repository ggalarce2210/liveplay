import { Module } from '@nestjs/common';
import { MercadopagoController } from './mercadopago.controller';
import { MercadopagoService } from './mercadopago.service';
import { VideoAccessService } from './video-access.service';

/**
 * Pago por ver videos (Mercado Pago, modelo marketplace) — ver el comentario grande en
 * MercadopagoService para el diseño completo. `VideoAccessService` se exporta aparte para que
 * `VideosModule` pueda chequear "¿este usuario ya pagó?" sin importar todo el cliente HTTP de
 * Mercado Pago (que necesita MP_CLIENT_ID/MP_CLIENT_SECRET configurados; el chequeo de acceso
 * no debería dejar de funcionar solo porque esas env vars todavía no están cargadas).
 */
@Module({
  controllers: [MercadopagoController],
  providers: [MercadopagoService, VideoAccessService],
  exports: [VideoAccessService],
})
export class PaymentsModule {}
