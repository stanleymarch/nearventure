import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Persist the topology of newly saved routes without rewriting legacy data.
 * NULL deliberately means "not specified": old map-saved rows discarded the
 * loop option, so defaulting them to false would mislabel closed routes.
 *
 * Schema-aware: guarded by `hasTable('routes')` because this migration runs
 * before the runtime-foundation migration on a fresh database — there is no
 * routes table yet, so the ALTER must no-op until the foundation creates it.
 */
export class AddRouteLoop1744650000002 implements MigrationInterface {
  name = 'AddRouteLoop1744650000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('routes')) {
      await queryRunner.query(`
        ALTER TABLE routes
          ADD COLUMN IF NOT EXISTS loop boolean NULL
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('routes')) {
      await queryRunner.query(`
        ALTER TABLE routes
          DROP COLUMN IF EXISTS loop
      `);
    }
  }
}
