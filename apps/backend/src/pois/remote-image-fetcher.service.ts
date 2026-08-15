import { Injectable } from '@nestjs/common';
import { lookup } from 'node:dns/promises';
import * as https from 'node:https';
import { isIP } from 'node:net';
import type { IncomingMessage } from 'node:http';

export const REMOTE_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
export const REMOTE_IMAGE_TIMEOUT_MS = 10_000;
export const REMOTE_IMAGE_MAX_REDIRECTS = 3;

const ALLOWED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
]);

function ipv4ToNumber(address: string): number | null {
  const octets = address.split('.');
  if (octets.length !== 4 || octets.some((part) => !/^\d+$/.test(part))) return null;
  const values = octets.map(Number);
  if (values.some((part) => part < 0 || part > 255)) return null;
  return (((values[0] << 24) >>> 0) + (values[1] << 16) + (values[2] << 8) + values[3]) >>> 0;
}

function inIpv4Range(value: number, base: number, prefix: number): boolean {
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (value & mask) === (base & mask);
}

function ipv6ToBytes(address: string): number[] | null {
  let value = address.toLowerCase();
  if (value.includes('%')) return null;
  if (value.startsWith('[') && value.endsWith(']')) value = value.slice(1, -1);
  const doubleColon = value.indexOf('::');
  if (doubleColon !== value.lastIndexOf('::')) return null;

  let parts = value.split(':');
  if (parts[parts.length - 1]?.includes('.')) {
    const ipv4 = ipv4ToNumber(parts[parts.length - 1]);
    if (ipv4 === null) return null;
    parts.splice(parts.length - 1, 1, ((ipv4 >>> 16) & 0xffff).toString(16), (ipv4 & 0xffff).toString(16));
  }
  if (doubleColon >= 0) {
    const present = parts.filter(Boolean).length;
    if (present > 7) return null;
    const zeroes = Array(8 - present).fill('0');
    const index = parts.indexOf('');
    parts.splice(index, parts.filter((part) => part === '').length, ...zeroes);
  }
  if (parts.length !== 8 || parts.some((part) => !/^[0-9a-f]{1,4}$/.test(part))) return null;
  return parts.flatMap((part) => {
    const value = Number.parseInt(part, 16);
    return [(value >> 8) & 0xff, value & 0xff];
  });
}

function inIpv6Range(bytes: number[], prefix: number[]): boolean {
  return prefix.every((value, index) => value === undefined || bytes[index] === value);
}

/** True only for globally routable address literals. */
export function isPublicIpAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const value = ipv4ToNumber(address);
    if (value === null) return false;
    const blocked: Array<[number, number]> = [
      [0x00000000, 8], [0x0a000000, 8], [0x64400000, 10], [0x7f000000, 8],
      [0xa9fe0000, 16], [0xac100000, 12], [0xc0000000, 24], [0xc0000200, 24],
      [0xc01fc400, 24], [0xc034c100, 24], [0xc0586300, 24], [0xc0a80000, 16],
      [0xc0af3000, 24], [0xc6120000, 15],
      [0xc6336400, 24], [0xcb007100, 24], [0xe0000000, 4], [0xf0000000, 4],
    ];
    return !blocked.some(([base, prefix]) => inIpv4Range(value, base, prefix));
  }
  if (family !== 6) return false;
  const bytes = ipv6ToBytes(address);
  if (!bytes) return false;
  // IPv4-compatible/mapped IPv6 addresses are evaluated using their IPv4 target.
  if (bytes.slice(0, 10).every((part) => part === 0) &&
      ((bytes[10] === 0 && bytes[11] === 0) || (bytes[10] === 0xff && bytes[11] === 0xff))) {
    return isPublicIpAddress(bytes.slice(12).join('.'));
  }
  const blocked: number[][] = [
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], // ::
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1], // ::1
    [0, 0x64, 0xff, 0x9b, 0, 0, 0, 0, 0, 0, 0, 0], // 64:ff9b::/96
    [0, 0x64, 0xff, 0x9b, 0, 1], // 64:ff9b:1::/48
    [1, 0, 0, 0, 0, 0, 0, 0], // 100::/64
    [0x20, 0x01, 0x0d, 0xb8], // documentation 2001:db8::/32
    [0x20, 0x02], // 6to4
    [0xff], // multicast
  ];
  if (bytes[0] === 0xfc || bytes[0] === 0xfd ||
      (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) ||
      (bytes[0] === 0x20 && bytes[1] === 0x01 && (bytes[2] & 0xfe) === 0)) return false; // 2001::/23
  return !blocked.some((prefix) => inIpv6Range(bytes, prefix));
}

