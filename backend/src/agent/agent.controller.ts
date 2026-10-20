import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  Post,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Request } from 'express';
import { AgentAuthGuard } from './agent-auth.guard';
import { AgentService } from './agent.service';
import { MatchesService } from '../matches/matches.service';
import { CreateUploadPlanDto } from './dto/upload-plan.dto';
import { FinalizeUploadDto } from './dto/finalize-upload.dto';

/**
 * API que usa el agente local instalado en la red de cada complejo (ver backend/AGENTE.md) —
 * NO requiere login humano, se autentica con un token de máquina (ver AgentAuthGuard). A
 * propósito es un controller aparte de MatchesController: nunca queremos que un token de
 * agente filtrado pueda hacer nada más que "¿qué partidos de MI cancha faltan subir?" y
 * "subí este video para ESE partido de MI cancha".
 */
@UseGuards(AgentAuthGuard)
@Controller('agent')
export class AgentController {
  constructor(private agentService: AgentService, private matchesService: MatchesService) {}

  @Get('matches/pending')
  pending(@Req() req: Request, @Query('bufferMinutes') bufferMinutes?: string) {
    const camera = (req as any).agentCamera;
    const buffer = bufferMinutes ? parseInt(bufferMinutes, 10) : 120;
    return this.agentService.pendingMatches(camera.courtId, Number.isFinite(buffer) ? buffer : 120);
  }

  @Post('matches/:id/video')
  @UseInterceptors(FileInterceptor('file', { dest: '/tmp/ecp-uploads' }))
  async attachVideo(@Param('id') id: string, @Req() req: Request, @UploadedFile() file: Express.Multer.File) {
    const camera = (req as any).agentCamera;
    const match = await this.agentService.assertMatchBelongsToCourt(id, camera.courtId);
    if (!match) throw new NotFoundException('Ese partido no pertenece a la cancha de este agente');
    return this.matchesService.attachVideo(id, file.path);
  }

  /**
   * "Escenario B" (ver backend/AGENTE.md): el mini-PC ya corrió FFmpeg localmente y pide acá las
   * URLs firmadas para subir directo a storage los archivos resultantes, sin pasar por el
   * pipeline de `attachVideo`/`VideoProcessingService` de arriba. Ver AgentService.createUploadPlan.
   */
  @Post('matches/:id/upload-plan')
  createUploadPlan(@Param('id') id: string, @Req() req: Request, @Body() dto: CreateUploadPlanDto) {
    const camera = (req as any).agentCamera;
    return this.agentService.createUploadPlan(id, camera.courtId, dto);
  }

  /**
   * Llamado por el mini-PC después de haber subido con éxito todo lo que le dio `upload-plan`.
   * Ver AgentService.finalizeDirectUpload.
   */
  @Post('matches/:id/finalize')
  finalizeDirectUpload(@Param('id') id: string, @Req() req: Request, @Body() dto: FinalizeUploadDto) {
    const camera = (req as any).agentCamera;
    return this.agentService.finalizeDirectUpload(id, camera.courtId, dto);
  }

  /**
   * Llamado por el agente local cuando su chequeo de movimiento (ver backend/AGENTE.md,
   * "Chequeo de movimiento") no detecta actividad real en el horario del partido — ver
   * AgentService.markEmpty.
   */
  @Post('matches/:id/mark-empty')
  markEmpty(@Param('id') id: string, @Req() req: Request, @Body() dto: { reason?: string; mafd?: number }) {
    const camera = (req as any).agentCamera;
    return this.agentService.markEmpty(id, camera.courtId, dto);
  }
}
