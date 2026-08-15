import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import {
  isPublicIpAddress,
  parseSafeRemoteImageUrl,
  REMOTE_IMAGE_MAX_BYTES,
  RemoteImageFetcherService,
} from './remote-image-fetcher.service';

function response(statusCode: number, headers: Record<string, string> = {}, body = Buffer.from('image')): any {
  return Object.assign(Readable.from([body]), { statusCode, headers });
}

describe('RemoteImageFetcherService network policy', () => {
  it.each([
    '0.0.0.0', '10.0.0.1', '100.64.0.1', '127.0.0.1', '169.254.1.1',
    '172.16.0.1', '192.0.0.1', '192.0.2.1', '192.168.1.1', '198.18.0.1',
    '198.51.100.1', '203.0.113.1', '224.0.0.1', '240.0.0.1',
  ])('rejects reserved IPv4 target %s', (address) => {
    expect(isPublicIpAddress(address)).toBe(false);
  });

  it.each([
    '::', '::1', '::ffff:127.0.0.1', '64:ff9b::1', '100::1', '2001:db8::1',
    '2002:c0a8:0101::1', 'fc00::1', 'fd00::1', 'fe80::1', 'ff02::1',
  ])('rejects reserved IPv6 target %s', (address) => {
    expect(isPublicIpAddress(address)).toBe(false);
  });

  it('allows globally routable IPv4 and IPv6 targets', () => {
    expect(isPublicIpAddress('1.1.1.1')).toBe(true);
    expect(isPublicIpAddress('2606:4700:4700::1111')).toBe(true);
  });

  it.each([
    'http://images.example/photo.jpg',
    'https://user:password@images.example/photo.jpg',
    'https://127.0.0.1/photo.jpg',
    'https://[::1]/photo.jpg',
    'https://localhost/photo.jpg',
    'not a URL',
  ])('rejects unsafe URL shape %s', (url) => {
    expect(() => parseSafeRemoteImageUrl(url)).toThrow();
  });

  it('accepts ordinary public HTTPS URL shape', () => {
    expect(parseSafeRemoteImageUrl('https://upload.wikimedia.org/a.jpg').hostname).toBe('upload.wikimedia.org');
  });

  it('validates every redirect target before connecting to it', async () => {
    const fetcher = new RemoteImageFetcherService();
    vi.spyOn(fetcher as any, 'resolvePublicAddress').mockResolvedValue('1.1.1.1');
    const request = vi.spyOn(fetcher as any, 'request')
      .mockResolvedValueOnce(response(302, { location: 'http://127.0.0.1/internal' }));

    await expect(fetcher.fetch('https://images.example/start.jpg')).rejects.toThrow('not an allowed public HTTPS target');
    expect(request).toHaveBeenCalledOnce();
  });

  it('follows a bounded valid redirect and returns the final image', async () => {
    const fetcher = new RemoteImageFetcherService();
    vi.spyOn(fetcher as any, 'resolvePublicAddress').mockResolvedValue('1.1.1.1');
    const request = vi.spyOn(fetcher as any, 'request')
      .mockResolvedValueOnce(response(302, { location: '/final.jpg' }))
      .mockResolvedValueOnce(response(200, { 'content-type': 'image/jpeg', 'content-length': '3' }, Buffer.from('jpg')));

    await expect(fetcher.fetch('https://images.example/start.jpg')).resolves.toEqual(Buffer.from('jpg'));
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('rejects redirect chains beyond the fixed limit', async () => {
    const fetcher = new RemoteImageFetcherService();
    vi.spyOn(fetcher as any, 'resolvePublicAddress').mockResolvedValue('1.1.1.1');
    vi.spyOn(fetcher as any, 'request').mockResolvedValue(response(302, { location: '/again.jpg' }));

    await expect(fetcher.fetch('https://images.example/start.jpg')).rejects.toThrow('redirect limit');
  });

  it.each(['text/html', 'application/octet-stream', 'image/svg+xml'])('rejects unexpected content type %s', async (contentType) => {
    const fetcher = new RemoteImageFetcherService();
    vi.spyOn(fetcher as any, 'resolvePublicAddress').mockResolvedValue('1.1.1.1');
    vi.spyOn(fetcher as any, 'request').mockResolvedValue(response(200, { 'content-type': contentType }));

    await expect(fetcher.fetch('https://images.example/photo')).rejects.toThrow('unsupported content type');
  });

  it('rejects oversized declared and streamed response bodies', async () => {
    const fetcher = new RemoteImageFetcherService();
    vi.spyOn(fetcher as any, 'resolvePublicAddress').mockResolvedValue('1.1.1.1');
    const request = vi.spyOn(fetcher as any, 'request')
      .mockResolvedValueOnce(response(200, {
        'content-type': 'image/png',
        'content-length': String(REMOTE_IMAGE_MAX_BYTES + 1),
      }))
      .mockResolvedValueOnce(response(200, { 'content-type': 'image/png' }, Buffer.alloc(REMOTE_IMAGE_MAX_BYTES + 1)));

    await expect(fetcher.fetch('https://images.example/declared.png')).rejects.toThrow('byte limit');
    await expect(fetcher.fetch('https://images.example/streamed.png')).rejects.toThrow('byte limit');
    expect(request).toHaveBeenCalledTimes(2);
  });
});
