import 'dotenv/config';
import { DataSource } from 'typeorm';
import { UserEntity } from '../users/entities/user.entity';
import { dropPublicTables } from './reset-database';
import { resolveDatabaseConfig } from './database.config';
import { assertDatabaseResetAllowed } from './reset-policy';

async function resetDatabase() {
  const databaseConfig = resolveDatabaseConfig();
  // Do not construct or initialize a DataSource until the destructive-action
  // guard has approved both operator opt-in and the target host.
  assertDatabaseResetAllowed(databaseConfig);

  const dataSource = new DataSource({
    type: 'postgres',
    ...databaseConfig,
    entities: [UserEntity],
    // Reset owns schema cleanup explicitly; enabling synchronize here would touch
    // user before its dependent tables have been removed.
    synchronize: false,
  });

  await dataSource.initialize();
  console.log('Dropping and recreating database tables...');
  await dropPublicTables(dataSource);
  await dataSource.synchronize();
  console.log('Database reset complete.');
  await dataSource.destroy();
}

resetDatabase().then(
  () => process.exit(0),
  (err) => {
    console.error('Failed to reset database:', err);
    process.exit(1);
  },
);
