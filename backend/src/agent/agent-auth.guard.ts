import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import * as crypto from 'crypto';
import { eq } from 'drizzle-orm';
import { DbService } from '../db/db.service';
import { cameras } from '../db/schema';

/**
 * Autenticación de máquina para el agente local (ver backend/AGENTE.md): no es un usuario
 * humano con JWT, es un proceso corriendo en la red del complejo. Se identifica con un token
 * largo en el header `X-Agent-Key`, emitido una sola vez por `POST /cameras/:id/agent-token`
 * (§25 — nunca se guarda en texto plano, solo su hash sha256, igual que una contraseña).
 *
 * Si es válido, deja la cámara autenticada en `req.agentCamera` para que el controller pueda
 * chequear que el partido sobre el que se quiere operar pertenece a la cancha de ESA cámara —
 * un token filtrado de una cancha nunca debería poder tocar partidos de otra.
 */
@Injectable()
export class AgentAuthGuard implements CanActivate {
  constructor(private dbService: DbService) {}
  private get db() {
    return this.dbService.db;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const key = req.headers['x-agent-key'];
    if (!key || typeof key !== 'string') {
      throw new UnauthorizedException('Falta el header X-Agent-Key');
    }

    const keyHash = crypto.createHash('sha256').update(key).digest('hex');
    const camera = await this.db.query.cameras.findFirst({
      where: eq(cameras.agentKeyHash, keyHash),
      with: { court: true },
    });
    if (!camera) throw new UnauthorizedException('Token de agente inválido');

    req.agentCamera = camera;
    return true;
  }
}
