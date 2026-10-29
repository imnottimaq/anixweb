import { test, expect } from '@playwright/test';
import { setupDeterministicNetwork } from '../e2e/helpers/network';
import { seedStorageState } from '../e2e/helpers/auth';

test.beforeEach(async ({ page }) => {
    await setupDeterministicNetwork(page);
    await seedStorageState(page, { settings: { appearance: { language: 'english' } } });
});

test.describe('route recovery', () => {
test.use({ serviceWorkers: 'block' });

test('subpath production navigation and unknown-route recovery work', async ({ page }) => {
    await page.goto('settings');
    await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
    await page.goto('missing-page');
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
    await page.locator('main').getByRole('link', { name: 'Home', exact: true }).click();
    await expect(page).toHaveURL(/\/anixweb\/$/);
});

test('a missing production lazy chunk exposes recovery without crashing the navigation', async ({ page }) => {
    test.slow();
    await page.route('**/assets/SettingsScreen-*.js', route => route.abort());
    await page.goto('settings');
    await expect(page.getByRole('heading', { name: 'Could not open this page' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Primary navigation' })).toBeVisible();
    await page.unroute('**/assets/SettingsScreen-*.js');
    await Promise.all([
        page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}),
        page.getByRole('button', { name: 'Try again' }).click(),
    ]);
    await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible({ timeout: 30000 });
});
});

test('the installed shell reloads and opens an unvisited lazy route offline', async ({ page, context, browserName }) => {
    test.skip(browserName !== 'chromium', 'Offline service-worker behavior is exercised in Chromium; cross-browser route recovery runs above.');
    await page.goto('');
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
    await context.setOffline(true);
    try {
        await page.goto('settings');
        await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
        await page.reload();
        await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
        await page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('link', { name: 'Home', exact: true }).click();
        await expect(page).toHaveURL(/\/anixweb\/$/);
        await page.reload();
        await expect(page.getByRole('navigation', { name: 'Primary navigation' })).toBeVisible();
    } finally { await context.setOffline(false); }
});
