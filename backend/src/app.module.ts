import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';

import { DbModule } from './db/db.module';
import { StorageModule } from './storage/storage.module';
import { StreamController } from './storage/stream.controller';
import { VideoProcessingModule } from './video-processing/video-processing.module';

import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { ComplexesModule } from './complexes/complexes.module';
import { CourtsModule } from './courts/courts.module';
import { DiscoveryModule } from './discovery/discovery.module';
import { CamerasModule } from './cameras/cameras.module';
import { MatchesModule } from './matches/matches.module';
import { VideosModule } from './videos/videos.module';
import { BookmarksModule } from './bookmarks/bookmarks.module';
import { ClipsModule } from './clips/clips.module';
import { ShareModule } from './share/share.module';
import { NotificationsModule } from './notifications/notifications.module';
import { AdminModule } from './admin/admin.module';
import { AuditLogInterceptor } from './common/interceptors/audit-log.interceptor';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    DbModule,
    StorageModule,
    VideoProcessingModule,

    AuthModule,
    UsersModule,
    ComplexesModule,
    CourtsModule,
    DiscoveryModule,
    CamerasModule,
    MatchesModule,
    VideosModule,
    BookmarksModule,
    ClipsModule,
    ShareModule,
    NotificationsModule,
    AdminModule,
  ],
  controllers: [StreamController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_INTERCEPTOR, useClass: AuditLogInterceptor },
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false }),
    },
  ],
})
export class AppModule {}
