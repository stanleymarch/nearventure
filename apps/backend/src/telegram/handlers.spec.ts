import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Bot } from 'grammy';
import type { Update } from 'grammy/types';
import { registerStartHandlers } from './start.handler';
import { registerRouteHandlers } from './route.handler';
import { registerNearbyHandlers } from './nearby.handler';
import { registerGuideHandlers } from './guide.handler';
import { registerInlineHandlers } from './inline.handler';
import { SessionService } from './session.service';
import { freshSession, type BotSession } from './session';
import { TelegramUserService } from './telegram-user.service';
import { RouteBuilderService } from './route-builder.service';
import { TelegramPoiCardService } from './poi-card.service';
import { LastRouteService } from './last-route.service';
import { BotRateLimiter } from './rate-limiter';
import { ItineraryDraftService } from '../itineraries/itinerary-draft.service';
import { ItineraryOwnerService } from '../itineraries/itinerary-owner.service';
import { PoisService, type PoiRow } from '../pois/pois.service';
import { AnalyticsService } from '../analytics/analytics.service';
import type { BotContext } from './types';
import { CB } from './keyboards';

// ─────────────────────────────────────────────────────────────────────
// Test harness
// ─────────────────────────────────────────────────────────────────────
//
// Each test wires up:
//   • a real grammy Bot instance with a fake token (so .handleUpdate
//     and regex matching work as in production);
//   • the handler set we want to exercise;
//   • mocks for the services the handlers depend on;
//   • a spy `api` object so we can assert which Telegram API calls
//     the handler made (reply / editMessageText / sendLocation / etc.).
//
// The bot's update path is exercised via bot.handleUpdate(update) which
// is exactly what the Telegram controller does in production, so we
// get realistic coverage of the callback_regex and message:* wiring.

const CHAT_ID = 4242;
const USER_ID = 1001;
const FAKE_BOT_TOKEN = '123:fake-token-for-tests';

function makeUserService() {
  return {
    touch: vi.fn().mockResolvedValue(undefined),
    incrementRoutes: vi.fn().mockResolvedValue(undefined),
    incrementGpx: vi.fn().mockResolvedValue(undefined),
  } as unknown as TelegramUserService;
}

function makePois(overrides: Partial<{
  list: ReturnType<typeof vi.fn>;
  count: ReturnType<typeof vi.fn>;
  byId: ReturnType<typeof vi.fn>;
}> = {}): PoisService {
  return {
    list: overrides.list ?? vi.fn().mockResolvedValue({ items: [], total: 0 }),
    count: overrides.count ?? vi.fn().mockResolvedValue({ total: 42 }),
    byId: overrides.byId ?? vi.fn(),
  } as unknown as PoisService;
}

function makeAnalyticsEmpty(): AnalyticsService {
  return { record: vi.fn().mockResolvedValue(undefined) } as unknown as AnalyticsService;
}

function makeSessionService(): SessionService {
  // SessionService is normally constructed with a user service (for touch()).
  // We pass a stubbed one.
  return new SessionService(makeUserService() as any);
}

function makePoiCardService(): TelegramPoiCardService {
  return { sendPoiCard: vi.fn().mockResolvedValue(undefined) } as unknown as TelegramPoiCardService;
}

function makeBuilder(overrides: Partial<{
  buildAuto: ReturnType<typeof vi.fn>;
  buildGpx: ReturnType<typeof vi.fn>;
}> = {}): RouteBuilderService {
  return {
    buildAuto: overrides.buildAuto ?? vi.fn(),
    buildGpx: overrides.buildGpx ?? vi.fn().mockReturnValue('<gpx/>'),
  } as unknown as RouteBuilderService;
}

function makeLastRoute(): LastRouteService {
  return {
    set: vi.fn().mockResolvedValue(undefined),
    clear: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockResolvedValue(null),
  } as unknown as LastRouteService;
}

function routeDraft(version = 2) {
  return {
    id: 'draft-1', version, status: 'ready', start: { lat: 58.6, lon: 49.6 },
    profile: 'foot', loop: true, preset: 'balanced', budgetMode: 'whole_trip', budgetMinutes: 60, reserveMinutes: 5,
    places: [
      { id: 'place-1', name: 'Church', visitMode: 'quick', dwellMinutes: 5, arrivalOverheadMinutes: 0, source: 'auto', locked: false, pois: [{ id: 'p1', name: 'Church', lat: 1, lon: 1, category: 'religion', included: true, estimatedVisitMinutes: 5 }] },
      { id: 'place-2', name: 'Museum', visitMode: 'quick', dwellMinutes: 5, arrivalOverheadMinutes: 0, source: 'auto', locked: false, pois: [{ id: 'p2', name: 'Museum', lat: 1.1, lon: 1.1, category: 'museum', included: true, estimatedVisitMinutes: 5 }] },
    ],
    route: { geojson: { type: 'Feature', geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] }, properties: {} }, distance: 5000, duration: 1800, ascend: 50, descend: 50, profile: 'foot' },
    totals: { travelMinutes: 30, stopMinutes: 10, reserveMinutes: 5, totalMinutes: 45, budgetMinutes: 60, feasible: true, overBudgetMinutes: 0, remainingMinutes: 15 },
    warnings: [], suggestions: [], createdAt: '2026-01-01T00:00:00.000Z', expiresAt: '2026-01-02T00:00:00.000Z',
  };
}

