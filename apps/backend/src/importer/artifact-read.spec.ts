/**
 * Deterministic unit tests for `openBundleScope` — the trusted-root-anchored,
 * dirfd-chain artifact opener (TOCTOU elimination + trusted-root model).
 *
 * The opener is exercised here with a mocked `node:fs/promises`, so every
 * branch — including the Linux `/proc/self/fd` directory-descriptor chain, the
 * trusted-root identity binding and the fail-closed platform policy — is
 * covered on every platform, independent of the host filesystem. The
 * "swap cannot escape" property is proven at the call level: after the trusted
 * root is opened (the only pathname ever resolved), every component is opened
 * relative to a *held descriptor* (`/proc/self/fd/<fd>/…`), never a raw
 * pathname.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  open: vi.fn(),
  stat: vi.fn(),
  lstat: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  open: mocks.open,
  stat: mocks.stat,
  lstat: mocks.lstat,
}));

import { constants } from 'node:fs';
import { join } from 'node:path';
import { openBundleScope } from './artifact-read';

const O_DIRECTORY_NOFOLLOW = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;
const O_FILE_NOFOLLOW = constants.O_RDONLY | constants.O_NOFOLLOW;

function errnoError(code: string, message: string): NodeJS.ErrnoException {
  return Object.assign(new Error(message), { code });
}

function dirHandle(fd: number, dev = 1, ino = 100) {
  return {
    fd,
    stat: vi.fn(async () => ({ dev, ino, isFile: () => false, isDirectory: () => true })),
    readFile: vi.fn(async () => Buffer.from('unused')),
    close: vi.fn(async () => undefined),
  };
}

function fileHandle(fd: number, bytes: Buffer) {
  return {
    fd,
    stat: vi.fn(async () => ({ isFile: () => true, isDirectory: () => false })),
    readFile: vi.fn(async () => bytes),
    close: vi.fn(async () => undefined),
  };
}

/** Force the platform gate to 'linux' so the mocked dirfd chain is exercised. */
const REAL_PLATFORM = process.platform;
function forceLinuxPlatform(): void {
  Object.defineProperty(process, 'platform', { configurable: true, value: 'linux' });
}

const TRUSTED = '/srv/nearventure/imports';
const RUN_DIR = 'releases/2026-07-26';

