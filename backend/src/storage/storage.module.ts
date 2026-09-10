import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as path from 'path';
import { StorageDriver } from './storage.types';
import { LocalDiskStorageDriver } from './local-disk.driver';
import { S3StorageDriver } from './s3.driver';

export const STORAGE_DRIVER = 'STORAGE_DRIVER';

@Global()
@Module({
  providers: [
    {
      provide: STORAGE_DRIVER,
      inject: [ConfigService],
      useFactory: (config: ConfigService): StorageDriver => {
        const provider = config.get<string>('STORAGE_PROVIDER', 'LOCAL');
        if (provider === 'S3') {
          return new S3StorageDriver(
            config.get<string>('S3_BUCKET'),
            config.get<string>('S3_ENDPOINT'),
            config.get<string>('S3_REGION', 'us-east-1'),
            config.get<string>('S3_ACCESS_KEY'),
            config.get<string>('S3_SECRET_KEY'),
          );
        }
        const rootDir = config.get<string>('LOCAL_STORAGE_ROOT', path.join(process.cwd(), '..', 'storage-data'));
        const secret = config.get<string>('VIDEO_URL_SIGNING_SECRET', 'dev-secret-change-me');
        const publicBaseUrl = config.get<string>('API_PUBLIC_URL', 'http://localhost:3001');
        return new LocalDiskStorageDriver(rootDir, secret, publicBaseUrl);
      },
    },
  ],
  exports: [STORAGE_DRIVER],
})
export class StorageModule {}
