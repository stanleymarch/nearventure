/**
 * E2E test for MapLibre map loading
 * Verifies the map initializes correctly with different modes
 */

import { test, expect } from '@playwright/test';

test.describe('AdventureMap E2E', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${process.env.E2E_BASE_URL || 'http://localhost:5173'}/adventure`);
  });

  test('map container is present', async ({ page }) => {
    const mapContainer = page.locator('.adventure-map');
    await expect(mapContainer).toBeVisible();
  });

  test('map has control elements', async ({ page }) => {
    // MapLibre navigation control (zoom in/out)
    const zoomControls = page.locator('.maplibregl-ctrl-zoom');
    await expect(zoomControls).toBeVisible();
  });

  test('POI markers are displayed', async ({ page }) => {
    // Wait for map to load and markers to appear
    await page.waitForTimeout(2000);

    const markers = page.locator('.nv-marker');
    const markerCount = await markers.count();

    // Should have at least some POI markers if categories are active
    console.log(`Found ${markerCount} POI markers`);
    expect(markerCount).toBeGreaterThan(0);
  });

  test('map click emits event', async ({ page }) => {
    const mapContainer = page.locator('.adventure-map');

    // Click on the map (away from markers)
    await mapContainer.click({ position: { x: 100, y: 100 } });

    // In the real app, this would emit a map-click event
    // We'd need to verify this via console logs or the UI response
  });

  test('dark mode toggles map style', async ({ page }) => {
    // Take initial screenshot
    const lightSnapshot = await page.screenshot();

    // Toggle dark mode (via theme switcher if present, or localStorage)
    await page.evaluate(() => {
      localStorage.setItem('theme', 'dark');
      window.location.reload();
    });

    // Wait for reload
    await page.waitForLoadState('networkidle');

    // Take dark mode screenshot
    const darkSnapshot = await page.screenshot();

    // Screenshots should be different
    expect(lightSnapshot).not.toEqual(darkSnapshot);
  });
});

test.describe('AdventureMap responsive', () => {
  test('mobile viewport displays correctly', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 }); // iPhone SE
    await page.goto(`${process.env.E2E_BASE_URL || 'http://localhost:5173'}/adventure`);

    const mapContainer = page.locator('.adventure-map');
    await expect(mapContainer).toBeVisible();
    await expect(mapContainer).toHaveCSS('width', '100%');
  });

  test('tablet viewport displays correctly', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 }); // iPad
    await page.goto(`${process.env.E2E_BASE_URL || 'http://localhost:5173'}/adventure`);

    const mapContainer = page.locator('.adventure-map');
    await expect(mapContainer).toBeVisible();
    await expect(mapContainer).toHaveCSS('width', '100%');
  });

  test('desktop viewport displays correctly', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 }); // Desktop
    await page.goto(`${process.env.E2E_BASE_URL || 'http://localhost:5173'}/adventure`);

    const mapContainer = page.locator('.adventure-map');
    await expect(mapContainer).toBeVisible();
  });
});

test.describe('AdventureMap modes', () => {
  ['cycling', 'pedestrian', 'urban', 'neutral'].forEach(mode => {
    test(`${mode} mode loads`, async ({ page }) => {
      await page.goto(`${process.env.E2E_BASE_URL || 'http://localhost:5173'}/adventure?mode=${mode}`);

      const mapContainer = page.locator('.adventure-map');
      await expect(mapContainer).toBeVisible();

      // Wait for map to initialize
      await page.waitForTimeout(1000);

      // Take screenshot for manual review
      await page.screenshot({ path: `test-screenshots/map-${mode}-light.png` });
    });
  });
});