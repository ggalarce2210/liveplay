import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { UsersService } from './users.service';

@UseGuards(JwtAuthGuard)
@Controller()
export class UsersController {
  constructor(private usersService: UsersService) {}

  @Patch('users/me')
  updateMe(@CurrentUser() user: AuthUser, @Body() body: any) {
    return this.usersService.updateProfile(user.userId, body);
  }

  // Canchas favoritas (2026-10-22) — ver comentario grande en UsersService.listFavoriteComplexes.
  @Get('users/me/favorite-complexes')
  listFavoriteComplexes(@CurrentUser() user: AuthUser) {
    return this.usersService.listFavoriteComplexes(user.userId);
  }

  @Post('users/me/favorite-complexes')
  addFavoriteComplex(@CurrentUser() user: AuthUser, @Body() body: { complexId: string }) {
    return this.usersService.addFavoriteComplex(user.userId, body.complexId);
  }

  @Delete('users/me/favorite-complexes/:complexId')
  removeFavoriteComplex(@CurrentUser() user: AuthUser, @Param('complexId') complexId: string) {
    return this.usersService.removeFavoriteComplex(user.userId, complexId);
  }

  @Get('players/:id/matches')
  getPlayerMatches(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    // Un jugador solo puede ver su propio historial; los admins pueden ver cualquiera (§25)
    const targetId = user.role === 'PLAYER' ? user.userId : id;
    return this.usersService.getMatchHistory(targetId);
  }

  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN' as any, 'COMPLEX_ADMIN' as any)
  @Get('users')
  list(@Query('role') role?: string) {
    return this.usersService.list(role);
  }
}
