import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { CliHelpRequested, CliUsageError, parseArgs, printUsage } from './poi-importer.cli';

// Repo root = this spec's dir (apps/backend/src/importer) + 4 levels up.
const REPO_ROOT = join(__dirname, '..', '..', '..', '..');

// Every documented production compose invocation must forward CLI args to the
// compiled importer WITHOUT a leading `--`: `docker compose run SERVICE ARGS`
// passes everything after the service name straight to the container command,
// so a literal `--` would reach the CLI as `unknown argument: --` (exit 2).
const DOCUMENTED_COMMAND_FILES = [
  'AGENTS.md',
  join('docker', 'docker-compose.prod.yml'),
  join('docs', 'ARCHITECTURE.md'),
  join('docs', 'data-refresh.md'),
  join('docs', 'deployment.md'),
  join('scripts', 'refresh-data.sh'),
  join('apps', 'backend', 'src', 'importer', 'poi-importer.cli.ts'),
];

describe('poi-importer CLI argument parsing (C7 follow-up)', () => {
  const realEnvTrustedRoot = process.env.POI_IMPORT_TRUSTED_ROOT;

  afterEach(() => {
    if (realEnvTrustedRoot === undefined) delete process.env.POI_IMPORT_TRUSTED_ROOT;
    else process.env.POI_IMPORT_TRUSTED_ROOT = realEnvTrustedRoot;
  });

  it('parses the minimal production invocation (trusted root from flag)', () => {
    const opts = parseArgs([
      '--trusted-root',
      '/srv/nearventure/imports',
      '--run-dir',
      'releases/2026-08-10',
    ]);
    expect(opts).toEqual({
      trustedRoot: '/srv/nearventure/imports',
      runDir: 'releases/2026-08-10',
      dryRun: false,
      allowReplay: false,
    });
  });

  it('falls back to POI_IMPORT_TRUSTED_ROOT when --trusted-root is omitted', () => {
    process.env.POI_IMPORT_TRUSTED_ROOT = '/srv/nearventure/imports';
    const opts = parseArgs(['--run-dir', 'releases/2026-08-10', '--dry-run', '--allow-replay']);
    expect(opts).toEqual({
      trustedRoot: '/srv/nearventure/imports',
      runDir: 'releases/2026-08-10',
      dryRun: true,
      allowReplay: true,
    });
  });

  it('rejects a missing --run-dir', () => {
    expect(() => parseArgs(['--trusted-root', '/srv/nearventure/imports'])).toThrow(CliUsageError);
  });

  it('rejects a missing trusted root (neither flag nor env)', () => {
    delete process.env.POI_IMPORT_TRUSTED_ROOT;
    expect(() => parseArgs(['--run-dir', 'releases/x'])).toThrow(CliUsageError);
  });

  it('rejects unknown arguments', () => {
    expect(() =>
      parseArgs(['--trusted-root', '/srv/x', '--run-dir', 'r', '--nope']),
    ).toThrow(/unknown argument: --nope/);
  });

  it('throws CliHelpRequested for --help and -h (exit code 0 path)', () => {
    expect(() => parseArgs(['--help'])).toThrow(CliHelpRequested);
    expect(() => parseArgs(['--run-dir', 'r', '-h'])).toThrow(CliHelpRequested);
  });

  it('prints a usage line that mentions the compiled dist CLI (production path)', () => {
    const out: string[] = [];
    printUsage({ write: (chunk: string) => out.push(String(chunk)) } as unknown as NodeJS.WriteStream);
    expect(out.join('')).toContain('node dist/importer/poi-importer.cli.js');
  });

  it('accepts the documented compose-forwarded form (no leading `--` separator)', () => {
    // Exactly what `docker compose run --rm poi-importer --dry-run --run-dir ...`
    // forwards to the container command.
    const opts = parseArgs([
      '--trusted-root',
      '/srv/nearventure/imports',
      '--dry-run',
      '--run-dir',
      'releases/2026-07-26',
    ]);
    expect(opts).toEqual({
      trustedRoot: '/srv/nearventure/imports',
      runDir: 'releases/2026-07-26',
      dryRun: true,
      allowReplay: false,
    });
  });

  it('rejects the old separator form (`--` after the service name is a forwarded literal)', () => {
    // Regression guard: the pre-fix documented form forwarded `--` as the first
    // CLI argument, which the parser must reject (exit 2 path).
    expect(() =>
      parseArgs(['--trusted-root', '/srv/x', '--', '--run-dir', 'releases/x']),
    ).toThrow(/unknown argument: --/);
  });

  it('documented compose commands never pass a leading `--` after poi-importer (repo-wide scan)', () => {
    const offenders: string[] = [];
    for (const rel of DOCUMENTED_COMMAND_FILES) {
      const text = readFileSync(join(REPO_ROOT, rel), 'utf8');
      // Join shell line continuations (backslash-newline) so a multi-line
      // compose command is inspected as one logical line.
      const flattened = text.replace(/\\\r?\n/g, ' ');
      flattened.split(/\r?\n/).forEach((line, i) => {
        // `poi-importer` immediately followed by `-- ` is the invalid form;
        // `poi-importer --run-dir` (flag) and `import:poi -- ...` (npm) are fine.
        if (/poi-importer\s+--\s/.test(line)) {
          offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});