function malformedGuideDraft(version = 3) {
  const draft = routeDraft(version);
  draft.places[0].pois.push({
    id: 'broken-child', name: 'Broken', category: 'religion',
    lat: Number.NaN, lon: 49.6, included: true, estimatedVisitMinutes: 5,
  });
  return draft;
}

function makeDraftService(overrides: Partial<{ create: ReturnType<typeof vi.fn>; autoFill: ReturnType<typeof vi.fn>; regenerate: ReturnType<typeof vi.fn>; get: ReturnType<typeof vi.fn>; applySmartFix: ReturnType<typeof vi.fn> }> = {}): ItineraryDraftService {
  return {
    create: overrides.create ?? vi.fn().mockResolvedValue(routeDraft(1)),
    autoFill: overrides.autoFill ?? vi.fn().mockResolvedValue(routeDraft(2)),
    regenerate: overrides.regenerate ?? vi.fn().mockResolvedValue(routeDraft(3)),
    get: overrides.get ?? vi.fn().mockResolvedValue(routeDraft(2)),
    applySmartFix: overrides.applySmartFix ?? vi.fn().mockResolvedValue(routeDraft(3)),
  } as unknown as ItineraryDraftService;
}

function makeOwnerService(): ItineraryOwnerService {
  return { forTelegramUser: vi.fn().mockReturnValue({ key: `tg:${USER_ID}` }) } as unknown as ItineraryOwnerService;
}

function makeBot() {
  const calls: Array<{ method: string; payload: any; signal?: AbortSignal }> = [];
  const responses: Record<string, unknown> = {
    sendMessage: { message_id: 1 },
    editMessageText: true,
    editMessageReplyMarkup: true,
    answerCallbackQuery: true,
    deleteMessage: true,
    sendLocation: { message_id: 2 },
    sendChatAction: true,
    sendDocument: { message_id: 3 },
    setMyCommands: true,
    answerInlineQuery: true,
  };
  // Pass a fake botInfo so the bot doesn't try to call getMe() at startup.
  const bot = new Bot<BotContext>(FAKE_BOT_TOKEN, {
    botInfo: { id: 1, username: 'nearventure_test_bot', is_bot: true, first_name: 'NV' },
  });
  // Intercept every API call. We record (method, payload) and return a
  // canned { ok: true, result } so the bot thinks Telegram accepted it.
  // Tests assert on `bot.calls` to verify which methods were invoked
  // and with which arguments.
  bot.api.config.use(async (_prev, method, payload, signal) => {
    calls.push({ method, payload, signal });
    return { ok: true, result: responses[method] ?? true };
  });
  return { bot, calls, responses };
}

// (call helpers retained for ad-hoc debugging; not required by the current suite)

/** Build an Update object for a callback_query (button tap). */
function cbUpdate(data: string, id = 1) {
  return {
    update_id: id,
    callback_query: {
      id: `cb-${id}`,
      from: { id: USER_ID, is_bot: false, first_name: 'Tester' },
      chat_instance: 'ch',
      message: {
        message_id: 900,
        date: Math.floor(Date.now() / 1000),
        chat: { id: CHAT_ID, type: 'private' },
        text: 'tap',
      },
      data,
    },
  } as unknown as Update;
}

function locationUpdate(lat: number, lon: number) {
  return {
    update_id: 998,
    message: {
      message_id: 801,
      date: Math.floor(Date.now() / 1000),
      chat: { id: CHAT_ID, type: 'private' },
      from: { id: USER_ID, is_bot: false, first_name: 'Tester' },
      location: { latitude: lat, longitude: lon },
    },
  } as unknown as Update;
}

function inlineQueryUpdate(query: string, id = 7) {
  return {
    update_id: id,
    inline_query: {
      id: `iq-${id}`,
      from: { id: USER_ID, is_bot: false, first_name: 'Tester' },
      query,
      offset: '',
      chat_type: 'private' as const,
    },
  } as unknown as Update;
}

