import { Body, Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
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
