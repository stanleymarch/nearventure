import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  RouteRequestDto,
  PlanRequestDto,
  MAX_ROUTE_POINTS,
  MAX_PLAN_WAYPOINTS,
} from './routing.dto';

/**
 * DoS guards (release-CRIT): client-supplied coordinate arrays are capped
 * before anything is serialized/forwarded to GraphHopper. Oversize arrays
 * must fail DTO validation (the global pipe turns this into a 400).
 */

const point = (i: number) => ({ lon: 49.6 + i / 1000, lat: 58.6 + i / 1000 });

describe('RouteRequestDto.points cap', () => {
  it('accepts up to MAX_ROUTE_POINTS points', async () => {
    const dto = plainToInstance(RouteRequestDto, {
      points: Array.from({ length: MAX_ROUTE_POINTS }, (_, i) => point(i)),
      profile: 'bike',
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects more than MAX_ROUTE_POINTS points', async () => {
    const dto = plainToInstance(RouteRequestDto, {
      points: Array.from({ length: MAX_ROUTE_POINTS + 1 }, (_, i) => point(i)),
      profile: 'bike',
    });
    const errors = await validate(dto);
    expect(errors.map((e) => e.property)).toContain('points');
  });

  it('still requires at least 2 points', async () => {
    const dto = plainToInstance(RouteRequestDto, {
      points: [point(0)],
      profile: 'bike',
    });
    const errors = await validate(dto);
    expect(errors.map((e) => e.property)).toContain('points');
  });
});

describe('PlanRequestDto.waypoints cap', () => {
  it('accepts up to MAX_PLAN_WAYPOINTS waypoints', async () => {
    const dto = plainToInstance(PlanRequestDto, {
      start: point(0),
      waypoints: Array.from({ length: MAX_PLAN_WAYPOINTS }, (_, i) => point(i)),
      profile: 'foot',
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects more than MAX_PLAN_WAYPOINTS waypoints', async () => {
    const dto = plainToInstance(PlanRequestDto, {
      start: point(0),
      waypoints: Array.from({ length: MAX_PLAN_WAYPOINTS + 1 }, (_, i) => point(i)),
      profile: 'foot',
    });
    const errors = await validate(dto);
    expect(errors.map((e) => e.property)).toContain('waypoints');
  });
});
