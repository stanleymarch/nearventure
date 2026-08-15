import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserEntity } from '../users/entities/user.entity';
import { MIGRATIONS } from './migration-registry';
import { resolveDatabaseConfig } from './database.config';

// PostGIS + pgvector via docker compose (see docker/docker-compose.yml).
// Spatial queries (POI radius/bbox) and semantic search need Postgres extensions.
// In production (NODE_ENV=production / APP_ENV=production), TypeORM's
// synchronize: true runs ALTER TABLE on every boot — dangerous on live
// databases with real data. Gate it behind an explicit env flag.
const isProd = process.env.NODE_ENV === 'production' || process.env.APP_ENV === 'production';
const syncMode = process.env.DB_SYNCHRONIZE === 'true' || (!isProd && process.env.DB_SYNCHRONIZE !== 'false');

// Bug B1 / B3 / B4 (logs/qa/REPORT.md): the migration folder is registered
// so `npm run migration:run` can apply schema fixes. Synchronize is left
// enabled for dev convenience; on prod the team should run migrations
// explicitly (DB_SYNCHRONIZE=false npm run start:prod).
//
// The ordered chain lives in ./migration-registry (single source of truth
// shared with the migration CLI).
const migrations = MIGRATIONS;
const databaseConfig = resolveDatabaseConfig();

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      ...databaseConfig,
      autoLoadEntities: true,
      synchronize: syncMode,
      migrationsRun: false, // dev: never run automatically. Use `npm run migration:run`.
      migrations,
      logging: process.env.DB_LOGGING === 'true',
    }),
  ],
})
export class DatabaseModule {}
