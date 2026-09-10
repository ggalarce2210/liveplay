import { Controller, Get, Query } from '@nestjs/common';
import { DiscoveryService, PublicMatchesQuery } from './discovery.service';

/** Endpoints públicos (sin JWT) para el buscador "deporte → ciudad → cancha → fecha" (§5.1). */
@Controller('discovery')
export class DiscoveryController {
  constructor(private service: DiscoveryService) {}

  @Get('matches')
  matches(@Query() query: PublicMatchesQuery) {
    return this.service.matchesByCourt(query);
  }
}
