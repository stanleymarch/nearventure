/**
 * POI import CLI (C6).
 *
 * Production (compiled image, one-shot compose service `poi-importer`):
 *
 *   docker compose --env-file docker/.env.prod --profile import \
 *     -f docker/docker-compose.prod.yml run --rm poi-importer \
 *     --run-dir releases/<tag> [--dry-run] [--allow-replay]
 *
 *   (or, from a host with the backend built:)
 *   node apps/backend/dist/importer/poi-importer.cli.js --trusted-root <abs-path> --run-dir <rel>
 *
 * Development (from apps/backend, without a build):
 *
 *   npm run import:poi -- --trusted-root <abs-path> --run-dir <relative-path> [--dry-run] [--allow-replay]
 *
 * `<trusted-root>` is the admin-owned immutable directory that anchors the
 * secure read (or set `POI_IMPORT_TRUSTED_ROOT`). `<run-dir>` is the bundle
 * run directory as a CLEAN RELATIVE path under the trusted root (no absolute
 * paths, no `..`, no symlinks), containing `reports/` and `release/` per the
 * v1 manifest contract. The importer validates the bundle completely before
 * opening a write transaction, then performs the atomic staging swap. Uses the
 * same env-driven Postgres connection settings as the migration CLI
 * (DB_HOST/DB_PORT/DB_USERNAME/DB_PASSWORD/DB_DATABASE). Never logs
 * credentials or artifact contents.
 */
import 'dotenv/config';
import { DataSource } from 'typeorm';
import { PoiImporterService } from './poi-importer.service';
import { resolveDatabaseConfig } from '../database/database.config';

export interface PoiImportCliOptions {
  trustedRoot: string;
  runDir: string;
  dryRun: boolean;
  allowReplay: boolean;
}

/** Thrown for malformed/insufficient arguments (exit code 2). */
export class CliUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CliUsageError';
  }
}

/** Thrown when the user explicitly asked for help (exit code 0). */
export class CliHelpRequested extends Error {
  constructor() {
    super('help requested');
    this.name = 'CliHelpRequested';
  }
}

export function printUsage(stream: NodeJS.WriteStream = process.stderr): void {
  stream.write(
    'usage: node dist/importer/poi-importer.cli.js ' +
      '--trusted-root <abs-path> --run-dir <relative-path> [--dry-run] [--allow-replay]\n' +
      '       (dev, from apps/backend: npm run import:poi -- <same args>)\n' +
      '       (or set POI_IMPORT_TRUSTED_ROOT instead of --trusted-root)\n',
  );
}

export function parseArgs(argv: string[]): PoiImportCliOptions {
  const options: { trustedRoot?: string; runDir?: string; dryRun: boolean; allowReplay: boolean } = {
    dryRun: false,
    allowReplay: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--trusted-root') {
      options.trustedRoot = argv[i + 1];
      i += 1;
    } else if (arg === '--run-dir') {
      options.runDir = argv[i + 1];
      i += 1;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--allow-replay') {
      options.allowReplay = true;
    } else if (arg === '--help' || arg === '-h') {
      throw new CliHelpRequested();
    } else {
      throw new CliUsageError(`unknown argument: ${arg}`);
    }
  }
  if (!options.runDir) throw new CliUsageError('--run-dir is required (a clean relative path under the trusted root)');
  options.trustedRoot = options.trustedRoot ?? process.env.POI_IMPORT_TRUSTED_ROOT;
  if (!options.trustedRoot) throw new CliUsageError('--trusted-root is required (or set POI_IMPORT_TRUSTED_ROOT)');
  return options as PoiImportCliOptions;
}

async function main(): Promise<void> {
  let options: PoiImportCliOptions;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    if (error instanceof CliHelpRequested) {
      printUsage(process.stdout);
      return; // explicit help: success exit code
    }
    if (error instanceof CliUsageError) {
      console.error(`error: ${error.message}`);
      printUsage(process.stderr);
      process.exit(2);
    }
    throw error;
  }
  const dataSource = new DataSource({
    type: 'postgres',
    ...resolveDatabaseConfig(),
    synchronize: false,
    logging: false,
  });

  await dataSource.initialize();
  const service = new PoiImporterService(dataSource, { log: (message) => console.log(message) });
  try {
    const result = await service.importPoiExport(options);
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await dataSource.destroy();
  }
}

// Only run when this file is the actual entry point — importing it (e.g. from
// the argument-parsing spec) must not execute the importer.
if (require.main === module) {
  main().catch((error) => {
    console.error(`POI import failed: ${error?.message ?? error}`);
    process.exitCode = 1;
  });
}
