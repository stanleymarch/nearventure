// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { conflictSnapshot, createItinerary, getItinerary, getRouteImpact, itineraryCommand } from '@/api/itineraries';
import { useItineraryDraft } from '@/composables/useItineraryDraft';
import { NON_ROUTING_ITINERARY_DRAFT_COMMANDS, PUBLIC_ITINERARY_DRAFT_COMMANDS, ROUTING_CAPABLE_ITINERARY_DRAFT_COMMANDS } from '@/api/itinerary-draft-commands';

vi.mock('@/api/itineraries', async (load) => {
  const actual = await load<typeof import('@/api/itineraries')>();
  return { ...actual, createItinerary: vi.fn(), getItinerary: vi.fn(), getRouteImpact: vi.fn(), itineraryCommand: vi.fn(), commandId: vi.fn(() => 'cmd') };
});
const snapshot = (version = 1) => ({ id: 'draft', version, status: 'ready', start: { lat: 1, lon: 2 }, profile: 'foot', loop: true, budgetMode: 'whole_trip', budgetMinutes: 60, reserveMinutes: 5, places: [], totals: { travelMinutes: 10, stopMinutes: 20, reserveMinutes: 5, totalMinutes: 35, budgetMinutes: 60, feasible: true, overBudgetMinutes: 0, remainingMinutes: 25 }, warnings: [], suggestions: [] } as any);

