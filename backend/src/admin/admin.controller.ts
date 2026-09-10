import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/roles';
import { AdminService } from './admin.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN, Role.COMPLEX_ADMIN)
@Controller('admin')
export class AdminController {
  constructor(private service: AdminService) {}

  @Get('stats')
  stats(@Query('complexId') complexId?: string) {
    return this.service.getStats(complexId);
  }

  @Get('storage')
  storage() {
    return this.service.getStorage();
  }

  @UseGuards()
  @Roles(Role.SUPER_ADMIN)
  @Get('audit-logs')
  auditLogs() {
    return this.service.getAuditLogs();
  }
}
