import { MigrationInterface, QueryRunner } from 'typeorm';
export class CreateItineraryDraft1744650000000 implements MigrationInterface {
  name = 'CreateItineraryDraft1744650000000';
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS itinerary_draft (
      id uuid PRIMARY KEY, version integer NOT NULL DEFAULT 1, owner_key varchar(160) NOT NULL,
      state jsonb NOT NULL, expires_at timestamptz NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    )`);
    await queryRunner.query('CREATE INDEX IF NOT EXISTS "IDX_itinerary_draft_expires_at" ON itinerary_draft (expires_at)');
    await queryRunner.query('CREATE INDEX IF NOT EXISTS "IDX_itinerary_draft_owner_updated_at" ON itinerary_draft (owner_key, updated_at)');
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS itinerary_command (
      draft_id uuid NOT NULL REFERENCES itinerary_draft(id) ON DELETE CASCADE, command_id uuid NOT NULL,
      result_version integer NOT NULL, result_snapshot jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (draft_id, command_id)
    )`);
    await queryRunner.query('CREATE INDEX IF NOT EXISTS "IDX_itinerary_command_created_at" ON itinerary_command (created_at)');
    if (await queryRunner.hasTable('routes')) {
      await queryRunner.query('ALTER TABLE routes ADD COLUMN IF NOT EXISTS source_draft_id uuid');
      await queryRunner.query('ALTER TABLE routes ADD COLUMN IF NOT EXISTS itinerary_snapshot jsonb');
      await queryRunner.query('CREATE INDEX IF NOT EXISTS "IDX_routes_source_draft_id" ON routes (source_draft_id)');
    }
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('routes')) {
      await queryRunner.query('DROP INDEX IF EXISTS "IDX_routes_source_draft_id"');
      await queryRunner.query('ALTER TABLE routes DROP COLUMN IF EXISTS itinerary_snapshot');
      await queryRunner.query('ALTER TABLE routes DROP COLUMN IF EXISTS source_draft_id');
    }
    await queryRunner.query('DROP TABLE IF EXISTS itinerary_command');
    await queryRunner.query('DROP TABLE IF EXISTS itinerary_draft');
  }
}
