import { describe, it, expect } from 'vitest';
import { hashImageUrl } from './media-hash';

describe('hashImageUrl', () => {
  it('returns 16 hex chars', () => {
    const h = hashImageUrl('https://example.com/foo.jpg');
    expect(h).toMatch(/^[0-9a-f]{16}$/);
  });

  it('returns empty string for null/undefined/empty', () => {
    expect(hashImageUrl(null)).toBe('');
    expect(hashImageUrl(undefined)).toBe('');
    expect(hashImageUrl('')).toBe('');
  });

  it('is stable for the same URL', () => {
    const a = hashImageUrl('https://upload.wikimedia.org/foo.jpg');
    const b = hashImageUrl('https://upload.wikimedia.org/foo.jpg');
    expect(a).toBe(b);
  });

  it('normalises query-param order', () => {
    const a = hashImageUrl('https://example.com/x?a=1&b=2');
    const b = hashImageUrl('https://example.com/x?b=2&a=1');
    expect(a).toBe(b);
  });

  it('normalises fragment stripping', () => {
    const a = hashImageUrl('https://example.com/x?a=1#section');
    const b = hashImageUrl('https://example.com/x?a=1');
    expect(a).toBe(b);
  });

  it('changes when the path changes', () => {
    const a = hashImageUrl('https://example.com/old.jpg');
    const b = hashImageUrl('https://example.com/new.jpg');
    expect(a).not.toBe(b);
  });

  it('changes when the host changes', () => {
    const a = hashImageUrl('https://a.example.com/x.jpg');
    const b = hashImageUrl('https://b.example.com/x.jpg');
    expect(a).not.toBe(b);
  });

  it('accepts local upload markers without throwing', () => {
    const h = hashImageUrl('/media/poi/abc123.jpg');
    expect(h).toMatch(/^[0-9a-f]{16}$/);
  });

  it('treats a non-URL string as raw hash (does not throw)', () => {
    const h = hashImageUrl('not a url at all');
    expect(h).toMatch(/^[0-9a-f]{16}$/);
  });

  it('hash space is large (no collisions in a sample)', () => {
    const hashes = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      hashes.add(hashImageUrl(`https://example.com/pic-${i}.jpg?seed=${i}`));
    }
    expect(hashes.size).toBe(1000);
  });
});
