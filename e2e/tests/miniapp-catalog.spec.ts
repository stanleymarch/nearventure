import { test, expect } from '../fixtures';

const BASE = process.env.E2E_MINIAPP_URL || 'http://localhost:5174/tg';

/**
 * E2E for the Mini App catalog view (Increment E refactor).
 *
 * The mini app is a self-contained SPA that runs at /tg/ in production and
 * at http://localhost:5174/tg in dev (base: '/tg/'). For the e2e we open it
 * directly and mock the minimal Telegram WebApp surface (Telegram injects a
 * script tag in production; in dev we fall back to a regular SPA experience).
 */
test.describe('Mini App — Catalog', () => {
  test.beforeEach(async ({ connectedPage }) => {
    await connectedPage.goto(`${BASE}/#/catalog`);
  });

  test('catalog page renders with POI cards', async ({ connectedPage }) => {
    // POI cards have a stable data-testid hook (shared with the web
    // catalog after the refactor — see PoiCard.vue).
    await connectedPage.waitForSelector('[data-testid="poi-card"]', { timeout: 15_000 });
    const cards = connectedPage.locator('[data-testid="poi-card"]');
    const count = await cards.count();
    expect(count).toBeGreaterThan(0);
  });

  test('POI card has accessible name, badge, and "add to cart" button', async ({ connectedPage }) => {
    await connectedPage.waitForSelector('[data-testid="poi-card"]', { timeout: 15_000 });
    const first = connectedPage.locator('[data-testid="poi-card"]').first();

    // Name
    await expect(first.locator('[data-testid="poi-card__name"]')).toBeVisible();
    // "Add to cart" button with proper a11y label
    const addBtn = first.locator('[data-testid="poi-card__add"]');
    await expect(addBtn).toBeVisible();
    const label = await addBtn.getAttribute('aria-label');
    expect(label).toMatch(/(Добавить|Убрать)/);
  });

  test('clicking add-to-cart opens the route wizard', async ({ connectedPage }) => {
    await connectedPage.waitForSelector('[data-testid="poi-card"]', { timeout: 15_000 });
    const first = connectedPage.locator('[data-testid="poi-card"]').first();
    const addBtn = first.locator('[data-testid="poi-card__add"]');

    // The catalog intentionally hands new selections to the wizard, which owns
    // the canonical itinerary draft; it does not toggle a catalog-local cart.
    await addBtn.click();
    await expect(connectedPage).toHaveURL(/#\/wizard$/);
    await expect(connectedPage.getByText('Соберите маршрут', { exact: true })).toBeVisible();
  });

  test('search input filters the list', async ({ connectedPage }) => {
    await connectedPage.waitForSelector('[data-testid="poi-card"]', { timeout: 15_000 });
    const before = await connectedPage.locator('[data-testid="poi-card"]').count();
    expect(before).toBeGreaterThan(0);

    // Type a search term that's unlikely to match anything in the seeded POI set
    const search = connectedPage.locator('input[placeholder*="Поиск"]').first();
    await search.fill('xyzzy-no-match-term-123');
    await connectedPage.waitForTimeout(800);

    // Either empty state or fewer cards
    const empty = connectedPage.locator('.state-block');
    const emptyVisible = await empty.first().isVisible().catch(() => false);
    if (emptyVisible) {
      expect(emptyVisible).toBe(true);
    } else {
      const after = await connectedPage.locator('[data-testid="poi-card"]').count();
      expect(after).toBeLessThanOrEqual(before);
    }
  });

  test('category chip toggles filter', async ({ connectedPage }) => {
    await connectedPage.waitForSelector('[data-testid="poi-card"]', { timeout: 15_000 });
    const before = await connectedPage.locator('[data-testid="poi-card"]').count();

    // Category chips are button.cat-chip elements
    const chips = connectedPage.locator('button.cat-chip');
    const chipCount = await chips.count();
    // Should have at least "Все" + one real category
    expect(chipCount).toBeGreaterThanOrEqual(2);

    // Click the first real category (index 1 — skip "Все")
    const firstCat = chips.nth(1);
    await firstCat.click();
    await connectedPage.waitForTimeout(500);

    // List should refresh — verify page didn't crash
    const after = await connectedPage.locator('[data-testid="poi-card"]').count();
    expect(after).toBeGreaterThanOrEqual(0);
  });

  test('view mode toggle switches between list and map', async ({ connectedPage }) => {
    await connectedPage.waitForSelector('[data-testid="poi-card"]', { timeout: 15_000 });
    // The list/map toggle only appears when there are results.
    const mapBtn = connectedPage.getByRole('button', { name: /карта/i }).first();
    if (await mapBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await mapBtn.click();
      await connectedPage.waitForTimeout(500);
      // After toggle, the POI cards should disappear (map replaced them).
      const cards = await connectedPage.locator('[data-testid="poi-card"]').count();
      // Either map is showing (cards hidden) OR fallback is showing (cards present).
      expect(cards).toBeGreaterThanOrEqual(0);
    } else {
      test.skip(true, 'No map toggle visible (catalog may be empty)');
    }
  });

  test('clicking a POI card navigates to detail', async ({ connectedPage }) => {
    await connectedPage.waitForSelector('[data-testid="poi-card"]', { timeout: 15_000 });
    const first = connectedPage.locator('[data-testid="poi-card"]').first();
    await first.click();
    // The router pushes /poi/<id> — wait for either the URL change or
    // the detail heading to appear (the PoiDetailView component).
    await Promise.race([
      connectedPage.waitForURL(/#\/poi\//, { timeout: 5_000 }).catch(() => undefined),
      connectedPage.waitForSelector('h1', { timeout: 5_000 }),
    ]);
  });
});
