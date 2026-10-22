import { IsIn, IsOptional, IsString } from 'class-validator';

export type DatePreset = 'today' | 'yesterday' | 'week' | 'month';

export class SearchMatchesDto {
  @IsOptional()
  @IsIn(['today', 'yesterday', 'week', 'month'])
  datePreset?: DatePreset;

  @IsOptional()
  @IsString()
  date?: string; // fecha específica YYYY-MM-DD

  @IsOptional()
  @IsString()
  dateFrom?: string; // rango YYYY-MM-DD

  @IsOptional()
  @IsString()
  dateTo?: string;

  @IsOptional()
  @IsIn(['FUTBOL5', 'PADEL'])
  sportType?: 'FUTBOL5' | 'PADEL';

  @IsOptional()
  @IsString()
  courtId?: string;

  @IsOptional()
  @IsString()
  complexId?: string;

  /**
   * Lista de ids de complejo separados por coma (2026-10-22, ver `userFavoriteComplexes` en
   * schema.ts): "Mis partidos" ahora busca en TODOS los complejos favoritos del jugador a la vez,
   * no en uno solo — si viene, tiene prioridad sobre `complexId` (que se deja para quien todavía
   * busque un único complejo, ej. el admin de cancha).
   */
  @IsOptional()
  @IsString()
  complexIds?: string;

  @IsOptional()
  @IsString()
  timeFrom?: string; // "18:00"

  @IsOptional()
  @IsString()
  timeTo?: string; // "23:00"
}
