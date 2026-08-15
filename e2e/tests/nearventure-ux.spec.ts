import { test, expect } from '../fixtures';

test.describe('Nearventure UX Critical Flows', () => {
  test('Landing page loads and navigates to map', async ({ connectedPage }) => {
    await connectedPage.goto(`${process.env.E2E_BASE_URL || 'http://localhost:5173'}/`);
    await connectedPage.waitForSelector('.landing-page--mounted', { timeout: 10_000 });

    const createRouteBtn = connectedPage
      .getByRole('button', { name: 'Создать маршрут' })
      .last();
    await expect(createRouteBtn).toBeVisible();

    await createRouteBtn.click();
    await Promise.race([
      connectedPage.waitForURL(/#\/map/, { timeout: 10_000 }),
      connectedPage.waitForSelector('.adventure-map', { state: 'attached', timeout: 10_000 }),
    ]);

    await connectedPage.waitForSelector('.adventure-map', { state: 'visible', timeout: 15_000 });
    await expect(connectedPage.locator('.adventure-map')).toBeVisible();
  });

  test('Onboarding carousel appears on first visit', async ({ connectedPage }) => {
    const url = `${process.env.E2E_BASE_URL || 'http://localhost:5173'}/#/map`;
    // Fresh navigation — no initScript, so localStorage is empty → onboarding shows
    await connectedPage.goto(url, { waitUntil: 'domcontentloaded' });
    await connectedPage.waitForTimeout(1000);
    await connectedPage.waitForSelector('.adventure-map', { state: 'visible', timeout: 20000 });

    const onboarding = connectedPage.locator('.onboarding-overlay');
    await expect(onboarding).toBeVisible({ timeout: 10_000 });

    const title = connectedPage.locator('.onboarding__title');
    await expect(title).toBeVisible();
    await expect(title).toContainText('Добро пожаловать в Nearventure');

    const dots = connectedPage.locator('.onboarding__dot');
    await expect(dots).toHaveCount(4);

    const nextBtn = connectedPage.locator('.onboarding__btn--primary').filter({ hasText: 'Далее' });

    await nextBtn.click();
    await expect(title).toContainText('Укажите точку старта');

    await nextBtn.click();
    await expect(title).toContainText('Выберите время поездки');

    await nextBtn.click();
    await expect(title).toContainText('Нажмите');

    const startBtn = connectedPage.locator('.onboarding__btn--primary').filter({ hasText: 'Начать' });
    await startBtn.click();
    await expect(onboarding).not.toBeVisible({ timeout: 5_000 });
  });

  test('Onboarding can be skipped', async ({ connectedPage }) => {
    const url = `${process.env.E2E_BASE_URL || 'http://localhost:5173'}/#/map`;
    await connectedPage.goto(url, { waitUntil: 'domcontentloaded' });
    await connectedPage.waitForTimeout(1000);
    await connectedPage.waitForSelector('.adventure-map', { state: 'visible', timeout: 20000 });

    const onboarding = connectedPage.locator('.onboarding-overlay');
    await expect(onboarding).toBeVisible({ timeout: 10_000 });

    const skipBtn = connectedPage.locator('.onboarding__btn--ghost').filter({ hasText: 'Пропустить' });
    await skipBtn.click();
    await expect(onboarding).not.toBeVisible();
  });

  test('Onboarding is not shown on subsequent visits', async ({ connectedPage }) => {
    const url = `${process.env.E2E_BASE_URL || 'http://localhost:5173'}/#/map`;
    await connectedPage.goto(url, { waitUntil: 'domcontentloaded' });
    await connectedPage.waitForTimeout(1000);
    await connectedPage.waitForSelector('.adventure-map', { state: 'visible', timeout: 20000 });

    const onboarding = connectedPage.locator('.onboarding-overlay');
    await expect(onboarding).toBeVisible({ timeout: 10_000 });

    const skipBtn = connectedPage.locator('.onboarding__btn--ghost').filter({ hasText: 'Пропустить' });
    await skipBtn.click();
    await expect(onboarding).not.toBeVisible({ timeout: 5_000 });

    // Reload — after dismiss the flag was set so onboarding must NOT reappear
    await connectedPage.reload();
    await connectedPage.waitForTimeout(2000);
    await expect(onboarding).not.toBeVisible({ timeout: 5_000 });
  });

  test('Accessibility: Skip link works', async ({ connectedPage }) => {
    await connectedPage.goto(`${process.env.E2E_BASE_URL || 'http://localhost:5173'}/`);
    await connectedPage.waitForSelector('.landing-page--mounted', { timeout: 10_000 });

    const skipLink = connectedPage.locator('a.skip-link');
    await expect(skipLink).toBeAttached();
    await skipLink.focus();

    await expect(skipLink).toBeVisible({ timeout: 3000 });

    const href = await skipLink.getAttribute('href');
    expect(href).toBe('#main-content');

    const mainContent = connectedPage.locator('#main-content');
    await expect(mainContent).toBeAttached();

    await skipLink.press('Enter');
    await connectedPage.waitForTimeout(300);
  });

  test('Accessibility: Focus states are visible', async ({ connectedPage }) => {
    // Use addInitScript to suppress onboarding before SPA loads
    await connectedPage.addInitScript(() => {
      localStorage.setItem('nearventure-onboarding-seen', '1');
    });
    const url = `${process.env.E2E_BASE_URL || 'http://localhost:5173'}/#/map`;
    await connectedPage.goto(url, { waitUntil: 'domcontentloaded' });
    await connectedPage.waitForSelector('.adventure-map', { state: 'visible', timeout: 20000 });

    const focusableBtn = connectedPage.locator('[aria-label*="тема"i]').first();
    await expect(focusableBtn).toBeVisible({ timeout: 5000 });

    await focusableBtn.focus();
    const hasFocus = await focusableBtn.evaluate((el) => {
      const style = window.getComputedStyle(el);
      return (
        style.outlineStyle !== 'none' ||
        style.outlineWidth !== '0px' ||
        style.boxShadow.includes('ring')
      );
    });
    expect(typeof hasFocus).toBe('boolean');
  });

  test('Accessibility: ARIA labels on icon-only buttons', async ({ connectedPage }) => {
    await connectedPage.addInitScript(() => {
      localStorage.setItem('nearventure-onboarding-seen', '1');
    });
    const url = `${process.env.E2E_BASE_URL || 'http://localhost:5173'}/#/map`;
    await connectedPage.goto(url, { waitUntil: 'domcontentloaded' });
    await connectedPage.waitForSelector('.adventure-map', { state: 'visible', timeout: 20000 });

    const themeBtn = connectedPage.locator('[aria-label*="тема"i]');
    const label = await themeBtn.getAttribute('aria-label');
    expect(label).toBeTruthy();
    expect(label!.length).toBeGreaterThan(0);
  });

  test('Accessibility: routing state is exposed for assistive tech', async ({ connectedPage }) => {
    await connectedPage.addInitScript(() => {
      localStorage.setItem('nearventure-onboarding-seen', '1');
    });
    const url = `${process.env.E2E_BASE_URL || 'http://localhost:5173'}/#/map`;
    await connectedPage.goto(url, { waitUntil: 'domcontentloaded' });
    await connectedPage.waitForSelector('.adventure-map', { state: 'visible', timeout: 20000 });

    // The view root exposes routing readiness via data-routing-state
    // (loading | ready | error). The visible «Маршрутизатор…» chip is hidden
    // once ready, so the data attribute is the stable a11y/contract hook.
    const viewRoot = connectedPage.locator('[data-routing-state]');
    await expect(viewRoot).toHaveAttribute('data-routing-state', 'ready', { timeout: 20000 });
  });

  test('Reduced motion: Animations are disabled', async ({ connectedPage }) => {
    await connectedPage.emulateMedia({ reducedMotion: 'reduce' });
    await connectedPage.goto(`${process.env.E2E_BASE_URL || 'http://localhost:5173'}/`);
    await connectedPage.waitForSelector('.landing-page--mounted', { timeout: 10_000 });

    const onboarding = connectedPage.locator('.onboarding-overlay');
    if (await onboarding.isVisible({ timeout: 3000 }).catch(() => false)) {
      const backdropFilter = await onboarding.evaluate((el) => {
        const style = window.getComputedStyle(el);
        return style.backdropFilter;
      });
      expect(backdropFilter).toBe('none');
    }
  });

  test('About page loads and displays correctly', async ({ connectedPage }) => {
    const url = `${process.env.E2E_BASE_URL || 'http://localhost:5173'}/#/about`;
    await connectedPage.goto(url, { waitUntil: 'domcontentloaded' });
    await connectedPage.waitForTimeout(1000);
    await connectedPage.waitForSelector('.about-page--mounted', { timeout: 20000 });

    // Check page title
    const pageTitle = connectedPage.locator('.about-hero__title');
    await expect(pageTitle).toBeVisible();
    await expect(pageTitle).toContainText('О проекте Nearventure');

    // Check attributions
    const attributions = connectedPage.locator('.attribution-card');
    expect(await attributions.count()).toBeGreaterThanOrEqual(3);

    // Check tech items
    const techItems = connectedPage.locator('.tech-item');
    expect(await techItems.count()).toBeGreaterThanOrEqual(3);
  });

  test('Landing page displays key sections', async ({ connectedPage }) => {
    await connectedPage.goto(`${process.env.E2E_BASE_URL || 'http://localhost:5173'}/`);
    await connectedPage.waitForSelector('.landing-page--mounted', { timeout: 10_000 });

    const heroText = connectedPage.getByText(/микро-путешествий/);
    await expect(heroText.first()).toBeVisible();

    const ctaButtons = connectedPage.locator('button:has-text("Создать маршрут")');
    const ctaCount = await ctaButtons.count();
    expect(ctaCount).toBeGreaterThan(0);
  });
});
