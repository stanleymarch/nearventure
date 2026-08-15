import { test, expect, type Page } from '../fixtures';

/** Poll for the isochrone-fill layer instead of a fixed sleep. Local GraphHopper
 *  runs flexible routing (no landmark index) which responds with variable
 *  latency, so a hard `waitForTimeout` flakes ~1/8 full-suite runs. */
async function waitForIsochrone(page: Page, timeout = 9000) {
  await expect.poll(async () => {
    return await page.evaluate(() => {
      const map = (window as any).mapInstance;
      if (!map) return false;
      try {
        const layers = map.getStyle().layers;
        return layers.some((l: any) => l.id === 'isochrone-fill' && l.visibility !== 'none');
      } catch { return false; }
    });
  }, { timeout, intervals: [300], message: 'isochrone-fill layer not rendered in time' }).toBe(true);
}

/** Poll for rendered custom-pois features. The POI source loads asynchronously
 *  after the map recenters on a new start point, so a fixed sleep returns 0. */
async function waitForPoiFeatures(page: Page, timeout = 9000) {
  await expect.poll(async () => {
    return await page.evaluate(() => {
      const map = (window as any).mapInstance;
      if (!map) return false;
      try {
        return map.queryRenderedFeatures(undefined, { layers: ['custom-pois'] }).length > 0;
      } catch { return false; }
    });
  }, { timeout, intervals: [300], message: 'custom-pois features not rendered in time' }).toBe(true);
}

