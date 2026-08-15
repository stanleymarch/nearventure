import { isIP } from 'node:net';

const DEFAULT_API_URL = 'http://localhost:3000/api';
const DEFAULT_BASE_URL = 'http://localhost:5173';

/** True only when an HTTP(S) URL resolves to an exact loopback host. */
export function isLoopbackHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;

    const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (hostname === 'localhost' || hostname === '::1') return true;
    return isIP(hostname) === 4 && hostname.split('.')[0] === '127';
  } catch {
    return false;
  }
}

/** True when a run is restricted to non-mutating browser checks. */
export function isE2ESafeMode(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.E2E_SAFE_MODE === '1';
}

/**
 * Destructive E2E actions may only target exact loopback HTTP(S) hosts.
 * E2E_SAFE_MODE permits non-mutating browser checks; it never authorizes a
 * destructive action against an externally managed target.
 */
export function assertDestructiveE2ESafe(env: NodeJS.ProcessEnv = process.env): void {
  const targets = [
    ['E2E_API_URL', env.E2E_API_URL || DEFAULT_API_URL],
    ['E2E_BASE_URL', env.E2E_BASE_URL || DEFAULT_BASE_URL],
  ] as const;

  for (const [name, url] of targets) {
    if (!isLoopbackHttpUrl(url)) {
      throw new Error(
        `Refusing destructive E2E actions: ${name} must use an exact loopback host (localhost, 127.0.0.0/8, or ::1). E2E_SAFE_MODE permits only non-mutating browser checks.`,
      );
    }
  }
}
