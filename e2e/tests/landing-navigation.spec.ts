import { test, expect } from '../fixtures';

test.describe('Landing navigation', () => {
  test('opens the catalog from the persistent landing navigation', async ({ connectedPage }) => {
    const baseUrl = process.env.E2E_BASE_URL || 'http://localhost:5173';
    await connectedPage.goto(`${baseUrl}/#/`);

    const catalog = connectedPage.getByRole('link', { name: 'Каталог' });
    await expect(catalog).toBeVisible();
    await catalog.click();
    await expect(connectedPage).toHaveURL(/#\/catalog$/);
  });
});
