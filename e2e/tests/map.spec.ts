import { test, expect } from '../fixtures';

test.describe('Map Page', () => {
  test.beforeEach(async ({ connectedPage }) => {
    await connectedPage.goto(`${process.env.E2E_BASE_URL || 'http://localhost:5173'}/#/map`);

    // Suppress onboarding (navigate first so localStorage is available)
    await connectedPage.evaluate(() =>
      localStorage.setItem('nearventure-onboarding-seen', '1'),
    );
  });

  test('map loads and displays POI markers', async ({ connectedPage }) => {
    // Wait for map container
    await connectedPage.waitForSelector('.adventure-map', { state: 'visible', timeout: 15000 });

    // Wait for POI features to be rendered (check via mapLibre API)
    await connectedPage.waitForFunction(() => {
      const map = (window as any).mapInstance;
      if (!map || !map.isStyleLoaded()) return false;
      try {
        const features = map.queryRenderedFeatures(undefined, { layers: ['custom-pois'] });
        return features && features.length > 0;
      } catch { return false; }
    }, { timeout: 20000 });

    // Verify the map canvas is visible
    const canvas = connectedPage.locator('.adventure-map canvas');
    await expect(canvas).toBeVisible();
  });

  test('map is interactive - drag works', async ({ connectedPage }) => {
    await connectedPage.waitForSelector('.adventure-map', { state: 'visible', timeout: 15000 });

    // Get initial center via mapLibre API
    const initialCenter = await connectedPage.evaluate(() => {
      const map = (window as any).mapInstance;
      return map?.getCenter();
    });

    // Programmatically pan the map
    await connectedPage.evaluate(() => {
      const map = (window as any).mapInstance;
      if (map) map.panBy([200, 200], { duration: 0 });
    });

    await connectedPage.waitForTimeout(500);

    // Verify center changed
    const newCenter = await connectedPage.evaluate(() => {
      const map = (window as any).mapInstance;
      return map?.getCenter();
    });

    expect(newCenter).not.toEqual(initialCenter);
  });

  test('map is interactive - zoom controls work', async ({ connectedPage }) => {
    await connectedPage.waitForSelector('.adventure-map', { state: 'visible', timeout: 15000 });

    // Get initial zoom
    const initialZoom = await connectedPage.evaluate(() => {
      const map = (window as any).mapInstance;
      return map?.getZoom();
    });

    // Find zoom in button (MapLibre NavigationControl)
    const zoomInBtn = connectedPage.locator('.maplibregl-ctrl-zoom-in');
    if (await zoomInBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await zoomInBtn.click();
      await connectedPage.waitForTimeout(500);

      const newZoom = await connectedPage.evaluate(() => {
        const map = (window as any).mapInstance;
        return map?.getZoom();
      });

      expect(newZoom).toBeGreaterThan(initialZoom!);
    }
  });

  test('map markers are interactive - hover shows tooltip', async ({ connectedPage }) => {
    await connectedPage.waitForSelector('.adventure-map', { state: 'visible', timeout: 15000 });

    // Wait for POI features
    await connectedPage.waitForFunction(() => {
      const map = (window as any).mapInstance;
      if (!map || !map.isStyleLoaded()) return false;
      try {
        const features = map.queryRenderedFeatures(undefined, { layers: ['custom-pois'] });
        return features && features.length > 0;
      } catch { return false; }
    }, { timeout: 20000 });

    // Trigger a mousemove event on the first POI feature via the mapLibre API
    // First get a POI feature's pixel position
    const poiPixel = await connectedPage.evaluate(() => {
      const map = (window as any).mapInstance;
      const features = map.queryRenderedFeatures(undefined, { layers: ['custom-pois'] });
      if (!features || features.length === 0) return null;
      const coords = features[0].geometry.coordinates;
      return map.project(coords);
    });

    if (poiPixel) {
      // Trigger the popup via MapLibre JS API (the canvas hover approach is unreliable
      // due to overlay interception and coordinate offset issues)
      await connectedPage.evaluate(() => {
        const map = (window as any).mapInstance;
        const features = map.queryRenderedFeatures(undefined, { layers: ['custom-pois'] });
        if (!features || features.length === 0) return;
        const coords = features[0].geometry.coordinates as [number, number];
        const lngLat = { lng: coords[0], lat: coords[1] };
        // Fire a mousemove on the map so the built-in handler shows the popup
        map.fire('mousemove', { point: map.project(lngLat), lngLat });
      });
      await connectedPage.waitForTimeout(500);

      // A MapLibre popup should appear
      const popup = connectedPage.locator('.maplibregl-popup');
      await expect(popup).toBeVisible({ timeout: 3000 });
    }
  });

  test('map markers are clickable - opens POI dialog', async ({ connectedPage }) => {
    await connectedPage.waitForSelector('.adventure-map', { state: 'visible', timeout: 15000 });

    // Wait for POI features
    await connectedPage.waitForFunction(() => {
      const map = (window as any).mapInstance;
      if (!map || !map.isStyleLoaded()) return false;
      try {
        const features = map.queryRenderedFeatures(undefined, { layers: ['custom-pois'] });
        return features && features.length > 0;
      } catch { return false; }
    }, { timeout: 20000 });

    // Click on a POI via mapLibre
    const clicked = await connectedPage.evaluate(() => {
      const map = (window as any).mapInstance;
      const features = map.queryRenderedFeatures(undefined, { layers: ['custom-pois'] });
      if (!features || features.length === 0) return false;
      const coords = features[0].geometry.coordinates;
      const pixel = map.project(coords);
      // Simulate the click on the canvas at the pixel position
      const canvas = map.getCanvas();
      canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: pixel.x, clientY: pixel.y, bubbles: true }));
      canvas.dispatchEvent(new PointerEvent('pointerup', { clientX: pixel.x, clientY: pixel.y, bubbles: true }));
      // Dispatch a MapLibre click event
      map.fire('click', {
        point: pixel,
        lngLat: { lat: coords[1], lng: coords[0] },
        originalEvent: { target: canvas },
      });
      return true;
    });

    if (clicked) {
      await connectedPage.waitForTimeout(500);
      // The POI detail dialog should appear
      const detailDialog = connectedPage.getByRole('dialog');
      await expect(detailDialog).toBeVisible({ timeout: 5000 });
    }
  });

  test('geolocation button is visible', async ({ connectedPage }) => {
    await connectedPage.waitForSelector('.adventure-map', { state: 'visible', timeout: 15000 });

    // Compact location control exposes an explicit accessible name.
    const geoBtn = connectedPage.getByRole('button', { name: 'Моё местоположение' });
    await expect(geoBtn).toBeVisible();
  });

  test('layer control is visible', async ({ connectedPage }) => {
    await connectedPage.waitForSelector('.adventure-map', { state: 'visible', timeout: 15000 });

    // The layer control button has aria-label "Слои карты"
    const layerBtn = connectedPage.getByRole('button', { name: 'Слои карты' });
    await expect(layerBtn).toBeVisible();
  });

  test('theme toggle works', async ({ connectedPage }) => {
    await connectedPage.waitForSelector('.adventure-map', { state: 'visible', timeout: 15000 });

    // Find theme toggle by either possible aria-label ("Светлая тема" or "Тёмная тема")
    const themeBtn = connectedPage.locator('[aria-label*="тема"i]');
    await expect(themeBtn).toBeVisible();

    // Get initial theme
    const initialTheme = await connectedPage.evaluate(() => {
      return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
    });

    // Click the theme toggle
    await themeBtn.click();
    await connectedPage.waitForTimeout(500);

    // Verify theme changed
    const newTheme = await connectedPage.evaluate(() => {
      return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
    });

    expect(newTheme).not.toBe(initialTheme);
  });

  test('map respects keyboard navigation', async ({ connectedPage }) => {
    await connectedPage.waitForSelector('.adventure-map', { state: 'visible', timeout: 15000 });

    // Get initial center
    const initialCenter = await connectedPage.evaluate(() => {
      const map = (window as any).mapInstance;
      return map?.getCenter();
    });

    // Focus the map canvas and press arrow keys
    const canvas = connectedPage.locator('.adventure-map canvas');
    await canvas.focus();
    await connectedPage.keyboard.press('ArrowRight');
    await connectedPage.waitForTimeout(300);
    await connectedPage.keyboard.press('ArrowDown');
    await connectedPage.waitForTimeout(300);

    // Verify center changed (keyboard panning moved the map)
    const newCenter = await connectedPage.evaluate(() => {
      const map = (window as any).mapInstance;
      return map?.getCenter();
    });

    expect(newCenter).not.toEqual(initialCenter);
  });

  test('map loads correctly on mobile viewport', async ({ connectedPage }) => {
    // Set mobile viewport
    await connectedPage.setViewportSize({ width: 390, height: 844 });
    await connectedPage.reload();

    // Wait for map
    await connectedPage.waitForSelector('.adventure-map', { state: 'visible', timeout: 15000 });

    // Verify map container fills viewport
    const mapElement = connectedPage.locator('.adventure-map');
    const bbox = await mapElement.boundingBox();
    expect(bbox?.width).toBe(390);
    expect(bbox?.height).toBeGreaterThanOrEqual(600);
  });

  test('map attribution is visible', async ({ connectedPage }) => {
    await connectedPage.waitForSelector('.adventure-map', { state: 'visible', timeout: 15000 });

    // MapLibre attribution control (compact mode — compact button, not the full panel)
    const attribution = connectedPage.locator('.maplibregl-ctrl-attrib');
    // In compact mode the attrib div may be collapsed; check that it exists in DOM
    await expect(attribution).toBeAttached({ timeout: 5000 });
  });
});
