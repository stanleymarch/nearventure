import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';

type Next = (error?: unknown) => void;

const PMTILES_MIME_TYPE = 'application/vnd.pmtiles';

function isPathInside(directory: string, filePath: string): boolean {
  const pathFromDirectory = relative(directory, filePath);
  return pathFromDirectory !== '' && !pathFromDirectory.startsWith('..') && !isAbsolute(pathFromDirectory);
}

function parseRange(range: string | undefined, size: number): { start: number; end: number } | null {
  if (!range) return { start: 0, end: size - 1 };

  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match) return null;

  const [, startValue, endValue] = match;
  if (!startValue && !endValue) return null;

  if (!startValue) {
    const suffixLength = Number(endValue);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return null;
    return { start: Math.max(size - suffixLength, 0), end: size - 1 };
  }

  const start = Number(startValue);
  const end = endValue ? Number(endValue) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) return null;

  return { start, end: Math.min(end, size - 1) };
}

/**
 * Serve PMTiles archives directly during Vite development. PMTiles clients use
 * byte-range requests, so this must sit ahead of Vite's SPA fallback.
 */
export function createPmtilesStaticMiddleware(directory: string) {
  const tilesDirectory = resolve(directory);

  return (req: IncomingMessage, res: ServerResponse, next: Next) => {
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (!pathname.startsWith('/tiles/')) {
      next();
      return;
    }

    let requestedPath: string;
    try {
      requestedPath = decodeURIComponent(pathname.slice('/tiles/'.length));
    } catch {
      res.statusCode = 404;
      res.end();
      return;
    }

    const filePath = resolve(tilesDirectory, requestedPath);
    if (!requestedPath.endsWith('.pmtiles') || !isPathInside(tilesDirectory, filePath)) {
      res.statusCode = 404;
      res.end();
      return;
    }

    void stat(filePath).then((file) => {
      if (!file.isFile()) {
        res.statusCode = 404;
        res.end();
        return;
      }

      const range = parseRange(req.headers.range, file.size);
      if (!range) {
        res.statusCode = 416;
        res.setHeader('Content-Range', `bytes */${file.size}`);
        res.end();
        return;
      }

      const { start, end } = range;
      const partial = Boolean(req.headers.range);
      res.statusCode = partial ? 206 : 200;
      res.setHeader('Content-Type', PMTILES_MIME_TYPE);
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Content-Length', end - start + 1);
      if (partial) res.setHeader('Content-Range', `bytes ${start}-${end}/${file.size}`);
      if (req.method === 'HEAD') {
        res.end();
        return;
      }

      createReadStream(filePath, { start, end })
        .on('error', () => {
          if (!res.headersSent) res.statusCode = 500;
          res.end();
        })
        .pipe(res);
    }).catch(() => {
      // Do not call Vite's fallback: a missing archive must be a real 404.
      res.statusCode = 404;
      res.end();
    });
  };
}

export function pmtilesStaticPlugin(directory: string): Plugin {
  return {
    name: 'nearventure-pmtiles-static',
    configureServer(server) {
      server.middlewares.use(createPmtilesStaticMiddleware(directory));
    },
  };
}
