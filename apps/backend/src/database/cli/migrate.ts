/**
 * Manual migration runner.
 *
 *   ts-node src/database/cli/migrate.ts up      # apply pending migrations
 *   ts-node src/database/cli/migrate.ts down    # roll back the most recent
 *   ts-node src/database/cli/migrate.ts status  # show applied vs pending
 *
 * The project uses TypeORM's `synchronize: true` in dev so schema drift is
 * auto-corrected on boot, but that mode is *not* safe in production (it
 * issues ALTER TABLE on every restart). This CLI is the only path that
 * actually applies the JSONB image-attribution key migration (1731000000001)
 * and the URL-column additions (1731000000002) to a live database.
 *
 * Uses the same Postgres connection settings as DatabaseModule — env-driven
 * via dotenv so it picks up `apps/backend/.env` like the rest of the app.
 */
import 'dotenv/config';
import { DataSource } from 'typeorm';
import { UserEntity } from '../../users/entities/user.entity';
import { MIGRATIONS } from '../migration-registry';
import { resolveDatabaseConfig } from '../database.config';

const dataSource = new DataSource({
  type: 'postgres',
  ...resolveDatabaseConfig(),
  entities: [UserEntity],
  migrations: MIGRATIONS,
  synchronize: false,
  logging: false,
});

const cmd = (process.argv[2] || 'up').toLowerCase();

async function main() {
  await dataSource.initialize();
  console.log(`Migration runner — command: ${cmd}`);
  try {
    if (cmd === 'up') {
      const ran = await dataSource.runMigrations({ transaction: 'each' });
      if (ran.length === 0) {
        console.log('  (no pending migrations)');
      } else {
        ran.forEach((m) => console.log(`  ✓ ${m.name}`));
      }
    } else if (cmd === 'down') {
      // Revert the most recent migration. TypeORM 0.3's `undoLastMigration`
      // is the public API for this.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { undoLastMigration } = require('typeorm');
      await undoLastMigration(dataSource);
      console.log('  ✓ rolled back most recent migration');
    } else if (cmd === 'status') {
      const applied = await dataSource.query(
        `SELECT name FROM migrations WHERE name IS NOT NULL ORDER BY id`,
      );
      console.log('  applied:', applied.length ? applied.map((r: { name: string }) => r.name) : '(none)');
      console.log(`  pending: ${await dataSource.showMigrations() ? 'yes' : 'no'}`);
    } else {
      console.error(`Unknown command: ${cmd}. Use up | down | status.`);
      process.exitCode = 2;
    }
  } finally {
    await dataSource.destroy();
  }
}

main().catch((err) => {
  console.error('migration failed:', err);
  process.exit(1);
});
