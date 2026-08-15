import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { getMetadataArgsStorage } from 'typeorm';
import { describe, expect, it } from 'vitest';
import { CreateItineraryDto } from './dto/create-itinerary.dto';
import { AutoFillCommandDto, SetVisitModeCommandDto, UpdateSettingsCommandDto } from './dto/itinerary-command.dto';
import { ItineraryCommandEntity } from './entities/itinerary-command.entity';
import { ItineraryDraftEntity } from './entities/itinerary-draft.entity';
import { ItineraryOwnerService } from './itinerary-owner.service';
import { ItineraryDraftService } from './itinerary-draft.service';

describe('itinerary transport and persistence contract', () => {
  it('validates nested coordinates, budget, command UUID and custom minutes', async () => {
    const invalidCreate = plainToInstance(CreateItineraryDto, { start: { lat: 91, lon: 49 }, profile: 'plane', loop: 'yes', budgetMinutes: 0 });
    expect((await validate(invalidCreate)).map((error) => error.property).sort()).toEqual(['budgetMinutes', 'loop', 'profile', 'start']);
    const invalidCommand = plainToInstance(SetVisitModeCommandDto, { expectedVersion: 0, commandId: 'retry', placeId: 'p', mode: 'custom', customVisitMinutes: 481 });
    expect((await validate(invalidCommand)).map((error) => error.property).sort()).toEqual(['commandId', 'customVisitMinutes', 'expectedVersion']);
    const missingCustom = plainToInstance(SetVisitModeCommandDto, { expectedVersion: 1, commandId: '00000000-0000-4000-8000-000000000001', placeId: 'p', mode: 'custom' });
    expect((await validate(missingCustom)).map((error) => error.property)).toContain('customVisitMinutes');
    const forbiddenCustom = plainToInstance(SetVisitModeCommandDto, { expectedVersion: 1, commandId: '00000000-0000-4000-8000-000000000002', placeId: 'p', mode: 'visit', customVisitMinutes: 10 });
    expect((await validate(forbiddenCustom)).map((error) => error.property)).toContain('customVisitMinutes');
  });

  it('accepts an unlimited draft without a hidden time budget but requires one for limited modes', async () => {
    const unlimited = plainToInstance(CreateItineraryDto, {
      start: { lat: 58.6, lon: 49.6 }, profile: 'bike', loop: true, budgetMode: 'unlimited',
    });
    expect(await validate(unlimited)).toHaveLength(0);
    const limitedWithoutBudget = plainToInstance(CreateItineraryDto, {
      start: { lat: 58.6, lon: 49.6 }, profile: 'bike', loop: true, budgetMode: 'whole_trip',
    });
    expect((await validate(limitedWithoutBudget)).map((error) => error.property)).toContain('budgetMinutes');
  });

  it('accepts explicit intent, stop pace and soft category preferences', async () => {
    const create = plainToInstance(CreateItineraryDto, {
      start: { lat: 58.6, lon: 49.6 }, profile: 'bike', loop: true, intent: 'destination', stopPace: 'quick', budgetMode: 'whole_trip', budgetMinutes: 60,
    });
    expect(await validate(create)).toHaveLength(0);
    const invalidIntent = plainToInstance(CreateItineraryDto, {
      start: { lat: 58.6, lon: 49.6 }, profile: 'bike', loop: true, intent: 'teleport', stopPace: 'slow', budgetMinutes: 60,
    });
    expect((await validate(invalidIntent)).map((error) => error.property).sort()).toEqual(['intent', 'stopPace']);
    const preferences = plainToInstance(AutoFillCommandDto, {
      expectedVersion: 1, commandId: '00000000-0000-4000-8000-000000000003', preferredCategories: ['nature', 'museum'],
    });
    expect(await validate(preferences)).toHaveLength(0);
    const update = plainToInstance(UpdateSettingsCommandDto, {
      expectedVersion: 1, commandId: '00000000-0000-4000-8000-000000000004', stopPace: 'pass_by', finish: { lat: 58.61, lon: 49.61 },
    });
    expect(await validate(update)).toHaveLength(0);
    const clearFinish = plainToInstance(UpdateSettingsCommandDto, {
      expectedVersion: 1, commandId: '00000000-0000-4000-8000-000000000005', finish: null,
    });
    expect(await validate(clearFinish)).toHaveLength(0);
    const invalidFinish = plainToInstance(UpdateSettingsCommandDto, {
      expectedVersion: 1, commandId: '00000000-0000-4000-8000-000000000006', finish: { lat: 91, lon: 49.61 },
    });
    expect((await validate(invalidFinish)).map((error) => error.property)).toContain('finish');
  });

  it('declares JSONB snapshot columns and the intended table names', () => {
    const metadata = getMetadataArgsStorage();
    expect(metadata.tables.find((table) => table.target === ItineraryDraftEntity)?.name).toBe('itinerary_draft');
    expect(metadata.tables.find((table) => table.target === ItineraryCommandEntity)?.name).toBe('itinerary_command');
    expect(metadata.columns.find((column) => column.target === ItineraryDraftEntity && column.propertyName === 'state')?.options.type).toBe('jsonb');
    expect(metadata.columns.find((column) => column.target === ItineraryCommandEntity && column.propertyName === 'resultSnapshot')?.options.type).toBe('jsonb');
  });

  it('reads legacy JSONB state without additive quality data', () => {
    const legacy = {
      status: 'ready', start: { lat: 58.6, lon: 49.6 }, profile: 'bike', loop: true,
      preset: 'balanced', budgetMode: 'whole_trip', budgetMinutes: 60, reserveMinutes: 0,
      places: [], warnings: [], suggestions: [], additions: [], replacements: [],
      totals: { travelMinutes: 0, stopMinutes: 0, reserveMinutes: 0, totalMinutes: 0, budgetMinutes: 60, feasible: true, overBudgetMinutes: 0, remainingMinutes: 60 },
    };
    const normalized = (ItineraryDraftService.prototype as any).withoutHistory.call({}, JSON.parse(JSON.stringify(legacy)));
    expect(normalized.quality).toBeUndefined();
    expect(normalized.intent).toBe('auto_budget');
    expect(normalized.stopPace).toBe('quick');
  });

  it('keeps legacy child JSONB valid and serializes additive headline metadata', () => {
    const legacyState = {
      status: 'ready', start: { lat: 58.6, lon: 49.6 }, profile: 'foot', loop: true,
      preset: 'balanced', budgetMode: 'whole_trip', budgetMinutes: 60, reserveMinutes: 0,
      places: [{
        id: 'legacy-place', name: 'Legacy', center: { lat: 58.6, lon: 49.6 },
        pois: [{ id: 'legacy-poi', name: 'Legacy', category: 'sights', lat: 58.6, lon: 49.6, included: true, estimatedVisitMinutes: 0 }],
        visitMode: 'visit', dwellMinutes: 0, arrivalOverheadMinutes: 0, source: 'manual', locked: false, clusterConfidence: 'manual',
      }], warnings: [], suggestions: [], additions: [], replacements: [],
      totals: { travelMinutes: 0, stopMinutes: 0, reserveMinutes: 0, totalMinutes: 0, budgetMinutes: 60, feasible: true, overBudgetMinutes: 0, remainingMinutes: 60 },
    };
    const legacy = (ItineraryDraftService.prototype as any).withoutHistory.call({}, JSON.parse(JSON.stringify(legacyState)));
    expect(legacy.places[0].pois[0]).not.toHaveProperty('notable');
    const current = {
      ...legacy,
      places: [{ ...legacy.places[0], name: 'Headline', pois: [
        { ...legacy.places[0].pois[0], notable: false },
        { id: 'headline-poi', name: 'Headline', category: 'museum', lat: 58.6001, lon: 49.6001, included: true, estimatedVisitMinutes: 0, featured: true, popularityScore: 10, notable: true },
      ] }],
    };
    expect(JSON.parse(JSON.stringify(current)).places[0]).toMatchObject({
      name: 'Headline', pois: [
        { id: 'legacy-poi', notable: false },
        { id: 'headline-poi', featured: true, popularityScore: 10, notable: true },
      ],
    });
  });

  it('isolates opaque browser and trusted Telegram owner namespaces', () => {
    const owners = new ItineraryOwnerService();
    expect(owners.fromClientId('anonymous_123').key).toBe('client:anonymous_123');
    expect(owners.forTelegramUser(123).key).toBe('tg:123');
    expect(() => owners.fromClientId('short')).toThrow('required');
    const verified = new ItineraryOwnerService({ validate: () => ({ user: { id: 456 } }) } as any);
    expect(verified.resolve('anonymous_123', 'opaque-init-data')).toEqual({ key: 'tg:456', kind: 'telegram' });
    expect(() => new ItineraryOwnerService({ validate: () => null } as any).resolve('anonymous_123', 'bad')).toThrow('Invalid Telegram');
  });
});
