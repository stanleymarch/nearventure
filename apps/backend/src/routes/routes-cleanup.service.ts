import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Not, IsNull, Repository } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';

import { RouteEntity } from './entities/route.entity';

/**
 * Nightly cleanup of expired published routes.
 *
 * Routes get a 30-day TTL via `expiresAt` at publish time. They are still
 * served (404) once expired, but accumulate in the DB forever without this
 * job. We hard-delete them at 04:30 MSK (analytics recompute is 04:00, so
 * we run after it has read the current state).
 */
@Injectable()
export class RoutesCleanupService {
  private readonly logger = new Logger(RoutesCleanupService.name);

  constructor(
    @InjectRepository(RouteEntity)
    private readonly routeRepo: Repository<RouteEntity>,
  ) {}

  /** Hard-delete published routes whose expiresAt is in the past. */
  async cleanupExpired(): Promise<{ deleted: number }> {
    const now = new Date();
    const result = await this.routeRepo.delete({
      expiresAt: LessThan(now),
    });
    const deleted = result.affected ?? 0;
    if (deleted > 0) {
      this.logger.log(`Deleted ${deleted} expired published routes`);
    }
    return { deleted };
  }

  @Cron('30 4 * * *', { timeZone: 'Europe/Moscow', name: 'routes-cleanup' })
  async nightly() {
    try {
      await this.cleanupExpired();
    } catch (err: any) {
      this.logger.error(`Routes cleanup failed: ${err.message}`);
    }
  }
}