// ─────────────────────────────────────────────────────────────────────
// /start — happy path + cancel-confirm
// ─────────────────────────────────────────────────────────────────────
describe('start handlers', () => {
  let bot: Bot<BotContext>;
  let calls: ReturnType<typeof makeBot>['calls'];
  let sessions: SessionService;
  let pois: PoisService;
  let lastRoute: LastRouteService;

  beforeEach(() => {
    const m = makeBot();
    bot = m.bot;
    calls = m.calls;
    sessions = makeSessionService();
    pois = makePois();
    lastRoute = makeLastRoute();
    registerStartHandlers(bot, sessions, pois, lastRoute);
  });

  it('replies with hero text + home menu on /start', async () => {
    await bot.handleUpdate({
      update_id: 1,
      message: {
        message_id: 100,
        date: Math.floor(Date.now() / 1000),
        chat: { id: CHAT_ID, type: 'private' },
        from: { id: USER_ID, is_bot: false, first_name: 'Tester' },
        text: '/start',
        entities: [{ type: 'bot_command', offset: 0, length: 6 }],
      },
    } as unknown as Update);

    const send = calls.filter((c) => c.method === 'sendMessage');
    expect(send.length).toBeGreaterThanOrEqual(1);
    const text = String(send[0].payload?.text ?? '');
    expect(text).toMatch(/Nearventure/);
    expect(text).toMatch(/42/); // live POI count from PoisService.count() mock
    expect(send[0].payload?.reply_markup?.inline_keyboard).toBeDefined();
  });

  it('offers a confirm-then-reset dialog on nav:cancel tap (no data loss on cancel)', async () => {
    // First /start
    await bot.handleUpdate({
      update_id: 1,
      message: {
        message_id: 100,
        date: Math.floor(Date.now() / 1000),
        chat: { id: CHAT_ID, type: 'private' },
        from: { id: USER_ID, is_bot: false, first_name: 'Tester' },
        text: '/start',
        entities: [{ type: 'bot_command', offset: 0, length: 6 }],
      },
    } as unknown as Update);

    // tap "❌ Сбросить" (nav:cancel)
    await bot.handleUpdate(cbUpdate(CB.navCancel));
    // confirm dialog should mention starting over ("Начать заново?")
    const edits = calls.filter((c) => c.method === 'editMessageText');
    const allEditText = edits.map((c) => String(c.payload?.text ?? '')).join('\n');
    expect(allEditText).toMatch(/Начать заново/);
  });
});