/** Rejects URL shapes that can bypass remote-image SSRF policy before DNS. */
export function parseSafeRemoteImageUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('remote image URL is invalid');
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (url.protocol !== 'https:' || url.username || url.password || !hostname ||
      isIP(hostname) || hostname === 'localhost' || hostname.endsWith('.localhost')) {
    throw new Error('remote image URL is not an allowed public HTTPS target');
  }
  return url;
}

@Injectable()
export class RemoteImageFetcherService {
  async fetch(url: string): Promise<Buffer> {
    const deadline = Date.now() + REMOTE_IMAGE_TIMEOUT_MS;
    let target = parseSafeRemoteImageUrl(url);

    for (let redirects = 0; redirects <= REMOTE_IMAGE_MAX_REDIRECTS; redirects += 1) {
      const address = await this.withDeadline(this.resolvePublicAddress(target.hostname), deadline);
      const response = await this.withDeadline(this.request(target, address, deadline), deadline);
      const status = response.statusCode ?? 0;
      if (status >= 300 && status < 400) {
        const location = response.headers.location;
        response.resume();
        if (!location) throw new Error('remote image redirect has no Location header');
        if (redirects === REMOTE_IMAGE_MAX_REDIRECTS) throw new Error('remote image redirect limit exceeded');
        target = parseSafeRemoteImageUrl(new URL(location, target).toString());
        continue;
      }
      if (status < 200 || status >= 300) {
        response.resume();
        throw new Error(`remote image returned ${status}`);
      }
      return this.readImageBody(response, deadline);
    }
    throw new Error('remote image redirect limit exceeded');
  }

  private withDeadline<T>(work: Promise<T>, deadline: number): Promise<T> {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return Promise.reject(new Error('remote image request timed out'));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('remote image request timed out')), remaining);
      work.then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
    });
  }

  protected async resolvePublicAddress(hostname: string): Promise<string> {
    const records = await lookup(hostname, { all: true, verbatim: true });
    if (!records.length || records.some((record) => !isPublicIpAddress(record.address))) {
      throw new Error('remote image host does not resolve exclusively to public addresses');
    }
    return records[0].address;
  }

  protected request(target: URL, address: string, deadline: number): Promise<IncomingMessage> {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return Promise.reject(new Error('remote image request timed out'));
    return new Promise((resolve, reject) => {
      const request = https.request({
        protocol: 'https:',
        hostname: target.hostname,
        port: target.port || 443,
        path: `${target.pathname}${target.search}`,
        method: 'GET',
        headers: { 'User-Agent': 'Nearventure/1.0 (route planner; tg @staniverse)', Accept: 'image/*' },
        servername: target.hostname,
        lookup: (_hostname, _options, callback) => callback(null, address, isIP(address)),
      }, resolve);
      request.setTimeout(remaining, () => request.destroy(new Error('remote image request timed out')));
      request.once('error', reject);
      request.end();
    });
  }

  protected readImageBody(response: IncomingMessage, deadline: number): Promise<Buffer> {
    const contentType = response.headers['content-type']?.split(';', 1)[0].trim().toLowerCase();
    if (!contentType || !ALLOWED_IMAGE_TYPES.has(contentType)) {
      response.resume();
      return Promise.reject(new Error('remote image has an unsupported content type'));
    }
    const declared = Number(response.headers['content-length']);
    if (Number.isFinite(declared) && (declared < 0 || declared > REMOTE_IMAGE_MAX_BYTES)) {
      response.resume();
      return Promise.reject(new Error('remote image exceeds byte limit'));
    }
    return new Promise((resolve, reject) => {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        response.destroy();
        reject(new Error('remote image request timed out'));
        return;
      }
      const timer = setTimeout(() => {
        response.destroy();
        reject(new Error('remote image request timed out'));
      }, remaining);
      const done = (callback: () => void) => {
        clearTimeout(timer);
        callback();
      };
      const chunks: Buffer[] = [];
      let size = 0;
      response.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > REMOTE_IMAGE_MAX_BYTES) {
          response.destroy();
          done(() => reject(new Error('remote image exceeds byte limit')));
          return;
        }
        chunks.push(Buffer.from(chunk));
      });
      response.once('error', (error) => done(() => reject(error)));
      response.once('end', () => done(() => resolve(Buffer.concat(chunks))));
    });
  }
}
