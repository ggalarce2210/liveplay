import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from './schema';

@Injectable()
export class DbService implements OnModuleInit, OnModuleDestroy {
  private pool: Pool;
  public db: NodePgDatabase<typeof schema>;

  constructor(private config: ConfigService) {
    this.pool = new Pool({ connectionString: this.config.get<string>('DATABASE_URL') });
    this.db = drizzle(this.pool, { schema });
  }

  async onModuleInit() {
    await this.pool.query('SELECT 1');
  }

  async onModuleDestroy() {
    await this.pool.end();
  }
}
