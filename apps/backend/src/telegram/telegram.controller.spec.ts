import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TelegramController } from './telegram.controller';
import { TelegramAuthService } from './telegram-auth.service';
import { createHmac } from 'node:crypto';

/**
 * Tests for the Mini App ↔ Bot bridge endpoints:
 *  - GET  /api/telegram/last-route
 *  - POST /api/telegram/guide/start
 *
 * We test the controller directly (no Nest HTTP) by calling its methods
 * with a constructed mock request. The TelegramAuthService is the real
 * one — we generate valid initData so the HMAC path is exercised end-to-end
 * (this is the security boundary; mocking it would defeat the test).
 */

const BOT_TOKEN = 'test-bot-token-for-controller-spec';

function makeInitData(user: { id: number; first_name: string; username?: string }): string {
  const params = new URLSearchParams();
  params.set('user', JSON.stringify(user));
  params.set('auth_date', String(Math.floor(Date.now() / 1000)));
  const all = Array.from(params.entries()).sort(([a], [b]) => a.localeCompare(b));
  const dataCheck = all.map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  const hash = createHmac('sha256', secret).update(dataCheck).digest('hex');
  params.set('hash', hash);
  return params.toString();
}

function makeAuth() {
  // The auth service reads TELEGRAM_BOT_TOKEN from process.env on each call;
  // set it for the test scope so the HMAC matches the initData we generate.
  process.env.TELEGRAM_BOT_TOKEN = BOT_TOKEN;
  return new TelegramAuthService();
}

function makeLastRoute(rows: Record<number, any> = {}) {
  return {
    get: vi.fn(async (chatId: number) => rows[chatId] ?? null),
    set: vi.fn(),
    clear: vi.fn(),
  } as any;
}

function makeSessions() {
  return {
    get: vi.fn((_chatId: number, from?: any) => ({
      step: 'IDLE',
      updatedAt: Date.now(),
      categories: ['heritage'],
      loopRoute: true,
      lastRoute: undefined,
      guideIndex: 0,
      menuMessageId: undefined,
      _from: from,
    })),
    set: vi.fn(),
    reset: vi.fn(),
  } as any;
}

function guideDraft(overrides: Record<string, any> = {}) {
  return {
    id: 'draft-1', version: 3, status: 'ready', profile: 'foot',
    route: { distance: 5_000, duration: 1500, ascend: 50, descend: 50, profile: 'foot', geojson: { type: 'Feature', geometry: { type: 'LineString', coordinates: [[49.6, 58.6], [49.61, 58.61]] }, properties: {} } },
    totals: { feasible: true },
    places: [
      { pois: [{ id: 'p1', name: 'First', category: 'heritage', lat: 58.61, lon: 49.61, included: true }] },
      { pois: [{ id: 'p2', name: 'Second', category: 'museum', lat: 58.65, lon: 49.65, included: true }] },
    ],
    ...overrides,
  };
}

function makeDrafts() {
  return { get: vi.fn().mockResolvedValue(guideDraft()) } as any;
}

function makeOwners() {
  return { forTelegramUser: vi.fn((id: number) => ({ key: `tg:${id}` })) } as any;
}

function makeBot() {
  return {
    api: {
      sendMessage: vi.fn().mockResolvedValue({ message_id: 1 }),
      sendLocation: vi.fn().mockResolvedValue({ message_id: 2 }),
    },
  } as any;
}

