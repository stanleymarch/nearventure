import 'reflect-metadata';
import { describe, it, expect, afterAll, vi } from 'vitest';
import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException, ForbiddenException, ValidationPipe, BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { RoutesController } from './routes.controller';
import { RoutesService } from './routes.service';
import { GpxService } from './gpx.service';
import { JwtStrategy } from '../auth/jwt.strategy';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { CreateRouteFromMapDto } from './dto/create-route-from-map.dto';
import type { ExecutionContext } from '@nestjs/common';

/**
 * Integration regression tests for the release-CRIT fix: PATCH/DELETE
 * /api/routes/:id must require a real admin JWT.
 *
 * The repo's vitest/esbuild setup does not emit decorator metadata, so
 * `Test.createTestingModule` DI cannot resolve constructor params (existing
 * specs construct services directly). These tests therefore exercise the
 * REAL security boundary: the real passport-jwt JwtStrategy + JwtAuthGuard +
 * AdminGuard chained on a request context, plus the guard metadata actually
 * attached to the controller handlers, plus the real ValidationPipe applied
 * to the POST /api/routes DTO.
 */

const TEST_JWT_SECRET = 'test-secret-for-routes-security-spec';

function makeContext(req: Record<string, any>): ExecutionContext {
  const res: any = {
    setHeader: vi.fn(),
    end: vi.fn(),
    writeHead: vi.fn(),
    getHeaders: () => ({}),
  };
  return {
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => res,
    }),
    getHandler: () => (() => {}),
    getClass: () => class RoutesController {},
  } as unknown as ExecutionContext;
}

describe('RoutesController — PATCH/DELETE admin authorization (integration)', () => {
  afterAll(() => {
    delete process.env.JWT_SECRET;
  });

  it('attaches JwtAuthGuard + AdminGuard to PATCH and DELETE handlers', () => {
    for (const method of ['updateRoute', 'deleteRoute'] as const) {
      const guards = Reflect.getMetadata('__guards__', RoutesController.prototype[method]) ?? [];
      expect(guards.map((g: any) => g.name)).toEqual(['JwtAuthGuard', 'AdminGuard']);
    }
  });

  describe('guard chain on a real passport-jwt strategy', () => {
    let jwt: JwtService;
    let jwtGuard: JwtAuthGuard;
    let authServiceMock: { validateJwtPayload: ReturnType<typeof vi.fn> };

    beforeAll(() => {
      process.env.JWT_SECRET = TEST_JWT_SECRET;
      jwt = new JwtService({ secret: TEST_JWT_SECRET });
      authServiceMock = {
        validateJwtPayload: vi.fn().mockResolvedValue({ id: 1, login: 'x' }),
      };
      // Constructing the strategy registers the 'jwt' strategy on the shared
      // passport singleton — the same mechanism Nest uses at bootstrap.
      new JwtStrategy(authServiceMock as any);
      jwtGuard = new JwtAuthGuard();
    });

    it('anonymous request → 401 (JwtAuthGuard rejects, no token)', async () => {
      const req: any = { headers: {} };
      const ctx = makeContext(req);
      await expect(jwtGuard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
    });

    it('forged/garbage token → 401', async () => {
      const req: any = { headers: { authorization: 'Bearer not-a-real-token' } };
      const ctx = makeContext(req);
      await expect(jwtGuard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
    });

    it('non-admin user → 403 (AdminGuard rejects despite valid JWT)', async () => {
      const users = { findOne: vi.fn(async () => ({ id: 42, role: 'user' })) };
      const adminGuard = new AdminGuard(users as any);
      const req: any = {
        headers: { authorization: `Bearer ${jwt.sign({ sub: 42, login: 'regular-user' })}` },
      };
      const ctx = makeContext(req);

      await expect(jwtGuard.canActivate(ctx)).resolves.toBe(true);
      expect(req.user).toEqual({ id: 42, login: 'regular-user' });

      await expect(adminGuard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
      expect(users.findOne).toHaveBeenCalledWith(42);
    });

    it('admin → 200-path allowed (both guards pass)', async () => {
      const users = { findOne: vi.fn(async () => ({ id: 1, role: 'admin' })) };
      const adminGuard = new AdminGuard(users as any);
      const req: any = {
        headers: { authorization: `Bearer ${jwt.sign({ sub: 1, login: 'boss' })}` },
      };
      const ctx = makeContext(req);

      await expect(jwtGuard.canActivate(ctx)).resolves.toBe(true);
      await expect(adminGuard.canActivate(ctx)).resolves.toBe(true);
      expect(users.findOne).toHaveBeenCalledWith(1);
    });
  });

  describe('POST /api/routes body hardening (CreateRouteFromMapDto)', () => {
    const pipe = new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    });

    it('accepts the exact frontend payload shape (no regression)', async () => {
      const body = {
        routeData: {
          geojson: { type: 'Feature', geometry: { type: 'LineString', coordinates: [[49.6, 58.6]] }, properties: {} },
          distance: 1200,
          duration: 480,
          ascend: 10,
          descend: 5,
        },
        pois: ['uuid-1', 'uuid-2'],
        profile: 'bike',
        options: { loop: false, optimize: false },
        title: 'Мой маршрут',
        startPoint: { lat: 58.6, lon: 49.6 },
        waypoints: [{ lat: 58.61, lon: 49.61 }],
      };
      const dto = plainToInstance(CreateRouteFromMapDto, body);
      expect(await validate(dto)).toHaveLength(0);
      const transformed = await pipe.transform(dto, {
        type: 'body',
        metatype: CreateRouteFromMapDto,
      } as any);
      expect(transformed).toBeInstanceOf(CreateRouteFromMapDto);
    });

    it('rejects an oversized pois array (DoS guard)', async () => {
      const dto = plainToInstance(CreateRouteFromMapDto, {
        pois: new Array(1001).fill('x'),
        profile: 'bike',
      });
      const errors = await validate(dto);
      expect(errors.map((e) => e.property)).toContain('pois');
      await expect(
        pipe.transform(dto, { type: 'body', metatype: CreateRouteFromMapDto } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects unknown fields via forbidNonWhitelisted', async () => {
      const dto = plainToInstance(CreateRouteFromMapDto, {
        pois: ['a'],
        adminOverride: true, // unknown field must not be silently accepted
      });
      await expect(
        pipe.transform(dto, { type: 'body', metatype: CreateRouteFromMapDto } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects an over-long title', async () => {
      const dto = plainToInstance(CreateRouteFromMapDto, { title: 'x'.repeat(201) });
      const errors = await validate(dto);
      expect(errors.map((e) => e.property)).toContain('title');
    });
  });
});
