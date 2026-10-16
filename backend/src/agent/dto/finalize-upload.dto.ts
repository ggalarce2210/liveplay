import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsInt, IsNumber, IsOptional, IsString, Matches, Min, ValidateNested } from 'class-validator';

/**
 * Metadata de UN segmento HLS ya subido — mismos campos que escribe
 * `VideoProcessingService.runMatchVideoPipeline` en `videoSegments` para el pipeline legacy (ver
 * schema.ts), pero acá los calcula el agente del mini-PC (parseando la duración de cada
 * segmento del propio .m3u8 que generó)), no FFmpeg corriendo en este backend.
 */
class FinalizeSegmentDto {
  @IsInt()
  @Min(0)
  index: number;

  @IsNumber()
  startOffsetSeconds: number;

  @IsNumber()
  endOffsetSeconds: number;

  @IsNumber()
  durationSeconds: number;

  @IsString()
  @Matches(/^hls\/[A-Za-z0-9_.-]+\.ts$/, { message: 'relativePath de un segmento debe ser "hls/<archivo>.ts"' })
  relativePath: string;
}

/**
 * Lo que el agente del mini-PC manda DESPUÉS de haber subido con éxito, a las URLs de
 * `createUploadPlan`, todos los archivos de un partido ("Escenario B", ver backend/AGENTE.md).
 * Ver AgentService.finalizeDirectUpload para qué se hace con cada campo.
 */
export class FinalizeUploadDto {
  @IsString()
  @Matches(/^hls\/[A-Za-z0-9_.-]+\.m3u8$/)
  manifestRelativePath: string;

  @IsString()
  @Matches(/^thumbs\/[A-Za-z0-9_.-]+\.jpg$/)
  spriteRelativePath: string;

  @IsString()
  @Matches(/^thumbs\/[A-Za-z0-9_.-]+\.vtt$/)
  vttRelativePath: string;

  // El poster es "lindo tener", no crítico (mismo criterio que en el pipeline legacy, ver
  // comentario en runMatchVideoPipeline) — el mini-PC puede no haber podido generarlo.
  @IsOptional()
  @IsString()
  @Matches(/^thumbs\/[A-Za-z0-9_.-]+\.jpg$/)
  posterRelativePath?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => FinalizeSegmentDto)
  segments: FinalizeSegmentDto[];

  @IsNumber()
  durationSeconds: number;

  @IsOptional()
  @IsInt()
  width?: number;

  @IsOptional()
  @IsInt()
  height?: number;

  @IsOptional()
  @IsNumber()
  fps?: number;

  @IsNumber()
  sizeBytes: number;
}