describe('TelegramController — Mini App bridge', () => {
  let ctrl: TelegramController;
  let lastRoute: ReturnType<typeof makeLastRoute>;
  let sessions: ReturnType<typeof makeSessions>;
  let bot: ReturnType<typeof makeBot>;
  let auth: ReturnType<typeof makeAuth>;
  let drafts: ReturnType<typeof makeDrafts>;
  let owners: ReturnType<typeof makeOwners>;

  beforeEach(() => {
    auth = makeAuth();
    lastRoute = makeLastRoute();
    sessions = makeSessions();
    drafts = makeDrafts();
    owners = makeOwners();
    bot = makeBot();
    ctrl = new TelegramController(bot, auth, lastRoute, sessions, drafts, owners);
  });

  describe('GET /last-route', () => {
    it('returns 400 when initData is missing', async () => {
      await expect(ctrl.getLastRoute(undefined)).rejects.toThrow(/initData is required/);
    });

    it('returns 401 when initData is invalid', async () => {
      await expect(ctrl.getLastRoute('not-a-real-init-data')).rejects.toThrow(/Invalid initData/);
    });

    it('returns { ok: false, error: "no-route" } when cache empty', async () => {
      const initData = makeInitData({ id: 12345, first_name: 'Alex' });
      const res = await ctrl.getLastRoute(initData);
      expect(res.ok).toBe(false);
      expect(res.error).toBe('no-route');
      expect(lastRoute.get).toHaveBeenCalledWith(12345);
    });

    it('returns the cached route on valid initData + cache hit', async () => {
      const initData = makeInitData({ id: 99999, first_name: 'Maria' });
      const route = {
        distance: 12_400,
        duration: 4320,
        ascend: 240,
        descend: 235,
        profile: 'bike',
        geojson: { type: 'LineString', coordinates: [[49.6, 58.6]] },
        pois: [{ id: 'p1', name: 'Church', category: 'religion', lat: 58.6, lon: 49.6 }],
        expiresAt: Date.now() + 60_000,
      };
      lastRoute = makeLastRoute({ 99999: route });
      ctrl = new TelegramController(bot, auth, lastRoute, sessions, drafts, owners);

      const res = await ctrl.getLastRoute(initData);
      expect(res.ok).toBe(true);
      expect(res).not.toHaveProperty('chatId');
      expect(res.route.distance).toBe(12_400);
      expect(res.route.pois).toHaveLength(1);
    });

    it('rejects forged initData (wrong hash) even with valid shape', async () => {
      const bad = 'user=%7B%22id%22%3A1%7D&auth_date=1&hash=deadbeef';
      await expect(ctrl.getLastRoute(bad)).rejects.toThrow(/Invalid initData/);
    });
  });

  describe('POST /guide/start', () => {
    it('returns 400 when initData is missing', async () => {
      await expect(ctrl.startGuide({})).rejects.toThrow(/initData is required/);
    });

    it('returns 401 when initData is invalid', async () => {
      await expect(ctrl.startGuide({ initData: 'garbage' })).rejects.toThrow(/Invalid initData/);
    });

    it('returns no-route when cache is empty', async () => {
      const initData = makeInitData({ id: 10001, first_name: 'P' });
      const res = await ctrl.startGuide({ initData });
      expect(res.ok).toBe(false);
      expect(res.error).toBe('no-route');
      // Critically, no guide state was written and no message was sent
      expect(sessions.set).not.toHaveBeenCalled();
      expect(bot.api.sendMessage).not.toHaveBeenCalled();
    });

    it('seeds the session and sends greeting + first location on success', async () => {
      const initData = makeInitData({ id: 20002, first_name: 'Eve' });
      const route = {
        distance: 5_000,
        duration: 1500,
        ascend: 50,
        descend: 50,
        profile: 'foot',
        geojson: { type: 'LineString', coordinates: [[49.6, 58.6], [49.61, 58.61]] },
        pois: [
          { id: 'p1', name: 'Start', category: 'heritage', lat: 58.61, lon: 49.61 },
          { id: 'p2', name: 'End', category: 'museum', lat: 58.65, lon: 49.65 },
        ],
      };
      lastRoute = makeLastRoute({ 20002: route });
      ctrl = new TelegramController(bot, auth, lastRoute, sessions, drafts, owners);

      const res = await ctrl.startGuide({ initData });
      expect(res.ok).toBe(true);
      expect(res.route.pois).toHaveLength(2);

      // Session was read for the chatId (with the user from initData)
      expect(sessions.get).toHaveBeenCalled();
      // Session was written with the cached route + guideIndex=0
      const setCalls = sessions.set.mock.calls;
      expect(setCalls.length).toBeGreaterThanOrEqual(1);
      const finalSession = setCalls[setCalls.length - 1][1];
      expect(finalSession.lastRoute).toBeDefined();
      expect(finalSession.lastRoute.pois).toHaveLength(2);
      expect(finalSession.guideIndex).toBe(0);
      expect(finalSession.step).toBe('GUIDE_WALKING');

      // Greeting + first location were sent
      expect(bot.api.sendMessage).toHaveBeenCalledTimes(1);
      const [chatId, text, opts] = bot.api.sendMessage.mock.calls[0];
      expect(chatId).toBe(20002);
      expect(opts.parse_mode).toBe('HTML');
      expect(text).toContain('2 точек');

      expect(bot.api.sendLocation).toHaveBeenCalledTimes(1);
      const [locChatId, lat, lon, locOpts] = bot.api.sendLocation.mock.calls[0];
      expect(locChatId).toBe(20002);
      expect(lat).toBe(58.61);
      expect(lon).toBe(49.61);
      // First "Я на месте" + "Пропустить" buttons attached to the location
      const buttons = locOpts.reply_markup.inline_keyboard;
      expect(buttons[0][0].text).toBe('✅ Я на месте');
      expect(buttons[0][0].callback_data).toBe('guide:at:0');
    });

    it('rejects malformed cached routes before session or bot side effects', async () => {
      const initData = makeInitData({ id: 30002, first_name: 'Bad cache' });
      lastRoute = makeLastRoute({ 30002: {
        distance: 100, duration: 60, ascend: 0, descend: 0, profile: 'foot',
        geojson: { type: 'LineString', coordinates: [[49.6, 58.6], [49.61, 58.61]] },
        pois: [{ id: 'bad', name: 'Broken', category: 'sights', lat: Number.NaN, lon: 49.6 }],
      } });
      ctrl = new TelegramController(bot, auth, lastRoute, sessions, drafts, owners);

      await expect(ctrl.startGuide({ initData })).resolves.toEqual({ ok: false, error: 'unready-route' });
      expect(sessions.get).not.toHaveBeenCalled();
      expect(sessions.set).not.toHaveBeenCalled();
      expect(bot.api.sendMessage).not.toHaveBeenCalled();
      expect(bot.api.sendLocation).not.toHaveBeenCalled();
    });

    it('does not crash if bot is null (e.g. bot disabled in env)', async () => {
      const initData = makeInitData({ id: 30003, first_name: 'X' });
      const route = {
        distance: 100, duration: 60, ascend: 0, descend: 0, profile: 'foot',
        geojson: { type: 'LineString', coordinates: [[49.6, 58.6], [49.61, 58.61]] },
        pois: [{ id: 'p1', name: 'Only', category: 'sights', lat: 58.6, lon: 49.6 }],
      };
      lastRoute = makeLastRoute({ 30003: route });
      ctrl = new TelegramController(null /* bot disabled */, auth, lastRoute, sessions, drafts, owners);

      const res = await ctrl.startGuide({ initData });
      expect(res.ok).toBe(true);
      expect(res.route.pois).toHaveLength(1);
      // Session was still seeded (so the next /guide callback works)
      const setCalls = sessions.set.mock.calls;
      const final = setCalls[setCalls.length - 1][1];
      expect(final.lastRoute).toBeDefined();
      // But no bot API was called
      // (no way to assert this without a mock; the test simply shouldn't throw)
    });
  });

  describe('POST /guide/start-draft', () => {
    it('uses the signed owner and canonical ordered draft only', async () => {
      const initData = makeInitData({ id: 40004, first_name: 'Draft owner' });
      const result = await ctrl.startGuideFromDraft({ initData, draftId: 'draft-1', expectedVersion: 3 });
      expect(result).toEqual({ ok: true });
      expect(owners.forTelegramUser).toHaveBeenCalledWith(40004);
      expect(drafts.get).toHaveBeenCalledWith('tg:40004', 'draft-1');
      expect(lastRoute.set).toHaveBeenCalledWith(40004, expect.objectContaining({
        pois: [expect.objectContaining({ id: 'p1', order: 1 }), expect.objectContaining({ id: 'p2', order: 2 })],
      }));
      const session = sessions.set.mock.calls.at(-1)![1];
      expect(session.lastRoute.geojson).toEqual(guideDraft().route.geojson.geometry);
      expect(session.lastRoute.pois.map((poi: any) => poi.id)).toEqual(['p1', 'p2']);
    });

    it('rejects payload geometry, a stale version, and an unready route before guiding', async () => {
      const initData = makeInitData({ id: 50005, first_name: 'Owner' });
      await expect(ctrl.startGuideFromDraft({ initData, draftId: 'draft-1', expectedVersion: 3, geojson: {} } as any)).rejects.toThrow(/Only initData/);
      await expect(ctrl.startGuideFromDraft({ initData, draftId: 'draft-1', expectedVersion: 2 })).rejects.toThrow(/stale-draft/);
      drafts.get.mockResolvedValueOnce(guideDraft({ totals: { feasible: false } }));
      await expect(ctrl.startGuideFromDraft({ initData, draftId: 'draft-1', expectedVersion: 3 })).resolves.toEqual({ ok: false, error: 'unready-route' });
      expect(lastRoute.set).not.toHaveBeenCalled();
    });

    it('rejects a malformed included POI atomically before cache, session, or bot side effects', async () => {
      const initData = makeInitData({ id: 50006, first_name: 'Owner' });
      // This clustered place is a canonical draft fixture with one usable child
      // and one invalid guide stop. The valid sibling must not mask the defect.
      drafts.get.mockResolvedValueOnce(guideDraft({
        places: [{ pois: [
          { id: 'cluster-main', name: 'Main building', category: 'heritage', lat: 58.61, lon: 49.61, included: true },
          { id: 'cluster-annex', name: 'Annex', category: 'heritage', lat: Number.NaN, lon: 49.6101, included: true },
        ] }],
      }));

      await expect(ctrl.startGuideFromDraft({ initData, draftId: 'draft-1', expectedVersion: 3 }))
        .resolves.toEqual({ ok: false, error: 'unready-route' });

      expect(lastRoute.set).not.toHaveBeenCalled();
      expect(sessions.get).not.toHaveBeenCalled();
      expect(sessions.set).not.toHaveBeenCalled();
      expect(bot.api.sendMessage).not.toHaveBeenCalled();
      expect(bot.api.sendLocation).not.toHaveBeenCalled();
    });

    it('rejects included POIs with missing fields required by the guide', async () => {
      const initData = makeInitData({ id: 50008, first_name: 'Owner' });
      drafts.get.mockResolvedValueOnce(guideDraft({
        places: [{ pois: [
          { id: 'usable', name: 'Usable', category: 'heritage', lat: 58.61, lon: 49.61, included: true },
          { id: 'missing-name', name: ' ', category: 'heritage', lat: 58.6101, lon: 49.6101, included: true },
        ] }],
      }));

      await expect(ctrl.startGuideFromDraft({ initData, draftId: 'draft-1', expectedVersion: 3 }))
        .resolves.toEqual({ ok: false, error: 'unready-route' });
      expect(lastRoute.set).not.toHaveBeenCalled();
      expect(sessions.set).not.toHaveBeenCalled();
    });

    it('serializes every POI in a clustered place with unique canonical cache order', async () => {
      const initData = makeInitData({ id: 50007, first_name: 'Owner' });
      drafts.get.mockResolvedValueOnce(guideDraft({
        places: [
          { pois: [
            { id: 'cluster-main', name: 'Main building', category: 'heritage', lat: 58.61, lon: 49.61, included: true },
            { id: 'cluster-annex', name: 'Annex', category: 'heritage', lat: 58.6101, lon: 49.6101, included: true },
            // Excluded draft children never become guide stops, even if stale.
            { id: '', name: '', category: '', lat: Number.NaN, lon: Number.NaN, included: false },
          ] },
          { pois: [{ id: 'after-cluster', name: 'Museum', category: 'museum', lat: 58.65, lon: 49.65, included: true }] },
        ],
      }));

      await expect(ctrl.startGuideFromDraft({ initData, draftId: 'draft-1', expectedVersion: 3 })).resolves.toEqual({ ok: true });
      const cached = lastRoute.set.mock.calls[0][1];
      expect(cached.pois.map((poi: any) => [poi.id, poi.order])).toEqual([
        ['cluster-main', 1], ['cluster-annex', 2], ['after-cluster', 3],
      ]);
      expect(sessions.set.mock.calls.at(-1)![1].lastRoute.pois.map((poi: any) => poi.id))
        .toEqual(['cluster-main', 'cluster-annex', 'after-cluster']);
    });

    it('does not resolve a draft for a different signed owner', async () => {
      const initData = makeInitData({ id: 60006, first_name: 'Other' });
      drafts.get.mockRejectedValueOnce(new Error('Itinerary draft not found'));
      await expect(ctrl.startGuideFromDraft({ initData, draftId: 'someone-else-draft', expectedVersion: 3 })).rejects.toThrow(/not found/);
      expect(drafts.get).toHaveBeenCalledWith('tg:60006', 'someone-else-draft');
      expect(lastRoute.set).not.toHaveBeenCalled();
    });
  });

  describe('POST /webhook — webhook secret enforcement (release CRIT B-04)', () => {
    afterEach(() => {
      delete process.env.TELEGRAM_WEBHOOK_DOMAIN;
      delete process.env.TELEGRAM_WEBHOOK_SECRET;
    });

    function webhookBot() {
      return { handleUpdate: vi.fn().mockResolvedValue(undefined) } as any;
    }

    it('rejects a missing secret header when a secret is configured (forged/missing header)', async () => {
      process.env.TELEGRAM_WEBHOOK_DOMAIN = 'nearventure.ru';
      process.env.TELEGRAM_WEBHOOK_SECRET = 's3cret';
      const bot = webhookBot();
      const ctrl = new TelegramController(bot, makeAuth(), makeLastRoute(), makeSessions(), makeDrafts(), makeOwners());
      await expect(ctrl.handleWebhook({ update_id: 1 } as any, undefined)).rejects.toThrow(/Invalid webhook secret/);
      expect(bot.handleUpdate).not.toHaveBeenCalled();
    });

    it('rejects a forged (wrong) secret header', async () => {
      process.env.TELEGRAM_WEBHOOK_DOMAIN = 'nearventure.ru';
      process.env.TELEGRAM_WEBHOOK_SECRET = 's3cret';
      const bot = webhookBot();
      const ctrl = new TelegramController(bot, makeAuth(), makeLastRoute(), makeSessions(), makeDrafts(), makeOwners());
      await expect(ctrl.handleWebhook({ update_id: 1 } as any, 'wrong-secret')).rejects.toThrow(/Invalid webhook secret/);
      expect(bot.handleUpdate).not.toHaveBeenCalled();
    });

    it('fails closed when webhook mode is active but no secret is configured', async () => {
      process.env.TELEGRAM_WEBHOOK_DOMAIN = 'nearventure.ru';
      delete process.env.TELEGRAM_WEBHOOK_SECRET;
      const bot = webhookBot();
      const ctrl = new TelegramController(bot, makeAuth(), makeLastRoute(), makeSessions(), makeDrafts(), makeOwners());
      await expect(ctrl.handleWebhook({ update_id: 1 } as any, undefined)).rejects.toThrow(/Webhook secret not configured/);
      expect(bot.handleUpdate).not.toHaveBeenCalled();
    });

    // Hostile-domain bypass: a public hostname that merely CONTAINS
    // "localhost" (e.g. localhost.example.com) must NOT downgrade the
    // endpoint to unauthenticated polling mode.
    it('fails closed for a public domain containing localhost with no secret (hostile bypass)', async () => {
      process.env.TELEGRAM_WEBHOOK_DOMAIN = 'localhost.example.com';
      delete process.env.TELEGRAM_WEBHOOK_SECRET;
      const bot = webhookBot();
      const ctrl = new TelegramController(bot, makeAuth(), makeLastRoute(), makeSessions(), makeDrafts(), makeOwners());
      await expect(ctrl.handleWebhook({ update_id: 1 } as any, undefined)).rejects.toThrow(/Webhook secret not configured/);
      expect(bot.handleUpdate).not.toHaveBeenCalled();
    });

    it('also rejects a forged secret for a localhost-containing public domain', async () => {
      process.env.TELEGRAM_WEBHOOK_DOMAIN = 'localhost.example.com';
      process.env.TELEGRAM_WEBHOOK_SECRET = 's3cret';
      const bot = webhookBot();
      const ctrl = new TelegramController(bot, makeAuth(), makeLastRoute(), makeSessions(), makeDrafts(), makeOwners());
      await expect(ctrl.handleWebhook({ update_id: 1 } as any, 'wrong')).rejects.toThrow(/Invalid webhook secret/);
      expect(bot.handleUpdate).not.toHaveBeenCalled();
    });

    it('accepts a valid secret header and forwards the update', async () => {
      process.env.TELEGRAM_WEBHOOK_DOMAIN = 'nearventure.ru';
      process.env.TELEGRAM_WEBHOOK_SECRET = 's3cret';
      const bot = webhookBot();
      const ctrl = new TelegramController(bot, makeAuth(), makeLastRoute(), makeSessions(), makeDrafts(), makeOwners());
      const res = await ctrl.handleWebhook({ update_id: 1 } as any, 's3cret');
      expect(res).toEqual({ ok: true });
      expect(bot.handleUpdate).toHaveBeenCalledWith({ update_id: 1 });
    });

    it('still rejects a missing header when a secret is configured even in polling mode (defense in depth)', async () => {
      delete process.env.TELEGRAM_WEBHOOK_DOMAIN; // polling mode
      process.env.TELEGRAM_WEBHOOK_SECRET = 's3cret';
      const bot = webhookBot();
      const ctrl = new TelegramController(bot, makeAuth(), makeLastRoute(), makeSessions(), makeDrafts(), makeOwners());
      await expect(ctrl.handleWebhook({ update_id: 1 } as any, undefined)).rejects.toThrow(/Invalid webhook secret/);
      expect(bot.handleUpdate).not.toHaveBeenCalled();
    });

    it('allows unauthenticated updates in dev polling mode without a secret', async () => {
      delete process.env.TELEGRAM_WEBHOOK_DOMAIN;
      delete process.env.TELEGRAM_WEBHOOK_SECRET;
      const bot = webhookBot();
      const ctrl = new TelegramController(bot, makeAuth(), makeLastRoute(), makeSessions(), makeDrafts(), makeOwners());
      const res = await ctrl.handleWebhook({ update_id: 1 } as any, undefined);
      expect(res).toEqual({ ok: true });
      expect(bot.handleUpdate).toHaveBeenCalled();
    });
  });
});
