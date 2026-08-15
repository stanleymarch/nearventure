/**
 * Race-free, trusted-root-anchored artifact reading for the POI importer (C6).
 *
 * Every byte consumed by the importer — the import manifest, the records SQL,
 * the release manifest and the collection provenance — is read *exactly once*
 * from a chain of held directory file descriptors rooted at an explicit
 * **trusted root**, and every byte used afterwards (schema parsing, raw-byte
 * SHA-256 digests, the replay/audit digest, the SQL statements) is derived
 * from that single read buffer. No pathname below the trusted root is ever
 * resolved as a string: each component is bound by the kernel at its open(2)
 * time to the *held parent inode*, so a file or directory swapped behind the
 * importer's back cannot redirect a read or make the parsed content diverge
 * from the recorded digest (TOCTOU).
 *
 * Trusted-root model
 * ==================
 * The importer requires an explicit **trusted root**: an admin-owned,
 * effectively immutable directory that only the operator writes (see
 * docs/data-refresh.md — "Trusted root" for the recommended permissions and
 * ownership). The bundle run directory is supplied as a *clean relative path*
 * under that root (no absolute paths, no `..`, no backslashes, no symlinks).
 *
 *   1. The trusted root is opened ONCE with `O_RDONLY | O_DIRECTORY |
 *      O_NOFOLLOW` and — as a config-time identity binding — its `stat`
 *      dev/ino is recorded BEFORE the open and matched against the opened
 *      descriptor's `fstat`, so even an ordinary-directory replacement of the
 *      configured root path is rejected. This is the only pathname the
 *      importer ever resolves, and it is the operator-configured anchor (the
 *      residual window — an attacker replacing the *configured* path between
 *      `stat` and `open` — is inside the admin trust boundary).
 *   2. The run directory is traversed *lexically* (validated components) and
 *      each component is opened relative to the held parent descriptor as
 *      `/proc/self/fd/<parentFd>/<component>` with `O_DIRECTORY | O_NOFOLLOW`
 *      plus an fstat-isDirectory check. No `realpath`, no string traversal of
 *      the run directory: a symlink anywhere in the chain yields ELOOP/ENOTDIR
 *      and the bundle is rejected.
 *   3. Each artifact is opened relative to the held run-directory descriptor
 *      (`/proc/self/fd/<heldFd>/<component>…`) with `O_NOFOLLOW`, fstat-verified
 *      as a regular file, and read exactly once from that descriptor.
 *
 * Platform policy
 * ===============
 * The dirfd chain requires the Linux `/proc/self/fd` magic links. On any other
 * platform the secure open is UNSUPPORTED and the bundle is REJECTED with
 * `secure_open_unsupported` — the importer never silently falls back to a
 * weaker pathname-based read. (This is why the real-filesystem importer tests
 * run on Linux; the deterministic mock-based suite in artifact-read.spec.ts
 * exercises every branch on every platform.)
 */
import { constants as fsConstants, type Stats } from 'node:fs';
import { lstat, open, stat, type FileHandle } from 'node:fs/promises';
import { join } from 'node:path';
import { ImportValidationError } from './import-errors';

export interface OpenedArtifact {
  /** Lexical path (trustedRoot/runDir/relativePath) for reporting only. */
  path: string;
  /** The exact bytes read once from the final no-follow descriptor. */
  bytes: Buffer;
}

/** The secure traversal scope anchored at the opened trusted root. */
export interface BundleScope {
  /** Lexical run-directory path (trustedRoot/runDir) for reporting only. */
  runDirPath: string;
  /**
   * Read one artifact exactly once relative to the held run-directory
   * descriptor. `relativePath` must be a clean relative path whose components
   * are validated fixed literals; every component is opened through held
   * descriptors — the pathname string is never resolved after the trusted root.
   */
  readArtifact(relativePath: string, label: string): Promise<OpenedArtifact>;
  /** Close the trusted-root and run-directory descriptors held by the scope. */
  close(): Promise<void>;
}

/** Open a directory component: read-only, must be a real directory, never a symlink. */
const O_DIRECTORY_NOFOLLOW = fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW;
/** Open the final artifact: read-only, must be a real file, never a symlink. */
const O_FILE_NOFOLLOW = fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW;

/** Conservative fixed shape for path components (no slashes, no dots-only, ASCII). */
const COMPONENT_PATTERN = /^[A-Za-z0-9._-]+$/;

/** Reject any path that is not a clean relative path with validated components. */
function validateCleanRelativePath(relativePath: string, what: string): void {
  if (relativePath === '' || relativePath.startsWith('/') || /^[A-Za-z]:[\\/]/.test(relativePath) || relativePath.includes('\\')) {
    throw new ImportValidationError(
      'invalid_path',
      `${what} must be a clean relative path under the trusted root (no absolute paths, no backslashes): ${JSON.stringify(relativePath)}`,
    );
  }
  for (const component of relativePath.split('/')) {
    if (!COMPONENT_PATTERN.test(component) || component === '.' || component === '..') {
      throw new ImportValidationError(
        'invalid_path',
        `unsafe ${what} component: ${JSON.stringify(component)} (no '.', '..', empty or exotic components)`,
      );
    }
  }
}

