import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsString, Matches, ValidateNested } from 'class-validator';

/**
 * "Escenario B" (ver backend/AGENTE.md): el agente del mini-PC ya corrió FFmpeg localmente y
 * sabe exactamente qué archivos generó — acá solo pide la ruta relativa de cada uno, ej.
 * "hls/master.m3u8", "hls/segment_00042.ts", "thumbs/sprite.jpg", "thumbs/thumbnails.vtt",
 * "thumbs/poster.jpg". El Content-Type de la URL firmada NUNCA se toma de lo que mande el
 * device (ver AgentService.createUploadPlan): se deriva server-side de la extensión, así que acá
 * solo validamos la FORMA de la ruta (carpeta conocida + extensión soportada) para no terminar
 * firmando una URL de subida para una key arbitraria fuera del layout esperado.
 */
export class UploadPlanFileDto {
  @IsString()
  @Matches(/^(hls|thumbs)\/[A-Za-z0-9_.-]+\.(m3u8|ts|jpg|jpeg|vtt)$/, {
    message: 'relativePath debe tener la forma "hls/<archivo>" o "thumbs/<archivo>", con una extensión soportada (.m3u8, .ts, .jpg, .jpeg, .vtt)',
  })
  relativePath: string;
}

export class CreateUploadPlanDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => UploadPlanFileDto)
  files: UploadPlanFileDto[];
}
