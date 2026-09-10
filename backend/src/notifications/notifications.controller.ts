import { Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { DbService } from '../db/db.service';
import { notifications } from '../db/schema';

@UseGuards(JwtAuthGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private dbService: DbService) {}
  private get db() {
    return this.dbService.db;
  }

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.db.query.notifications.findMany({
      where: eq(notifications.userId, user.userId),
      orderBy: [desc(notifications.createdAt)],
      limit: 50,
    });
  }

  @Patch(':id/read')
  async markRead(@Param('id') id: string) {
    const [updated] = await this.db.update(notifications).set({ read: true }).where(eq(notifications.id, id)).returning();
    return updated;
  }
}
