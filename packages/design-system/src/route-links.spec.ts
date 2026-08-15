import { describe, expect, it } from 'vitest';
import { routeWebUrl } from './route-links';

describe('routeWebUrl', () => {
  it('uses a relative canonical SPA URL without a configured base', () => {
    expect(routeWebUrl('route id')).toBe('/#/route/route%20id');
  });

  it('accepts an explicit HTTPS origin', () => {
    expect(routeWebUrl('route-1', 'https://share.example.test/')).toBe(
      'https://share.example.test/#/route/route-1',
    );
  });

  it.each([
    'http://share.example.test',
    'https://user:pass@share.example.test',
    'https://share.example.test/app',
    'https://share.example.test/?source=test',
    'https://share.example.test/#route',
  ])('rejects invalid caller-supplied public bases: %s', (base) => {
    expect(() => routeWebUrl('route-1', base)).toThrow(/HTTPS origin/);
  });
});
