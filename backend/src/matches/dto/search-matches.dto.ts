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

  @IsOptional()
  @IsString()
  timeFrom?: string; // "18:00"

  @IsOptional()
  @IsString()
  timeTo?: string; // "23:00"
}