describe('openBundleScope (trusted-root dirfd chain)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.lstat.mockResolvedValue({ isSymbolicLink: () => false });
    // Trusted-root identity recorded BEFORE the open (dev:1 ino:100).
    mocks.stat.mockResolvedValue({ dev: 1, ino: 100, isFile: () => false, isDirectory: () => true });
    forceLinuxPlatform();
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { configurable: true, value: REAL_PLATFORM });
  });

  /** Standard happy-path open mock: nested run dir + one artifact read. */
  function mockHappyPath(bytes: Buffer): { fileHandle: ReturnType<typeof fileHandle> } {
    const file = fileHandle(7, bytes);
    mocks.open.mockImplementation((path: string) => {
      if (path === TRUSTED) return dirHandle(3);
      if (path === '/proc/self/fd/3/releases') return dirHandle(4);
      if (path === '/proc/self/fd/4/2026-07-26') return dirHandle(5);
      if (path === '/proc/self/fd/5/reports') return dirHandle(6);
      if (path === '/proc/self/fd/6/poi_product_import.sql') return file;
      throw errnoError('ENOENT', `unexpected open: ${path}`);
    });
    return { fileHandle: file };
  }

  it('opens the trusted root once, walks the nested run dir and artifact through held fds, reads once, closes everything', async () => {
    const bytes = Buffer.from('INSERT INTO poi_product (poi_uuid) VALUES (1);');
    mockHappyPath(bytes);

    const scope = await openBundleScope(TRUSTED, RUN_DIR);
    const artifact = await scope.readArtifact('reports/poi_product_import.sql', 'records SQL artifact');
    await scope.close();

    expect(artifact.path).toBe(join(TRUSTED, RUN_DIR, 'reports', 'poi_product_import.sql'));
    expect(artifact.bytes).toBe(bytes);

    // Trusted-root identity recorded exactly once, BEFORE any open.
    expect(mocks.stat).toHaveBeenCalledWith(TRUSTED);
    expect(mocks.stat).toHaveBeenCalledTimes(1);

    // The trusted root is the only pathname resolved; everything else is
    // relative to a held descriptor.
    expect(mocks.open).toHaveBeenNthCalledWith(1, TRUSTED, O_DIRECTORY_NOFOLLOW);
    expect(mocks.open).toHaveBeenNthCalledWith(2, '/proc/self/fd/3/releases', O_DIRECTORY_NOFOLLOW);
    expect(mocks.open).toHaveBeenNthCalledWith(3, '/proc/self/fd/4/2026-07-26', O_DIRECTORY_NOFOLLOW);
    expect(mocks.open).toHaveBeenNthCalledWith(4, '/proc/self/fd/5/reports', O_DIRECTORY_NOFOLLOW);
    expect(mocks.open).toHaveBeenNthCalledWith(5, '/proc/self/fd/6/poi_product_import.sql', O_FILE_NOFOLLOW);

    // Exactly one read from the final descriptor; every descriptor closed once.
    const results = mocks.open.mock.results;
    for (const call of results) {
      expect(call.value.readFile).toHaveBeenCalledTimes(call.value.fd === 7 ? 1 : 0);
      expect(call.value.close).toHaveBeenCalledTimes(1);
    }
  });

  it('proves a component swap cannot escape: opens are relative to held fds, never raw pathnames', async () => {
    mockHappyPath(Buffer.from('x'));
    const scope = await openBundleScope(TRUSTED, RUN_DIR);
    await scope.readArtifact('reports/poi_product_import.sql', 'records SQL artifact');
    await scope.close();

    const calls = mocks.open.mock.calls.map((call) => call[0] as string);
    expect(calls).toHaveLength(5);
    expect(calls[0]).toBe(TRUSTED);
    for (const path of calls.slice(1)) {
      expect(path).toMatch(/^\/proc\/self\/fd\/\d+\//);
      expect(path).not.toContain(TRUSTED);
      expect(path).not.toContain('nearventure');
    }
  });

  it('accepts a nested known-good run directory (releases/2026-07-26)', async () => {
    mockHappyPath(Buffer.from('y'));
    const scope = await openBundleScope(TRUSTED, RUN_DIR);
    const artifact = await scope.readArtifact('reports/poi_product_import.sql', 'records SQL artifact');
    await scope.close();
    expect(artifact.bytes).toEqual(Buffer.from('y'));
    // The run dir was walked component by component through held fds.
    const dirOpens = mocks.open.mock.calls.map((call) => call[0] as string);
    expect(dirOpens).toContain('/proc/self/fd/3/releases');
    expect(dirOpens).toContain('/proc/self/fd/4/2026-07-26');
  });

  it('rejects a run directory that is not a clean relative descendant (.., absolute, backslash) before any open', async () => {
    for (const bad of ['../outside', '/absolute/run', 'releases\\2026-07-26', 'C:\\run', '', 'a//b', 'a/./b']) {
      await expect(openBundleScope(TRUSTED, bad)).rejects.toMatchObject({ code: 'invalid_path' });
    }
    expect(mocks.stat).not.toHaveBeenCalled();
    expect(mocks.open).not.toHaveBeenCalled();
  });

  it('rejects a symlinked run-directory component (ELOOP) as path_escape', async () => {
    mocks.open.mockImplementation((path: string) => {
      if (path === TRUSTED) return dirHandle(3);
      throw errnoError('ELOOP', 'too many levels of symbolic links');
    });
    await expect(openBundleScope(TRUSTED, RUN_DIR)).rejects.toMatchObject({ code: 'path_escape' });
  });

  it('rejects a missing run-directory component (ENOENT) as missing_artifact', async () => {
    mocks.open.mockImplementation((path: string) => {
      if (path === TRUSTED) return dirHandle(3);
      throw errnoError('ENOENT', 'no such file');
    });
    await expect(openBundleScope(TRUSTED, RUN_DIR)).rejects.toMatchObject({ code: 'missing_artifact' });
  });

  it('rejects a run-directory component that is not a directory (ENOTDIR, real file) as invalid_artifact', async () => {
    mocks.open.mockImplementation((path: string) => {
      if (path === TRUSTED) return dirHandle(3);
      throw errnoError('ENOTDIR', 'not a directory');
    });
    mocks.lstat.mockResolvedValue({ isSymbolicLink: () => false });
    await expect(openBundleScope(TRUSTED, RUN_DIR)).rejects.toMatchObject({ code: 'invalid_artifact' });
  });

  it('rejects a swapped run-directory component (ENOTDIR, symlink per no-follow lstat) as path_escape', async () => {
    mocks.open.mockImplementation((path: string) => {
      if (path === TRUSTED) return dirHandle(3);
      throw errnoError('ENOTDIR', 'not a directory');
    });
    mocks.lstat.mockResolvedValue({ isSymbolicLink: () => true });
    await expect(openBundleScope(TRUSTED, RUN_DIR)).rejects.toMatchObject({ code: 'path_escape' });
    expect(mocks.lstat).toHaveBeenCalledWith('/proc/self/fd/3/releases');
  });

  it('rejects a symlinked artifact file (ELOOP) as path_escape', async () => {
    mocks.open.mockImplementation((path: string) => {
      if (path === TRUSTED) return dirHandle(3);
      if (path === '/proc/self/fd/3/releases') return dirHandle(4);
      if (path === '/proc/self/fd/4/2026-07-26') return dirHandle(5);
      if (path === '/proc/self/fd/5/reports') return dirHandle(6);
      throw errnoError('ELOOP', 'too many levels of symbolic links');
    });
    const scope = await openBundleScope(TRUSTED, RUN_DIR);
    await expect(scope.readArtifact('reports/poi_product_import.sql', 'artifact')).rejects.toMatchObject({
      code: 'path_escape',
    });
    await scope.close();
  });

  it('rejects an artifact file that is a directory (EISDIR) as invalid_artifact', async () => {
    mocks.open.mockImplementation((path: string) => {
      if (path === TRUSTED) return dirHandle(3);
      if (path === '/proc/self/fd/3/releases') return dirHandle(4);
      if (path === '/proc/self/fd/4/2026-07-26') return dirHandle(5);
      if (path === '/proc/self/fd/5/reports') return dirHandle(6);
      throw errnoError('EISDIR', 'illegal operation on a directory');
    });
    const scope = await openBundleScope(TRUSTED, RUN_DIR);
    await expect(scope.readArtifact('reports/poi_product_import.sql', 'artifact')).rejects.toMatchObject({
      code: 'invalid_artifact',
    });
    await scope.close();
  });

  it('rejects a missing artifact file (ENOENT) as missing_artifact', async () => {
    mocks.open.mockImplementation((path: string) => {
      if (path === TRUSTED) return dirHandle(3);
      if (path === '/proc/self/fd/3/releases') return dirHandle(4);
      if (path === '/proc/self/fd/4/2026-07-26') return dirHandle(5);
      if (path === '/proc/self/fd/5/reports') return dirHandle(6);
      throw errnoError('ENOENT', 'no such file');
    });
    const scope = await openBundleScope(TRUSTED, RUN_DIR);
    await expect(scope.readArtifact('reports/poi_product_import.sql', 'artifact')).rejects.toMatchObject({
      code: 'missing_artifact',
    });
    await scope.close();
  });

  it('rejects unsafe artifact path components', async () => {
    const scope = await openBundleScope(TRUSTED, RUN_DIR);
    await expect(scope.readArtifact('reports/../escape.sql', 'artifact')).rejects.toMatchObject({
      code: 'invalid_path',
    });
    await expect(scope.readArtifact('..\\evil.sql', 'artifact')).rejects.toMatchObject({
      code: 'invalid_path',
    });
    await scope.close();
  });

  it('rejects an ordinary directory replacing the trusted root (dev/ino mismatch after open)', async () => {
    mocks.stat.mockResolvedValue({ dev: 1, ino: 100, isFile: () => false, isDirectory: () => true });
    mocks.open.mockImplementation((path: string) => {
      if (path !== TRUSTED) throw errnoError('ENOENT', `unexpected open: ${path}`);
      // A different ordinary directory (same filesystem, new inode) sits at the
      // configured path — invisible to O_NOFOLLOW, caught by dev/ino only.
      return {
        fd: 3,
        stat: vi.fn(async () => ({ dev: 1, ino: 2000, isFile: () => false, isDirectory: () => true })),
        readFile: vi.fn(async () => Buffer.from('unused')),
        close: vi.fn(async () => undefined),
      };
    });

    await expect(openBundleScope(TRUSTED, RUN_DIR)).rejects.toMatchObject({ code: 'path_escape' });
    expect(mocks.open).toHaveBeenCalledTimes(1);
    expect(mocks.open.mock.results[0].value.close).toHaveBeenCalledTimes(1);
  });

  it('rejects a missing trusted root (ENOENT at identity resolution) as path_escape', async () => {
    mocks.stat.mockRejectedValue(errnoError('ENOENT', 'no such file or directory'));
    await expect(openBundleScope(TRUSTED, RUN_DIR)).rejects.toMatchObject({ code: 'path_escape' });
    expect(mocks.open).not.toHaveBeenCalled();
  });

  it('rejects a symlinked trusted root (ENOTDIR quirk at identity resolution) as path_escape', async () => {
    mocks.stat.mockRejectedValue(errnoError('ENOTDIR', 'not a directory'));
    await expect(openBundleScope(TRUSTED, RUN_DIR)).rejects.toMatchObject({ code: 'path_escape' });
    expect(mocks.open).not.toHaveBeenCalled();
  });

  it('rejects the trusted root becoming a symlink between identity resolution and open (ELOOP at open)', async () => {
    mocks.stat.mockResolvedValue({ dev: 1, ino: 100, isFile: () => false, isDirectory: () => true });
    mocks.open.mockRejectedValue(errnoError('ELOOP', 'too many levels of symbolic links'));
    await expect(openBundleScope(TRUSTED, RUN_DIR)).rejects.toMatchObject({ code: 'path_escape' });
  });

  it('fails closed on platforms without the Linux dirfd chain (never silently weaker)', async () => {
    Object.defineProperty(process, 'platform', { configurable: true, value: 'win32' });
    await expect(openBundleScope('C:\\imports', 'releases/2026-07-26')).rejects.toMatchObject({
      code: 'secure_open_unsupported',
    });
    expect(mocks.open).not.toHaveBeenCalled();
  });
});