/** Split a clean relative artifact path into intermediate dirs + final file. */
function splitRelativePath(relativePath: string, what: string): { dirs: string[]; file: string } {
  validateCleanRelativePath(relativePath, what);
  const parts = relativePath.split('/');
  if (parts.length < 2) {
    throw new ImportValidationError('invalid_path', `${what} must contain a directory component: ${relativePath}`);
  }
  const file = parts[parts.length - 1] ?? '';
  const dirs = parts.slice(0, -1);
  return { dirs, file };
}

/**
 * Open a directory component relative to a held parent descriptor; fstat must be a directory.
 *
 * Linux quirk: `O_DIRECTORY | O_NOFOLLOW` on a trailing symlink returns
 * ENOTDIR (not ELOOP), the same errno as a real non-directory file. A no-follow
 * `lstat` of the component (parent inode pinned by the held descriptor, name is
 * a validated fixed literal, no symlink following) distinguishes the two: a
 * symlink is a `path_escape`, a real non-directory is an `invalid_artifact`.
 * The lstat only classifies the error label — the importer never reads a byte
 * through a pathname, so a swap cannot influence which content is consumed.
 */
async function openDirectoryComponent(parentFd: number, name: string, label: string): Promise<FileHandle> {
  const fdPath = `/proc/self/fd/${parentFd}/${name}`;
  let handle: FileHandle;
  try {
    handle = await open(fdPath, O_DIRECTORY_NOFOLLOW);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ELOOP') {
      throw new ImportValidationError('path_escape', `${label}: component "${name}" is a symlink`);
    }
    if (code === 'ENOENT') {
      throw new ImportValidationError('missing_artifact', `${label}: component "${name}" not found`);
    }
    if (code === 'ENOTDIR') {
      let isSymlink = false;
      try {
        isSymlink = (await lstat(fdPath)).isSymbolicLink();
      } catch {
        // The entry vanished between open and lstat — still rejected below.
      }
      if (isSymlink) {
        throw new ImportValidationError('path_escape', `${label}: component "${name}" is a symlink`);
      }
      throw new ImportValidationError('invalid_artifact', `${label}: component "${name}" is not a directory`);
    }
    throw new ImportValidationError('path_escape', `${label}: cannot open component "${name}": ${(error as Error).message}`);
  }
  try {
    const info = await handle.stat();
    if (!info.isDirectory()) {
      throw new ImportValidationError('invalid_artifact', `${label}: component "${name}" is not a directory`);
    }
    return handle;
  } catch (error) {
    await handle.close().catch(() => undefined);
    throw error;
  }
}

/** Open the final regular artifact relative to a held parent descriptor; fstat must be a regular file. */
async function openFinalFile(parentFd: number, name: string, label: string): Promise<FileHandle> {
  const fdPath = `/proc/self/fd/${parentFd}/${name}`;
  let handle: FileHandle;
  try {
    handle = await open(fdPath, O_FILE_NOFOLLOW);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ELOOP') {
      throw new ImportValidationError('path_escape', `${label}: "${name}" is a symlink`);
    }
    if (code === 'EISDIR') {
      throw new ImportValidationError('invalid_artifact', `${label}: "${name}" is not a regular file (it is a directory)`);
    }
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      throw new ImportValidationError('missing_artifact', `${label} not found at ${fdPath}`);
    }
    throw new ImportValidationError('missing_artifact', `${label} not found or unreadable: ${(error as Error).message}`);
  }
  try {
    const info = await handle.stat();
    if (!info.isFile()) {
      throw new ImportValidationError('invalid_artifact', `${label} is not a regular file`);
    }
    return handle;
  } catch (error) {
    await handle.close().catch(() => undefined);
    throw error;
  }
}

/**
 * Record the identity (dev/ino) of the configured trusted root BEFORE it is
 * opened. The recorded identity is later matched against the `fstat` of the
 * opened descriptor, so an ordinary directory swapped in at the configured
 * root path between identity resolution and open is rejected: the opened FD is
 * bound to the recorded inode, never to whatever pathname currently points at
 * the configured path.
 */
export async function resolveTrustedRootIdentity(trustedRoot: string, label: string): Promise<{ dev: number; ino: number }> {
  let expected: Stats;
  try {
    expected = await stat(trustedRoot);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      throw new ImportValidationError('path_escape', `${label}: the trusted root does not exist or is not a directory: ${trustedRoot}`);
    }
    if (code === 'ELOOP') {
      throw new ImportValidationError('path_escape', `${label}: the trusted root is a symlink: ${trustedRoot}`);
    }
    throw new ImportValidationError('path_escape', `${label}: cannot resolve the trusted root ${trustedRoot}: ${(error as Error).message}`);
  }
  if (!expected.isDirectory()) {
    throw new ImportValidationError('path_escape', `${label}: the trusted root is not a directory: ${trustedRoot}`);
  }
  return { dev: expected.dev, ino: expected.ino };
}

