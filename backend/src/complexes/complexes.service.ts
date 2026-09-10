import { Injectable } from '@nestjs/common';
import { eq, asc } from 'drizzle-orm';
import { DbService } from '../db/db.service';
import { complexes, subscriptions } from '../db/schema';

@Injectable()
export class ComplexesService {
  constructor(private dbService: DbService) {}
  private get db() {
    return this.dbService.db;
  }

  list() {
    return this.db.query.complexes.findMany({
      with: { courts: true, subscription: true },
      orderBy: [asc(complexes.name)],
    });
  }

  get(id: string) {
    return this.db.query.complexes.findFirst({
      where: eq(complexes.id, id),
      with: { courts: { with: { camera: true } }, subscription: true },
    });
  }

  async create(data: { name: string; address?: string; timezone?: string; openingHours?: any }) {
    return this.db.transaction(async (tx) => {
      const [complex] = await tx.insert(complexes).values(data).returning();
      await tx.insert(subscriptions).values({ complexId: complex.id });
      return complex;
    });
  }

  async update(id: string, data: any) {
    const [updated] = await this.db.update(complexes).set({ ...data, updatedAt: new Date() }).where(eq(complexes.id, id)).returning();
    return updated;
  }

  async remove(id: string) {
    const [deleted] = await this.db.delete(complexes).where(eq(complexes.id, id)).returning();
    return deleted;
  }
}
