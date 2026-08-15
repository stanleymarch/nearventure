import { describe, expect, it } from 'vitest';
import { assertDestructiveE2ESafe, isE2ESafeMode, isLoopbackHttpUrl } from './safety';

describe('destructive E2E safety', () => {
  it('accepts only exact loopback HTTP hosts', () => {
    for (const url of [
      'http://localhost:3000/api',
      'https://127.42.7.1/api',
      'http://[::1]:3000/api',
    ]) {
      expect(isLoopbackHttpUrl(url)).toBe(true);
    }

    for (const url of [
      'https://localhost.example.com/api',
      'https://127.0.0.1.example.com/api',
      'https://evillocalhost.example/api',
      'not a URL',
      'ftp://localhost/api',
    ]) {
      expect(isLoopbackHttpUrl(url)).toBe(false);
    }
  });

  it('fails closed for a normal-mode remote destructive API target', () => {
    expect(() => assertDestructiveE2ESafe({ E2E_API_URL: 'https://nearventure.ru/api' })).toThrow(
      'Refusing destructive E2E actions',
    );
  });

  it('fails closed for a safe-mode remote destructive target', () => {
    const env = {
      E2E_SAFE_MODE: '1',
      E2E_API_URL: 'https://nearventure.ru/api',
      E2E_BASE_URL: 'https://nearventure.ru',
    };

    expect(isE2ESafeMode(env)).toBe(true);
    expect(() => assertDestructiveE2ESafe(env)).toThrow('E2E_API_URL');
  });

  it('fails closed when a local API is paired with a remote frontend', () => {
    expect(() => assertDestructiveE2ESafe({
      E2E_API_URL: 'http://127.0.0.1:3000/api',
      E2E_BASE_URL: 'https://nearventure.ru',
    })).toThrow('E2E_BASE_URL');
  });

  it('allows destructive actions only for loopback targets', () => {
    expect(() => assertDestructiveE2ESafe({
      E2E_API_URL: 'http://127.0.0.1:3000/api',
      E2E_BASE_URL: 'http://localhost:5173',
    })).not.toThrow();
  });
});
