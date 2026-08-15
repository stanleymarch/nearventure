import { test, expect } from '../fixtures';
import type { Page } from '@playwright/test';
import axios from 'axios';
import { assertDestructiveE2ESafe, isE2ESafeMode } from '../safety';

// This file includes a user-creation test. Outside safe mode, reject an unsafe
// target during discovery too, including CDP/direct runs that skip global setup.
const SAFE_MODE = isE2ESafeMode();
if (!SAFE_MODE) assertDestructiveE2ESafe();
const destructiveDescribe = SAFE_MODE ? test.describe.skip : test.describe;

const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:5173';
const API_URL = process.env.E2E_API_URL || 'http://localhost:3000/api';

// Unique user name for this test run (avoids conflicts with previous runs)
const TEST_USER_LOGIN = `test-user-${Date.now()}`;

test.describe('Basic smoke tests', () => {

  // ── Test 1: Login to admin panel ──────────────────────────────────
  test('should login to admin panel and redirect to users page', async ({ connectedPage: page }) => {
    await page.goto(`${BASE_URL}/#/login`);
    await page.getByPlaceholder('admin').waitFor({ state: 'visible', timeout: 10_000 });

    await page.getByPlaceholder('admin').fill('admin');
    await page.getByPlaceholder('••••••••').fill('admin123');
    await page.getByRole('button', { name: 'Войти' }).click();

    // Wait for redirect to admin/users page
    await page.waitForURL(/\/#\/admin/, { timeout: 15_000 });
    await expect(page.getByRole('heading', { name: 'Пользователи' })).toBeVisible({ timeout: 10_000 });

    // Verify login succeeded — auth token should be stored
    const token = await page.evaluate(() => localStorage.getItem('auth_token'));
    expect(token).toBeTruthy();
  });

  // ── Test 2: Create a new user via UI ──────────────────────────────
  destructiveDescribe('destructive user creation', () => {
    test.beforeEach(() => assertDestructiveE2ESafe());

    test('should create a new user', async ({ connectedPage: page }) => {
      // Login first
      await page.goto(`${BASE_URL}/#/login`);
      await page.getByPlaceholder('admin').fill('admin');
      await page.getByPlaceholder('••••••••').fill('admin123');
      await page.getByRole('button', { name: 'Войти' }).click();
      await page.waitForURL(/\/#\/admin/, { timeout: 15_000 });
      await page.getByRole('heading', { name: 'Пользователи' }).waitFor({ state: 'visible', timeout: 10_000 });

      // Click "Создать пользователя" button
      await page.getByRole('button', { name: 'Создать пользователя' }).click();

      // Fill the form with unique user name
      await page.getByPlaceholder('username').fill(TEST_USER_LOGIN);
      await page.getByPlaceholder('Минимум 4 символа').fill('test1234');
      await page.getByRole('button', { name: 'Создать' }).click();

      // Verify user appears in the table (exact match in a table cell)
      await expect(page.getByRole('cell', { name: TEST_USER_LOGIN, exact: true })).toBeVisible({ timeout: 10_000 });
    });
  });

  // ── Test 3: Landing page hero section ────────────────────────────
  test('should show landing page hero section', async ({ connectedPage: page }) => {
    // Navigate to public landing page
    await page.goto(`${BASE_URL}/#/`);
    // Wait for the fade-in animation
    await page.waitForTimeout(500);

    // Check for a key hero element — the title should contain "Вятка" or "Nearventure"
    // or the CTA button should be visible
    const ctaButton = page.locator('button:has-text("Создать маршрут"), a:has-text("Создать маршрут")').first();
    await expect(ctaButton).toBeVisible({ timeout: 10_000 });

    // Verify the navigation to map works
    await ctaButton.click();
    await page.waitForURL('**/map', { timeout: 10_000 });
    await page.waitForSelector('.adventure-map', { state: 'visible', timeout: 10_000 });
    
    // Map should be loaded
    const mapElement = await page.locator('.adventure-map');
    await expect(mapElement).toBeVisible();
  });

});
