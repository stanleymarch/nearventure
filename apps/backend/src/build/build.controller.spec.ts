import { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BuildModule } from './build.module';

const VALID_SHA = '0123456789abcdef0123456789abcdef01234567';
const originalGitSha = process.env.GIT_SHA;
let app: INestApplication;
let baseUrl: string;

beforeEach(async () => {
  app = await NestFactory.create(BuildModule, { logger: false });
  app.setGlobalPrefix('api');
  await app.listen(0);
  const address = app.getHttpServer().address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP listener');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
  await app.close();
  if (originalGitSha === undefined) delete process.env.GIT_SHA;
  else process.env.GIT_SHA = originalGitSha;
});

async function getBuild(gitSha: string | undefined) {
  if (gitSha === undefined) delete process.env.GIT_SHA;
  else process.env.GIT_SHA = gitSha;
  return fetch(`${baseUrl}/api/build`);
}

describe('GET /api/build', () => {
  it('returns only a canonical lowercase Git SHA and no-store', async () => {
    const response = await getBuild(VALID_SHA);

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ buildRevision: VALID_SHA });
  });

  it.each([undefined, 'abc123', 'A'.repeat(40), `${VALID_SHA}0`, ` ${VALID_SHA}`])
  ('returns only null for missing or invalid Git SHA %j', async (revision) => {
    const response = await getBuild(revision);

    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ buildRevision: null });
  });
});