/**
 * Open the trusted root with `O_DIRECTORY | O_NOFOLLOW` and REQUIRE the opened
 * descriptor's `fstat` dev/ino to equal the identity recorded before the open.
 * If the configured root path was replaced — even by an ordinary directory —
 * the descriptor is closed and the import is rejected. This is the single
 * pathname the importer resolves, and it is the operator-configured anchor.
 */
export async function openTrustedRootChecked(
  trustedRoot: string,
  expected: { dev: number; ino: number },
  label: string,
): Promise<FileHandle> {
  let root: FileHandle;
  try {
    root = await open(trustedRoot, O_DIRECTORY_NOFOLLOW);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      // ENOTDIR also covers the Linux O_DIRECTORY|O_NOFOLLOW-on-symlink quirk.
      throw new ImportValidationError('path_escape', `${label}: the trusted root is not a real directory (or is a symlink): ${trustedRoot}`);
    }
    if (code === 'ELOOP') {
      throw new ImportValidationError('path_escape', `${label}: the trusted root itself is a symlink: ${trustedRoot}`);
    }
    throw new ImportValidationError('path_escape', `${label}: cannot open the trusted root ${trustedRoot}: ${(error as Error).message}`);
  }
  try {
    const actual = await root.stat();
    if (!actual.isDirectory() || actual.dev !== expected.dev || actual.ino !== expected.ino) {
      throw new ImportValidationError(
        'path_escape',
        `${label}: the trusted root was replaced between identity resolution and open ` +
          `(fstat dev/ino ${actual.dev}:${actual.ino} != expected ${expected.dev}:${expected.ino})`,
      );
    }
    return root;
  } catch (error) {
    await root.close().catch(() => undefined);
    throw error;
  }
}

/**
 * Open the bundle scope: the trusted root (once, identity-bound) and the run
 * directory walked as validated components through held descriptors. `runDir`
 * must be a clean relative path under `trustedRoot`; it is never resolved as a
 * pathname string. Returns a scope whose `readArtifact` reads each artifact
 * exactly once through the held run-directory descriptor.
 */
export async function openBundleScope(trustedRoot: string, runDir: string): Promise<BundleScope> {
  if (process.platform !== 'linux') {
    throw new ImportValidationError(
      'secure_open_unsupported',
      `bundle open requires the Linux /proc/self/fd directory-descriptor chain; ` +
        `refusing to fall back to a weaker pathname-based read on platform "${process.platform}"`,
    );
  }
  const label = 'bundle run directory';
  // Lexically validate the run directory as a clean relative descendant of the
  // trusted root BEFORE opening anything.
  validateCleanRelativePath(runDir, label);

  // Trusted root: record its identity, open it, require the opened descriptor
  // to be the very same directory (dev/ino match). The only pathname resolved.
  const { dev, ino } = await resolveTrustedRootIdentity(trustedRoot, label);
  const trustedRootFd = await openTrustedRootChecked(trustedRoot, { dev, ino }, label);

  // Walk the run directory purely through held descriptors.
  const held: FileHandle[] = [trustedRootFd];
  let runDirFd: FileHandle = trustedRootFd;
  try {
    for (const component of runDir.split('/')) {
      const next = await openDirectoryComponent(runDirFd.fd, component, label);
      held.push(next);
      runDirFd = next;
    }
  } catch (error) {
    for (const handle of held.reverse()) {
      await handle.close().catch(() => undefined);
    }
    throw error;
  }

  const lexicalRunDirPath = join(trustedRoot, runDir);
  return {
    runDirPath: lexicalRunDirPath,
    async readArtifact(relativePath: string, artifactLabel: string): Promise<OpenedArtifact> {
      const { dirs, file } = splitRelativePath(relativePath, artifactLabel);
      const opened: FileHandle[] = [];
      let parentFd = runDirFd.fd;
      try {
        for (const dir of dirs) {
          const next = await openDirectoryComponent(parentFd, dir, artifactLabel);
          opened.push(next);
          parentFd = next.fd;
        }
        const finalHandle = await openFinalFile(parentFd, file, artifactLabel);
        opened.push(finalHandle);
        const bytes = await finalHandle.readFile();
        return { path: join(lexicalRunDirPath, relativePath), bytes };
      } finally {
        // Close the per-read descriptors (deepest first); the scope's run-dir
        // and trusted-root descriptors stay open for subsequent reads.
        for (const handle of opened.reverse()) {
          await handle.close().catch(() => undefined);
        }
      }
    },
    async close(): Promise<void> {
      for (const handle of held.reverse()) {
        await handle.close().catch(() => undefined);
      }
    },
  };
}
