import { CallHandler, ExecutionContext, Injectable, NestInterceptor, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, tap } from 'rxjs';
import { DbService } from '../../db/db.service';
import { auditLogs } from '../../db/schema';

/**
 * Registra en AuditLog las acciones sensibles (login, reproducciones, clips, eliminaciones,
 * cambios administrativos). Se activa marcando el handler con @Audit('ACTION_NAME', 'Entity').
 */
export const AUDIT_KEY = 'audit_action';
export const Audit = (action: string, entity?: string) => SetMetadata(AUDIT_KEY, { action, entity });

@Injectable()
export class AuditLogInterceptor implements NestInterceptor {
  constructor(private db: DbService, private reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const meta = this.reflector.getAllAndOverride<{ action: string; entity?: string }>(AUDIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const request = context.switchToHttp().getRequest();

    return next.handle().pipe(
      tap((result) => {
        if (!meta) return;
        const userId = request.user?.userId ?? null;
        const entityId = result?.id ?? request.params?.id ?? null;
        this.db.db
          .insert(auditLogs)
          .values({
            userId,
            action: meta.action,
            entity: meta.entity,
            entityId,
            ipAddress: request.ip,
            userAgent: request.headers?.['user-agent'],
          })
          .catch(() => void 0); // la auditoría nunca debe romper la request principal
      }),
    );
  }
}
