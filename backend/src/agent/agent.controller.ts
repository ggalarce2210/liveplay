import {
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
}