// ─────────────────────────────────────────────────────────────────────
// route handler — build path
// ─────────────────────────────────────────────────────────────────────
describe('route handlers', () => {
  let bot: Bot<BotContext>;
  let calls: ReturnType<typeof makeBot>['calls'];
  let sessions: SessionService;
  let builder: RouteBuilderService;
  let users: TelegramUserService;
  let analytics: AnalyticsService;
  let pois: PoisService;
  let limiter: BotRateLimiter;
  let lastRoute: LastRouteService;
  let draftService: ItineraryDraftService;
  let ownerService: ItineraryOwnerService;

  beforeEach(() => {
    const m = makeBot();
    bot = m.bot;
    calls = m.calls;
    sessions = makeSessionService();
    builder = makeBuilder({
      buildAuto: vi.fn().mockResolvedValue({
        geojson: { type: 'LineString', coordinates: [[0, 0], [1, 1]] },
        distance: 5000,
        duration: 1800,
        ascend: 50,
        descend: 50,
        profile: 'foot',
        pois: [
          { id: 'p1', name: 'Church', lat: 1, lon: 1, category: 'religion' },
          { id: 'p2', name: 'Museum', lat: 1.1, lon: 1.1, category: 'museum' },
        ],
      }),
    });
    users = makeUserService();
    analytics = makeAnalyticsEmpty();
    pois = makePois();
    limiter = new BotRateLimiter();
    lastRoute = makeLastRoute();
    draftService = makeDraftService();
    ownerService = makeOwnerService();

    registerRouteHandlers(
      bot,
      sessions,
      builder,
      users,
      analytics,
      'https://example.test/tg/',
      limiter,
      lastRoute,
      draftService,
      ownerService,
    );
  });

  it('builds a route, persists it, and shows the summary with GPX+MiniApp+menu buttons', async () => {
    // Walk the wizard quickly: start → location → transport → time → cats → mode:auto
    await bot.handleUpdate(cbUpdate(CB.startRoute));
    await bot.handleUpdate(locationUpdate(58.6, 49.6));
    await bot.handleUpdate(cbUpdate(`${CB.rSetTransport}:foot`));
    await bot.handleUpdate(cbUpdate(`${CB.rSetTime}:60`));
    await bot.handleUpdate(cbUpdate(CB.rCatsDone));
    await bot.handleUpdate(cbUpdate(`${CB.rSetMode}:auto`));

    // Canonical itinerary draft was created and filled through the backend capability.
    expect(draftService.create).toHaveBeenCalledWith(
      'tg:1001',
      expect.objectContaining({ profile: 'foot', budgetMinutes: 60, start: { lat: 58.6, lon: 49.6 } }),
    );
    expect(draftService.autoFill).toHaveBeenCalledWith(
      'tg:1001',
      'draft-1',
      expect.objectContaining({ preferredCategories: expect.any(Array), expectedVersion: 1 }),
    );

    // Last route persisted for Mini App handoff
    expect(lastRoute.set).toHaveBeenCalledTimes(1);
    const persisted = (lastRoute.set as any).mock.calls[0][1];
    expect(persisted.pois).toHaveLength(2);
    expect(persisted.pois[0]).toMatchObject({ id: 'p1', order: 1 });
    expect(persisted.pois[1]).toMatchObject({ id: 'p2', order: 2 });

    // Analytics attribution fired
    expect(analytics.record).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'route_generated' }),
    );

    // Summary message sent with success/CTA keys
    const replyTexts = calls
      .filter((c) => c.method === 'sendMessage')
      .map((c) => String(c.payload?.text ?? ''))
      .join('\n');
    expect(replyTexts).toMatch(/Маршрут|км/);
    const resultKeyboard = calls.find((c) => c.method === 'sendMessage' && JSON.stringify(c.payload?.reply_markup).includes(CB.rrGpx))?.payload.reply_markup;
    expect(JSON.stringify(resultKeyboard)).toContain(CB.rrGuide);
  });

  it('keeps the guide button beside GPX after regenerate and smart-fix result renders', async () => {
    const completeAuto = async () => {
      await bot.handleUpdate(cbUpdate(CB.startRoute));
      await bot.handleUpdate(locationUpdate(58.6, 49.6));
      await bot.handleUpdate(cbUpdate(`${CB.rSetTransport}:foot`));
      await bot.handleUpdate(cbUpdate(`${CB.rSetTime}:60`));
      await bot.handleUpdate(cbUpdate(CB.rCatsDone));
      await bot.handleUpdate(cbUpdate(`${CB.rSetMode}:auto`));
    };
    await completeAuto();
    calls.length = 0;
    await bot.handleUpdate(cbUpdate(CB.rrRegenerate));
    const regenerated = calls.find((c) => c.method === 'editMessageText' && JSON.stringify(c.payload?.reply_markup).includes(CB.rrGpx));
    expect(JSON.stringify(regenerated?.payload.reply_markup)).toContain(CB.rrGuide);

    (draftService.get as any).mockResolvedValue({
      ...routeDraft(3),
      suggestions: [{ suggestionId: 'fix-1', kind: 'increase_budget', targetBudgetMinutes: 90 }],
    });
    calls.length = 0;
    await bot.handleUpdate(cbUpdate(CB.rrSmartFix));
    const fixed = calls.find((c) => c.method === 'editMessageText' && JSON.stringify(c.payload?.reply_markup).includes(CB.rrGpx));
    expect(JSON.stringify(fixed?.payload.reply_markup)).toContain(CB.rrGuide);
  });

  it('rejects malformed canonical children from the initial build without cache or route-session effects', async () => {
    (draftService.autoFill as any).mockResolvedValueOnce(malformedGuideDraft(2));
    const setSpy = vi.spyOn(sessions, 'set');

    await bot.handleUpdate(cbUpdate(CB.startRoute));
    await bot.handleUpdate(locationUpdate(58.6, 49.6));
    await bot.handleUpdate(cbUpdate(`${CB.rSetTransport}:foot`));
    await bot.handleUpdate(cbUpdate(`${CB.rSetTime}:60`));
    setSpy.mockClear();
    await bot.handleUpdate(cbUpdate(CB.rCatsDone));

    expect(lastRoute.set).not.toHaveBeenCalled();
    expect(setSpy).not.toHaveBeenCalled();
    const session = sessions.get(CHAT_ID);
    expect(session.lastRoute).toBeUndefined();
    expect(session.draftId).toBeUndefined();
    expect(calls.some((call) => /неполные данные для экскурсии/.test(String(call.payload?.text ?? '')))).toBe(true);
  });

  it('rejects malformed canonical children from regenerate without cache or route-session effects', async () => {
    const completeAuto = async () => {
      await bot.handleUpdate(cbUpdate(CB.startRoute));
      await bot.handleUpdate(locationUpdate(58.6, 49.6));
      await bot.handleUpdate(cbUpdate(`${CB.rSetTransport}:foot`));
      await bot.handleUpdate(cbUpdate(`${CB.rSetTime}:60`));
      await bot.handleUpdate(cbUpdate(CB.rCatsDone));
    };
    await completeAuto();
    const original = sessions.get(CHAT_ID).lastRoute;
    const originalVersion = sessions.get(CHAT_ID).draftVersion;
    (draftService.regenerate as any).mockResolvedValueOnce(malformedGuideDraft(3));
    (lastRoute.set as any).mockClear();
    const setSpy = vi.spyOn(sessions, 'set');
    setSpy.mockClear();

    await bot.handleUpdate(cbUpdate(CB.rrRegenerate));

    expect(lastRoute.set).not.toHaveBeenCalled();
    expect(setSpy).not.toHaveBeenCalled();
    expect(sessions.get(CHAT_ID).lastRoute).toBe(original);
    expect(sessions.get(CHAT_ID).draftVersion).toBe(originalVersion);
  });

  it('rejects malformed canonical children from smart-fix without cache or route-session effects', async () => {
    const completeAuto = async () => {
      await bot.handleUpdate(cbUpdate(CB.startRoute));
      await bot.handleUpdate(locationUpdate(58.6, 49.6));
      await bot.handleUpdate(cbUpdate(`${CB.rSetTransport}:foot`));
      await bot.handleUpdate(cbUpdate(`${CB.rSetTime}:60`));
      await bot.handleUpdate(cbUpdate(CB.rCatsDone));
    };
    await completeAuto();
    const original = sessions.get(CHAT_ID).lastRoute;
    const originalVersion = sessions.get(CHAT_ID).draftVersion;
    (draftService.get as any).mockResolvedValueOnce({
      ...routeDraft(2), suggestions: [{ suggestionId: 'fix-1', kind: 'increase_budget', targetBudgetMinutes: 90 }],
    });
    (draftService.applySmartFix as any).mockResolvedValueOnce(malformedGuideDraft(3));
    (lastRoute.set as any).mockClear();
    const setSpy = vi.spyOn(sessions, 'set');
    setSpy.mockClear();

    await bot.handleUpdate(cbUpdate(CB.rrSmartFix));

    expect(lastRoute.set).not.toHaveBeenCalled();
    expect(setSpy).not.toHaveBeenCalled();
    expect(sessions.get(CHAT_ID).lastRoute).toBe(original);
    expect(sessions.get(CHAT_ID).draftVersion).toBe(originalVersion);
  });

  it('bike subtype selection advances the wizard (regression: route:tr:bike:bike was unhandled → “ничего”)', async () => {
    // Bike is a two-step choice: Велосипед → Городовой/МТБ. The subtype buttons
    // send `route:tr:bike:bike` / `route:tr:bike:mtb` (two segments). An earlier
    // regex `^route:tr:(bike|mtb)$` did NOT match these → the callback was
    // unhandled → the user saw the button do nothing. This test pins the fix.
    await bot.handleUpdate(cbUpdate(CB.startRoute));
    await bot.handleUpdate(locationUpdate(58.6, 49.6));
    await bot.handleUpdate(cbUpdate(`${CB.rSetTransport}:bike`));      // → subtype screen
    await bot.handleUpdate(cbUpdate(`${CB.rSetTransport}:bike:bike`)); // → askTime (was unhandled!)
    await bot.handleUpdate(cbUpdate(`${CB.rSetTime}:60`));
    await bot.handleUpdate(cbUpdate(CB.rCatsDone));

    expect(draftService.create).toHaveBeenCalledWith(
      'tg:1001',
      expect.objectContaining({ profile: 'bike', budgetMinutes: 60 }),
    );
  });

  it('MTB subtype routes on the mtb GraphHopper profile (not bike)', async () => {
    // Picking «Горный (MTB)» must set profile='mtb' so the custom
    // nearventure-mtb model is used. Was hardcoded to 'bike' before.
    await bot.handleUpdate(cbUpdate(CB.startRoute));
    await bot.handleUpdate(locationUpdate(58.6, 49.6));
    await bot.handleUpdate(cbUpdate(`${CB.rSetTransport}:bike`));
    await bot.handleUpdate(cbUpdate(`${CB.rSetTransport}:bike:mtb`));
    await bot.handleUpdate(cbUpdate(`${CB.rSetTime}:120`));
    await bot.handleUpdate(cbUpdate(CB.rCatsDone));

    expect(draftService.create).toHaveBeenCalledWith(
      'tg:1001',
      expect.objectContaining({ profile: 'mtb', budgetMinutes: 120 }),
    );
  });

  it('shows a friendly error + В меню button when auto-fill throws', async () => {
    (draftService.autoFill as any) = vi.fn().mockRejectedValue(new Error('GraphHopper down'));
    // Re-register with the failing canonical itinerary capability on a fresh bot.
    const m2 = makeBot();
    bot = m2.bot;
    calls = m2.calls;
    registerRouteHandlers(bot, sessions, builder, users, analytics, 'https://example.test/tg/', limiter, lastRoute, draftService, ownerService);

    // Walk wizard
    await bot.handleUpdate(cbUpdate(CB.startRoute));
    await bot.handleUpdate(locationUpdate(58.6, 49.6));
    await bot.handleUpdate(cbUpdate(`${CB.rSetTransport}:foot`));
    await bot.handleUpdate(cbUpdate(`${CB.rSetTime}:60`));
    await bot.handleUpdate(cbUpdate(CB.rCatsDone));
    await bot.handleUpdate(cbUpdate(`${CB.rSetMode}:auto`));

    // Error path: editMessageText with ❌ and "В меню" keyboard
    const edits = calls
      .filter((c) => c.method === 'editMessageText')
      .map((c) => String(c.payload?.text ?? ''));
    expect(edits.some((t: string) => /GraphHopper down|❌/.test(t))).toBe(true);
    // Reset button present in some keyboard (inline or reply)
    const allCalls = calls.filter(
      (c) => c.method === 'editMessageText' || c.method === 'sendMessage',
    );
    const hasMenuButton = allCalls.some((c) => {
      const kb = c.payload?.reply_markup;
      if (!kb) return false;
      return JSON.stringify(kb).includes('В меню');
    });
    expect(hasMenuButton).toBe(true);
  });

  it('error path includes a "Повторить" button (regression: was missing in audit-09)', async () => {
    (draftService.autoFill as any) = vi.fn().mockRejectedValue(new Error('timeout'));
    const m2 = makeBot();
    bot = m2.bot;
    calls = m2.calls;
    registerRouteHandlers(bot, sessions, builder, users, analytics, 'https://example.test/tg/', limiter, lastRoute, draftService, ownerService);

    // Walk wizard
    await bot.handleUpdate(cbUpdate(CB.startRoute));
    await bot.handleUpdate(locationUpdate(58.6, 49.6));
    await bot.handleUpdate(cbUpdate(`${CB.rSetTransport}:foot`));
    await bot.handleUpdate(cbUpdate(`${CB.rSetTime}:60`));
    await bot.handleUpdate(cbUpdate(CB.rCatsDone));
    await bot.handleUpdate(cbUpdate(`${CB.rSetMode}:auto`));

    // The error reply must have a "Повторить" button wired to rCatsDone
    // (which re-runs the build).
    const errCall = calls
      .filter((c) => c.method === 'editMessageText' || c.method === 'sendMessage')
      .find((c) => /timeout|❌/.test(String(c.payload?.text ?? '')));
    expect(errCall).toBeDefined();
    const kb = errCall!.payload?.reply_markup;
    expect(kb).toBeDefined();
    const kbStr = JSON.stringify(kb);
    expect(kbStr).toMatch(/Повторить/);
    expect(kbStr).toMatch(CB.rCatsDone);
  });

  it('blocks new route builds with a rate-limit message when limit is exhausted', async () => {
    // Exhaust the route limit (8/hour) for this user
    for (let i = 0; i < 8; i++) {
      expect(limiter.try('route', USER_ID)).toBe(true);
    }
    expect(limiter.try('route', USER_ID)).toBe(false);

    // Walk wizard — the build should not happen, and a rate-limit message
    // should be sent instead.
    await bot.handleUpdate(cbUpdate(CB.startRoute));
    await bot.handleUpdate(locationUpdate(58.6, 49.6));
    await bot.handleUpdate(cbUpdate(`${CB.rSetTransport}:foot`));
    await bot.handleUpdate(cbUpdate(`${CB.rSetTime}:60`));
    await bot.handleUpdate(cbUpdate(CB.rCatsDone));
    await bot.handleUpdate(cbUpdate(`${CB.rSetMode}:auto`));

    // Builder NOT called because of rate limit
    expect(builder.buildAuto).not.toHaveBeenCalled();
    // Rate-limit copy present
    const allText = calls
      .filter((c) => c.method === 'sendMessage' || c.method === 'editMessageText')
      .map((c) => String(c.payload?.text ?? ''))
      .join('\n');
    expect(allText).toMatch(/Лимит|Попробуйте через/);
  });
});

