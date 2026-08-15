import { test, expect, type Locator, type Page } from '../fixtures';

const mapUrl = `${process.env.E2E_BASE_URL || 'http://localhost:5173'}/#/map`;

type Rgb = [number, number, number];

type ThemeColors = {
  workspace: Rgb;
  activeSubtitle: Rgb;
};

const themes: Record<'light' | 'dark', ThemeColors> = {
  light: { workspace: [255, 255, 252], activeSubtitle: [255, 255, 255] },
  dark: { workspace: [18, 24, 19], activeSubtitle: [82, 34, 8] },
};

async function openPlanner(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('nearventure-onboarding-seen', '1');
  });
  await page.goto(mapUrl, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.adventure-map')).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Подобрать маршрут' }).click();
  await expect(page.locator('[aria-label="Тип транспорта"]')).toBeVisible();
}

function rgb(color: string): Rgb {
  const channels = color.match(/\d+(?:\.\d+)?/g)?.slice(0, 3).map(Number);
  if (!channels || channels.length !== 3) throw new Error(`Expected resolved RGB color, got ${color}`);
  return channels as Rgb;
}

function contrastRatio(foreground: Rgb, background: Rgb) {
  const luminance = (color: Rgb) => color.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  }).reduce((total, value, index) => total + value * [0.2126, 0.7152, 0.0722][index], 0);
  const [first, second] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (first + 0.05) / (second + 0.05);
}

/** Read rendered CSS colors rather than custom-property aliases. */
async function cardColors(card: Locator) {
  return card.evaluate((element) => {
    const subtitle = element.querySelector('.transport-card-subtitle');
    const workspace = element.closest('.route-workspace');
    if (!subtitle || !workspace) throw new Error('Transport card context is missing');
    const style = getComputedStyle(element);
    return {
      background: style.backgroundColor,
      border: style.borderTopColor,
      subtitle: getComputedStyle(subtitle).color,
      workspace: getComputedStyle(workspace).backgroundColor,
    };
  });
}

async function assertTransportContrast(card: Locator, theme: ThemeColors) {
  const rest = await cardColors(card);
  // Resting cards are transparent, but RouteWorkspace is intentionally opaque.
  expect(rgb(rest.workspace)).toEqual(theme.workspace);
  expect(contrastRatio(rgb(rest.border), rgb(rest.workspace))).toBeGreaterThanOrEqual(3);
  await card.hover();
  const hover = await cardColors(card);
  expect(contrastRatio(rgb(hover.border), rgb(hover.background))).toBeGreaterThanOrEqual(3);
}

async function assertFocusVisible(page: Page, card: Locator) {
  // Programmatic focus alone does not necessarily match :focus-visible.
  // Move away and return with Tab to exercise the keyboard-visible state.
  await card.focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect(card).toBeFocused();
  expect(await card.evaluate((element) => element.matches(':focus-visible'))).toBe(true);
  expect(await card.evaluate((element) => getComputedStyle(element).boxShadow)).not.toBe('none');
}

test.describe('Planner transport-card visual states', () => {
  test('uses semantic boundary, hover, and active subtitle contrast in light and dark themes', async ({ connectedPage }) => {
    await openPlanner(connectedPage);

    const bike = connectedPage.getByRole('button', { name: 'Велосипед', exact: true });
    const foot = connectedPage.getByRole('button', { name: 'Пешком', exact: true });
    await expect(bike).toHaveAttribute('data-state', 'on');
    await assertTransportContrast(foot, themes.light);

    const lightActive = await cardColors(bike);
    expect(rgb(lightActive.subtitle)).toEqual(themes.light.activeSubtitle);
    expect(contrastRatio(rgb(lightActive.subtitle), rgb(lightActive.background))).toBeGreaterThanOrEqual(4.5);
    await assertFocusVisible(connectedPage, foot);

    await connectedPage.evaluate(() => document.documentElement.classList.add('dark'));
    await assertTransportContrast(foot, themes.dark);
    const darkActive = await cardColors(bike);
    expect(rgb(darkActive.subtitle)).toEqual(themes.dark.activeSubtitle);
    expect(contrastRatio(rgb(darkActive.subtitle), rgb(darkActive.background))).toBeGreaterThanOrEqual(4.5);
    await assertFocusVisible(connectedPage, foot);
  });
});
