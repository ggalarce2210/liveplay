import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DbService } from '../db/db.service';
import { courts } from '../db/schema';

@Injectable()
export class CourtsService {
  constructor(private dbService: DbService) {}
  private get db() {
    return this.dbService.db;
  }

  listByComplex(complexId: string) {
    return this.db.query.courts.findMany({ where: eq(courts.complexId, complexId), with: { camera: true } });
  }

  get(id: string) {
    return this.db.query.courts.findFirst({ where: eq(courts.id, id), with: { camera: true, complex: true } });
  }

  async create(data: any) {
    const [created] = await this.db.insert(courts).values(data).returning();
    return created;
  }

  async update(id: string, data: any) {
    const [updated] = await this.db.update(courts).set({ ...data, updatedAt: new Date() }).where(eq(courts.id, id)).returning();
    return updated;
  }

  async remove(id: string) {
    const [deleted] = await this.db.delete(courts).where(eq(courts.id, id)).returning();
    return deleted;
  }
}
