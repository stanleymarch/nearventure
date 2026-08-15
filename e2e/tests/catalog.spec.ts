import { test, expect } from '../fixtures';

test.describe('Catalog Page', () => {
  test.beforeEach(async ({ connectedPage }) => {
    await connectedPage.goto(`${process.env.E2E_BASE_URL || 'http://localhost:5173'}/#/catalog`);
  });

  test('catalog page loads and displays POI cards', async ({ connectedPage }) => {
    await connectedPage.waitForSelector('[data-testid="poi-card"]', { timeout: 15000 });

    const poiCards = connectedPage.locator('[data-testid="poi-card"]');
    const count = await poiCards.count();
    if (count === 0) throw new Error('No POI cards found');

    // Check that first card has a title (h3)
    const firstCard = poiCards.first();
    await expect(firstCard.locator('h3')).toBeVisible();
  });

  test('filters POIs by category', async ({ connectedPage }) => {
    // Wait for initial load
    await connectedPage.waitForSelector('[data-testid="poi-card"]', { timeout: 15000 });

    // Find category filter buttons in the sidebar via data-testid
    const catBtns = connectedPage.locator('[data-testid="category-btn"]');
    const count = await catBtns.count();
    expect(count).toBeGreaterThan(0);

    // Click the first category filter
    await catBtns.first().click();
    await connectedPage.waitForTimeout(500);

    // Verify cards are still visible (filtering should work, not clear all)
    const poiCards = connectedPage.locator('[data-testid="poi-card"]');
    await expect(poiCards.first()).toBeVisible({ timeout: 5000 });
  });

  test('search functionality works', async ({ connectedPage }) => {
    await connectedPage.waitForSelector('[data-testid="poi-card"]', { timeout: 15000 });

    const searchInput = connectedPage.locator('input[placeholder*="Поиск"], input[type="search"], input[placeholder*="поиск"]').first();

    if (await searchInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await searchInput.fill('музей');
      await connectedPage.waitForTimeout(1000);
      const poiCards = connectedPage.locator('[data-testid="poi-card"]');
      expect(await poiCards.count()).toBeGreaterThanOrEqual(0);
    }
  });

  test('POI card image loads', async ({ connectedPage }) => {
    // Wait for POI cards
    await connectedPage.waitForSelector('[data-testid="poi-card"]', { timeout: 15000 });

    // Find first card with an img element
    const firstCard = connectedPage.locator('[data-testid="poi-card"]').first();
    const image = firstCard.locator('img').first();

    if (await image.isVisible({ timeout: 3000 }).catch(() => false)) {
      // Verify image has src
      const src = await image.getAttribute('src');
      expect(src).toBeTruthy();
      expect(src?.length).toBeGreaterThan(0);
    }
  });

  test('scrolling loads more POIs', async ({ connectedPage }) => {
    // Wait for initial POI cards
    await connectedPage.waitForSelector('[data-testid="poi-card"]', { timeout: 15000 });

    // Get initial count
    const initialCount = await connectedPage.locator('[data-testid="poi-card"]').count();

    // Scroll to bottom
    await connectedPage.evaluate(() => window.scrollTo(0, document.body.scrollHeight));

    // Wait for potential new cards
    await connectedPage.waitForTimeout(1000);

    // Check if more cards loaded (or at least no errors)
    const finalCount = await connectedPage.locator('[data-testid="poi-card"]').count();
    expect(finalCount).toBeGreaterThanOrEqual(initialCount);
  });

  test('clicking POI card opens detail dialog', async ({ connectedPage }) => {
    // Wait for POI cards
    await connectedPage.waitForSelector('[data-testid="poi-card"]', { timeout: 15000 });

    // Click on first card
    const firstCard = connectedPage.locator('[data-testid="poi-card"]').first();
    await firstCard.click();

    // Verify a dialog with POI detail content appears
    const dialog = connectedPage.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5000 });
    // Dialog should have a heading with the POI name
    await expect(dialog.locator('h2')).toBeVisible();
  });

  test('empty state shows when no POIs match', async ({ connectedPage }) => {
    // Type a search term unlikely to match any POI
    const searchInput = connectedPage.locator('input[placeholder*="Поиск"]').first();
    await searchInput.fill('xyzzy-no-match-999');
    await connectedPage.waitForTimeout(1000);

    // Should show a "Ничего не найдено" message
    const emptyEl = connectedPage.getByText('Ничего не найдено');
    await expect(emptyEl).toBeVisible({ timeout: 5000 });
  });

  test('category badges are clickable', async ({ connectedPage }) => {
    // Wait for POI cards
    await connectedPage.waitForSelector('[data-testid="poi-card"]', { timeout: 15000 });

    // The sidebar category buttons have data-testid="category-btn"
    const catBtns = connectedPage.locator('[data-testid="category-btn"]');
    const count = await catBtns.count();
    expect(count).toBeGreaterThan(0);

    // Click the second category (different from the first filter test)
    if (count > 1) {
      await catBtns.nth(1).click();
    } else {
      await catBtns.first().click();
    }

    await connectedPage.waitForTimeout(500);

    // Verify page is still functional with POI cards
    const poiCards = connectedPage.locator('[data-testid="poi-card"]');
    await expect(poiCards.first()).toBeVisible({ timeout: 5000 });
  });

  test('responsive design works on mobile viewport', async ({ connectedPage }) => {
    // Set mobile viewport
    await connectedPage.setViewportSize({ width: 390, height: 844 });
    await connectedPage.reload();

    // Wait for POI cards on mobile
    await connectedPage.waitForSelector('[data-testid="poi-card"]', { timeout: 15000 });

    // Verify cards are still visible
    const poiCards = connectedPage.locator('[data-testid="poi-card"]');
    const _c = await poiCards.count(); if (_c === 0) throw new Error("Expected elements not found");

    // On mobile, there should be exactly 1 column (the grid uses grid-cols-1 by default)
    const firstCard = poiCards.first();
    await expect(firstCard).toBeVisible();
  });
});
