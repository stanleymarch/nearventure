import { createServer } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createPmtilesStaticMiddleware } from '../../vite.pmtiles-dev';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function createTileServer() {
  const directory = await mkdtemp(join(tmpdir(), 'nearventure-pmtiles-'));
  temporaryDirectories.push(directory);
  await writeFile(join(directory, 'local.pmtiles'), Buffer.from('PMTiles\x03test-archive'));

  const middleware = createPmtilesStaticMiddleware(directory);
  const server = createServer((request, response) => {
    middleware(request, response, () => {
      response.statusCode = 404;
      response.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected a TCP test server');

  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

describe('PMTiles Vite development mount', () => {
  it('serves the configured archive as binary and supports byte ranges', async () => {
    const server = await createTileServer();
    try {
      const response = await fetch(`${server.url}/tiles/local.pmtiles`, { headers: { Range: 'bytes=0-6' } });
      expect(response.status).toBe(206);
      expect(response.headers.get('content-type')).toBe('application/vnd.pmtiles');
      expect(response.headers.get('content-range')).toBe('bytes 0-6/20');
      expect(Buffer.from(await response.arrayBuffer()).toString()).toBe('PMTiles');
    } finally {
      await server.close();
    }
  });

  it('returns a real 404 for an absent archive instead of an SPA document', async () => {
    const server = await createTileServer();
    try {
      const response = await fetch(`${server.url}/tiles/missing.pmtiles`);
      expect(response.status).toBe(404);
      expect(response.headers.get('content-type')).not.toBe('text/html');
      expect(await response.text()).toBe('');
    } finally {
      await server.close();
    }
  });
});