describe('useItineraryDraft', () => {
  beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); });
  it('hydrates a server draft', async () => {
    vi.mocked(getItinerary).mockResolvedValue(snapshot(4));
    const state = useItineraryDraft();
    await state.hydrate('draft');
    expect(state.draft.value?.version).toBe(4);
    expect(getItinerary).toHaveBeenCalledWith('draft', expect.any(String), expect.any(AbortSignal));
  });
  it('uses the fresh snapshot from a stale 409 response', async () => {
    vi.mocked(createItinerary).mockResolvedValue(snapshot(1));
    vi.mocked(itineraryCommand).mockRejectedValue({ response: { status: 409, data: { error: { details: { snapshot: snapshot(3) } } } } });
    const state = useItineraryDraft(); await state.create({ start: { lat: 1, lon: 2 }, profile: 'foot', loop: true, budgetMinutes: 60 });
    await state.setLocked('place', true);
    expect(state.draft.value?.version).toBe(3);
    expect(state.error.value).toContain('свежая версия');
  });
  it('sends category choices as soft preferences to the canonical auto-fill command', async () => {
    vi.mocked(createItinerary).mockResolvedValue(snapshot(1));
    vi.mocked(itineraryCommand).mockResolvedValue(snapshot(2));
    const state = useItineraryDraft();
    await state.create({ start: { lat: 1, lon: 2 }, profile: 'foot', loop: true, budgetMinutes: 60 });
    await state.autoFill(['nature', 'museum'], 17, 'balanced');
    expect(itineraryCommand).toHaveBeenCalledWith(
      'draft',
      'auto-fill',
      expect.objectContaining({ preferredCategories: ['nature', 'museum'], seed: 17, preset: 'balanced' }),
      expect.any(String),
      expect.any(AbortSignal),
    );
  });
  it('blocks every routing-capable draft command while availability is known unavailable but keeps an existing route accessible', async () => {
    const existing = { ...snapshot(1), route: { distance: 1000, duration: 600, geojson: { type: 'Feature', geometry: null, properties: {} } } } as any;
    vi.mocked(getItinerary).mockResolvedValue(existing);
    const blocked = vi.fn();
    const state = useItineraryDraft();
    state.setRoutingGuard(() => false, blocked);
    await state.hydrate('draft');
    expect(state.draft.value?.route).toEqual(existing.route);

    for (const action of ROUTING_CAPABLE_ITINERARY_DRAFT_COMMANDS) await state.command(action);
    expect(blocked).toHaveBeenCalledTimes(ROUTING_CAPABLE_ITINERARY_DRAFT_COMMANDS.length);
    expect(itineraryCommand).not.toHaveBeenCalled();

    // Non-routing edits of the already accessible route remain available.
    vi.mocked(itineraryCommand).mockResolvedValue(snapshot(2));
    await state.setLocked('place', true);
    expect(itineraryCommand).toHaveBeenCalledWith('draft', 'set-locked', expect.any(Object), expect.any(String), expect.any(AbortSignal));
  });

  it('covers every public controller command with an explicit routing capability classification', () => {
    const controller = readFileSync(resolve(process.cwd(), '../backend/src/itineraries/itinerary.controller.ts'), 'utf8');
    const publicCommands = [...controller.matchAll(/@Post\(':id\/commands\/([^']+)'\)/g)].map((match) => match[1]);
    const classifiedCommands = [
      ...ROUTING_CAPABLE_ITINERARY_DRAFT_COMMANDS,
      ...NON_ROUTING_ITINERARY_DRAFT_COMMANDS,
    ];

    expect(PUBLIC_ITINERARY_DRAFT_COMMANDS).toEqual(publicCommands);
    expect(new Set(classifiedCommands).size).toBe(classifiedCommands.length);
    expect(new Set(classifiedCommands)).toEqual(new Set(PUBLIC_ITINERARY_DRAFT_COMMANDS));
    expect(ROUTING_CAPABLE_ITINERARY_DRAFT_COMMANDS).toEqual(expect.arrayContaining(['regenerate', 'publish']));
  });

  it('loads route impact without mutating or versioning the draft', async () => {
    vi.mocked(createItinerary).mockResolvedValue({ ...snapshot(1), route: { distance: 1000 } } as any);
    vi.mocked(getRouteImpact).mockResolvedValue([{ poiId: 'poi', available: true }] as any);
    const state = useItineraryDraft();
    await state.create({ start: { lat: 1, lon: 2 }, profile: 'foot', loop: true, budgetMinutes: 60 });
    const before = state.draft.value;
    expect(await state.routeImpact(['poi'])).toEqual([{ poiId: 'poi', available: true }]);
    expect(state.draft.value).toBe(before);
    expect(getRouteImpact).toHaveBeenCalledWith('draft', ['poi'], expect.any(String), expect.any(AbortSignal));
    expect(itineraryCommand).not.toHaveBeenCalled();
  });

  it('reads the filtered conflict wire shape and legacy snapshots', () => {
    expect(conflictSnapshot({ status: 409, details: { snapshot: snapshot(2) } })?.version).toBe(2);
    expect(conflictSnapshot({ response: { status: 409, data: { error: { details: { snapshot: snapshot(3) } } } } })?.version).toBe(3);
    expect(conflictSnapshot({ response: { status: 409, data: { details: { snapshot: snapshot(4) } } } })?.version).toBe(4);
    expect(conflictSnapshot({ response: { status: 409, data: { snapshot: snapshot(5) } } })?.version).toBe(5);
    expect(conflictSnapshot({ status: 400, details: { snapshot: snapshot(6) } })).toBeNull();
  });
  it('cancels the stale hydration request', async () => {
    const signals: AbortSignal[] = [];
    vi.mocked(getItinerary).mockImplementation((_id, _owner, signal) => new Promise((_resolve, reject) => { signals.push(signal!); signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))); }));
    const state = useItineraryDraft(); void state.hydrate('one'); void state.hydrate('two');
    expect(signals[0].aborted).toBe(true);
  });

  it('ignores a late response even when the transport resolves after abort', async () => {
    let resolveFirst!: (value: any) => void;
    let resolveSecond!: (value: any) => void;
    vi.mocked(createItinerary)
      .mockImplementationOnce(() => new Promise(resolve => { resolveFirst = resolve; }))
      .mockImplementationOnce(() => new Promise(resolve => { resolveSecond = resolve; }));
    const state = useItineraryDraft();
    const first = state.create({ start: { lat: 1, lon: 2 }, profile: 'foot', loop: true, budgetMinutes: 60 });
    const second = state.create({ start: { lat: 1, lon: 2 }, profile: 'bike', loop: false, budgetMinutes: 90 });
    resolveSecond(snapshot(2));
    await second;
    resolveFirst(snapshot(1));
    await first;
    expect(state.draft.value?.version).toBe(2);
  });
});