// ─────────────────────────────────────────────────────────────────────
// nearby handler — B2 error path + pagination + empty
// ─────────────────────────────────────────────────────────────────────
describe('nearby handlers', () => {
  let bot: Bot<BotContext>;
  let calls: ReturnType<typeof makeBot>['calls'];
  let sessions: SessionService;
  let pois: PoisService;
  let analytics: AnalyticsService;
  let cards: TelegramPoiCardService;

  beforeEach(() => {
    const m = makeBot();
    bot = m.bot;
    calls = m.calls;
    sessions = makeSessionService();
    pois = makePois({
      list: vi.fn().mockResolvedValue({ items: [], total: 0 }),
    });
    analytics = makeAnalyticsEmpty();
    cards = makePoiCardService();
    registerNearbyHandlers(bot, sessions, pois, analytics, cards);
  });

  it('shows a "Повторить" button (regression: B2) when pois.list throws', async () => {
    (pois.list as any) = vi.fn().mockRejectedValue(new Error('DB timeout'));

    // Drive: start → categories done → share location → fetch fails
    await bot.handleUpdate(cbUpdate(CB.startNearby));
    await bot.handleUpdate(cbUpdate(CB.nbCatsDone));
    await bot.handleUpdate(locationUpdate(58.6, 49.6));

    // The error path uses editMessageText (the inline "back to filters" msg)
    // OR a fresh reply — accept either, but the "Повторить" button must
    // be present somewhere.
    const editCalls = calls.filter((c) => c.method === 'editMessageText');
    const sendCalls = calls.filter((c) => c.method === 'sendMessage');
    const allCalls = [...editCalls, ...sendCalls];
    const hasRetryButton = allCalls.some((c) => {
      const kb = c.payload?.reply_markup?.inline_keyboard;
      if (!kb) return false;
      return JSON.stringify(kb).includes('Повторить');
    });
    expect(hasRetryButton).toBe(true);
    // Error text mentions "Не удалось загрузить"
    const allText = allCalls.map((c) => String(c.payload?.text ?? '')).join('\n');
    expect(allText).toMatch(/Не удалось загрузить|Повторить/);
  });

  it('paginates: nbPage:<offset> calls pois.list with the requested offset and edits the list', async () => {
    // First page returns 1 item with hasNext=true
    (pois.list as any) = vi
      .fn()
      .mockResolvedValueOnce({
        items: [
          fakePoi('p1', 'Church', 58.6, 49.7, 'religion'),
        ],
        total: 10,
      })
      .mockResolvedValueOnce({
        items: [fakePoi('p2', 'Museum', 58.7, 49.8, 'museum')],
        total: 10,
      });

    // Setup + first page
    await bot.handleUpdate(cbUpdate(CB.startNearby));
    await bot.handleUpdate(cbUpdate(CB.nbCatsDone));
    await bot.handleUpdate(locationUpdate(58.6, 49.6));

    expect(pois.list).toHaveBeenCalledTimes(1);
    expect((pois.list as any).mock.calls[0][0]).toMatchObject({ offset: 0 });

    // Tap "▶" (next) — nbPage:8
    await bot.handleUpdate(cbUpdate(`${CB.nbPage}:8`));
    expect(pois.list).toHaveBeenCalledTimes(2);
    expect((pois.list as any).mock.calls[1][0]).toMatchObject({ offset: 8 });
  });

  it('shows the "0 объектов" guidance when the radius is empty', async () => {
    (pois.list as any) = vi.fn().mockResolvedValue({ items: [], total: 0 });

    await bot.handleUpdate(cbUpdate(CB.startNearby));
    await bot.handleUpdate(cbUpdate(CB.nbCatsDone));
    await bot.handleUpdate(locationUpdate(0, 0));

    const allText = calls
      .filter((c) => c.method === 'sendMessage' || c.method === 'editMessageText')
      .map((c) => String(c.payload?.text ?? ''))
      .join('\n');
    expect(allText).toMatch(/ничего не нашлось|Радиус|Попробуйте расширить/);
  });
});