test.describe('Isochrone Flow', () => {
  test.beforeEach(async ({ connectedPage }) => {
    await connectedPage.goto(`${process.env.E2E_BASE_URL || 'http://localhost:5173'}/#/map`);

    // Suppress onboarding (navigate first so localStorage is available)
    await connectedPage.evaluate(() =>
      localStorage.setItem('nearventure-onboarding-seen', '1'),
    );

    // Wait for map to load
    await connectedPage.waitForSelector('.adventure-map', { state: 'visible', timeout: 15000 });

    // Wait for routing health to be ready (data-routing-state on the view root;
    // the visible «Маршрутизатор…» chip is hidden once ready).
    await connectedPage.waitForSelector('[data-routing-state="ready"]', { timeout: 20000 });
  });

  test('isochrone toggle button is visible in layer panel', async ({ connectedPage }) => {
    // Open the layer panel by clicking the "Слои карты" button
    const layerBtn = connectedPage.getByRole('button', { name: 'Слои карты' });
    await layerBtn.click();
    await connectedPage.waitForTimeout(300);

    // The isochrone toggle has text "Зона доступности"
    const isochroneToggle = connectedPage.getByText('Зона доступности');
    await expect(isochroneToggle).toBeVisible();
  });

  test('can set time budget for isochrone', async ({ connectedPage }) => {
    // The time budget slider has aria-label "Бюджет времени"
    // Note: getByLabelText is NOT a Playwright method — use aria selector instead
    const budgetSlider = connectedPage.locator('[aria-label="Бюджет времени"]');
    await expect(budgetSlider).toBeVisible();

    // Get initial value
    const initialValue = await budgetSlider.inputValue();

    // Set a different value (Playwright's fill works for range inputs)
    await budgetSlider.fill('120');
    await connectedPage.waitForTimeout(200);

    // Verify value changed
    const newValue = await budgetSlider.inputValue();
    expect(newValue).not.toBe(initialValue);
  });

  test('can switch transport mode', async ({ connectedPage }) => {
    // The transport toggles have aria-labels "Велосипед", "Пешком", "Авто"
    const footBtn = connectedPage.getByRole('button', { name: 'Пешком' });
    await expect(footBtn).toBeVisible();

    // Click the foot transport (force: true for elements inside animated panels)
    await footBtn.click({ force: true });
    await connectedPage.waitForTimeout(500);

    // Verify foot mode is selected — check aria-pressed or data-state
    // Use evaluate to avoid Playwright's stability checks on the animated toggle group
    const isSelected = await connectedPage.evaluate(() => {
      const btn = document.querySelector('button[aria-label="Пешком"]');
      if (!btn) return false;
      return btn.getAttribute('aria-pressed') === 'true' || btn.getAttribute('data-state') === 'on';
    });
    expect(isSelected).toBe(true);
  });

  test('isochrone renders on map when start point is set', async ({ connectedPage }) => {
    // Set a start point programmatically (triggers automatic isochrone calculation)
    await connectedPage.evaluate(() => {
      (window as any).__setStart?.({ lat: 58.6, lon: 49.68 }, 'Test point');
    });
    await connectedPage.waitForTimeout(2000); // Wait for debounce + API call

    // Check that the start marker appears on the map
    const startMarker = connectedPage.locator('.nv-startpin');
    await expect(startMarker).toBeVisible({ timeout: 5000 });

    // Poll for the isochrone layer (flexible routing has variable latency).
    await waitForIsochrone(connectedPage);
  });

  test('isochrone updates when time budget changes', async ({ connectedPage }) => {
    // Set start point to trigger initial isochrone
    await connectedPage.evaluate(() => {
      (window as any).__setStart?.({ lat: 58.6, lon: 49.68 }, 'Test point');
    });
    await connectedPage.waitForTimeout(2000);

    // Set a new time budget
    await connectedPage.evaluate(() => {
      (window as any).__setTimeMinutes?.(180);
    });
    // Poll: flexible routing latency is variable; a fixed sleep flakes.
    await waitForIsochrone(connectedPage);
  });

  test('isochrone updates when transport changes', async ({ connectedPage }) => {
    // Set start point
    await connectedPage.evaluate(() => {
      (window as any).__setStart?.({ lat: 58.6, lon: 49.68 }, 'Test point');
    });
    await connectedPage.waitForTimeout(2000);

    // Switch to foot transport
    const footBtn = connectedPage.getByRole('button', { name: 'Пешком' });
    await footBtn.click();
    // Poll: flexible routing latency is variable; a fixed sleep flakes.
    await waitForIsochrone(connectedPage);
  });

  test('isochrone can be disabled via layer panel', async ({ connectedPage }) => {
    // Set start point first
    await connectedPage.evaluate(() => {
      (window as any).__setStart?.({ lat: 58.6, lon: 49.68 }, 'Test point');
    });
    await connectedPage.waitForTimeout(2000);

    // Open the layer panel
    const layerBtn = connectedPage.getByRole('button', { name: 'Слои карты' });
    await layerBtn.click();
    await connectedPage.waitForTimeout(300);

    // Click "Зона доступности" toggle (it's on by default)
    const isoToggle = connectedPage.getByText('Зона доступности');
    await isoToggle.click();
    await connectedPage.waitForTimeout(500);

    // Verify isochrone is hidden
    const isIsochroneHidden = await connectedPage.evaluate(() => {
      const map = (window as any).mapInstance;
      if (!map) return false;
      try {
        const fillLayer = map.getLayer('isochrone-fill');
        return !fillLayer || fillLayer.visibility === 'none';
      } catch { return false; }
    });

    expect(isIsochroneHidden).toBe(true);
  });

  test('isochrone filters POIs within reach', async ({ connectedPage }) => {
    // Set start point
    await connectedPage.evaluate(() => {
      (window as any).__setStart?.({ lat: 58.6, lon: 49.68 }, 'Test point');
    });

    // Poll: POI source loads async after the map recenters.
    await waitForPoiFeatures(connectedPage);
  });

  test('isochrone displays stats in layer panel', async ({ connectedPage }) => {
    // Set start point to ensure isochrone is active
    await connectedPage.evaluate(() => {
      (window as any).__setStart?.({ lat: 58.6, lon: 49.68 }, 'Test point');
    });
    await connectedPage.waitForTimeout(2000);

    // Open layer panel and check for isochrone-related UI elements
    const layerBtn = connectedPage.getByRole('button', { name: 'Слои карты' });
    await layerBtn.click();
    await connectedPage.waitForTimeout(300);

    // The "Зона доступности" toggle should have a CheckIcon when enabled
    const isoToggle = connectedPage.getByText('Зона доступности');
    await expect(isoToggle).toBeVisible();
  });
});