// ─────────────────────────────────────────────────────────────────────
// guide handler — FSM happy path + sendPoiCard failure fallback
// ─────────────────────────────────────────────────────────────────────
describe('guide handlers', () => {
  let bot: Bot<BotContext>;
  let calls: ReturnType<typeof makeBot>['calls'];
  let sessions: SessionService;
  let card: TelegramPoiCardService;
  let limiter: BotRateLimiter;

  beforeEach(() => {
    const m = makeBot();
    bot = m.bot;
    calls = m.calls;
    sessions = makeSessionService();
    card = makePoiCardService();
    limiter = new BotRateLimiter();
    registerGuideHandlers(bot, sessions, card, limiter);
  });

  function seedRoute(s: BotSession) {
    s.lastRoute = {
      geojson: null,
      distance: 5000,
      duration: 1800,
      ascend: 30,
      descend: 30,
      profile: 'foot',
      pois: [
        { id: 'a', name: 'POI A', lat: 1, lon: 1, category: 'heritage' },
        { id: 'b', name: 'POI B', lat: 1.1, lon: 1.1, category: 'nature' },
      ],
    };
  }

  it('walks the FSM: intro → first pin → "Я на месте" → card → next pin → outro', async () => {
    const s = sessions.get(CHAT_ID);
    seedRoute(s);
    sessions.set(CHAT_ID, s);

    // 1. Tap "🚶 Начать экскурсию" → menu shows summary + start button
    await bot.handleUpdate(cbUpdate(CB.gMenu));
    const introTexts = calls
      .filter((c) => c.method === 'sendMessage')
      .map((c) => String(c.payload?.text ?? ''))
      .join('\n');
    expect(introTexts).toMatch(/2 точек|минут/);

    // 2. Tap "▶ Начать" (rrGuide)
    calls.length = 0;
    await bot.handleUpdate(cbUpdate(CB.rrGuide));

    // intro bubble + "Точка 1 из 2" header + first location pin
    const texts = calls
      .filter((c) => c.method === 'sendMessage')
      .map((c) => String(c.payload?.text ?? ''));
    expect(texts.some((t: string) => /Экскурсия началась/.test(t))).toBe(true);
    expect(texts.some((t: string) => /Точка 1 из 2/.test(t))).toBe(true);
    expect(calls.some((c) => c.method === 'sendLocation')).toBe(true);

    // 3. Tap "✅ Я на месте" (guide:at:0)
    calls.length = 0;
    await bot.handleUpdate(cbUpdate(`${CB.gAtPoint}:0`));
    // card service called (POI card delivery)
    expect((card as any).sendPoiCard).toHaveBeenCalled();
    // next pin sent
    const moreTexts = calls
      .filter((c) => c.method === 'sendMessage')
      .map((c) => String(c.payload?.text ?? ''));
    expect(moreTexts.some((t: string) => /Точка 2 из 2/.test(t))).toBe(true);

    // 4. Tap "✅ Я на месте" again on the second pin → outro
    calls.length = 0;
    await bot.handleUpdate(cbUpdate(`${CB.gAtPoint}:1`));
    const outroTexts = calls
      .filter((c) => c.method === 'sendMessage')
      .map((c) => String(c.payload?.text ?? ''));
    expect(outroTexts.some((t: string) => /Экскурсия завершена/.test(t))).toBe(true);
    expect(outroTexts.some((t: string) => /2 из 2|Прошли/.test(t))).toBe(true);
  });

  it('falls back to a text-only POI card when sendPoiCard throws', async () => {
    (card as any).sendPoiCard = vi.fn().mockRejectedValue(new Error('media upload failed'));
    const s = sessions.get(CHAT_ID);
    seedRoute(s);
    sessions.set(CHAT_ID, s);

    await bot.handleUpdate(cbUpdate(CB.rrGuide));
    calls.length = 0;
    await bot.handleUpdate(cbUpdate(`${CB.gAtPoint}:0`));

    // Text fallback contains the POI name
    const texts = calls
      .filter((c) => c.method === 'sendMessage')
      .map((c) => String(c.payload?.text ?? ''));
    expect(texts.some((t: string) => /POI A/.test(t))).toBe(true);
    expect(texts.some((t: string) => /Не удалось загрузить карточку|описание доступно/i.test(t))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────
// inline handler — empty + results
// ─────────────────────────────────────────────────────────────────────
describe('inline handlers', () => {
  let bot: Bot<BotContext>;
  let calls: ReturnType<typeof makeBot>['calls'];
  let pois: PoisService;

  beforeEach(() => {
    const m = makeBot();
    bot = m.bot;
    calls = m.calls;
    pois = makePois();
    registerInlineHandlers(bot, pois);
  });

  it('responds with a help article when the query is empty', async () => {
    await bot.handleUpdate(inlineQueryUpdate(''));
    const answers = calls.filter((c) => c.method === 'answerInlineQuery');
    expect(answers.length).toBe(1);
    const results = answers[0].payload?.results;
    expect(results[0].id).toBe('help');
    expect(results[0].title).toMatch(/Поиск/);
    expect(answers[0].payload?.cache_time).toBe(0);
  });

  it('responds with a "Ничего не найдено" article when there are no matches', async () => {
    (pois.list as any) = vi.fn().mockResolvedValue({ items: [], total: 0 });
    await bot.handleUpdate(inlineQueryUpdate('unknownplace'));
    const answers = calls.filter((c) => c.method === 'answerInlineQuery');
    const results = answers[0]?.payload?.results;
    expect(results[0].id).toBe('empty');
    expect(results[0].title).toMatch(/Ничего не найдено/);
  });

  it('returns POI articles when matches are found (and caches for 60s)', async () => {
    (pois.list as any) = vi.fn().mockResolvedValue({
      items: [fakePoi('p1', 'Church', 58.6, 49.7, 'religion')],
      total: 1,
    });
    await bot.handleUpdate(inlineQueryUpdate('church'));
    const answers = calls.filter((c) => c.method === 'answerInlineQuery');
    const results = answers[0]?.payload?.results;
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('p1');
    expect(results[0].title).toMatch(/Church/);
    expect(results[0].input_message_content.message_text).toMatch(/Church/);
    // cache_time 60 — 1 minute, balances responsiveness with Telegram
    // rate limits on the inline endpoint.
    expect(answers[0]?.payload?.cache_time).toBe(60);
  });
});

// ─────────────────────────────────────────────────────────────────────
// helpers
// ─────────────────────────────────────────────────────────────────────
function fakePoi(id: string, name: string, lat: number, lon: number, category: string): PoiRow {
  return {
    id,
    name,
    lat,
    lon,
    category,
    subcategory: null,
    description: null,
    descRu: null,
    imageUrl: null,
    imageAttribution: null,
    heritageSignificance: null,
    featured: false,
    popularityScore: 1,
    region: 'Kirov',
  } as unknown as PoiRow;
}
