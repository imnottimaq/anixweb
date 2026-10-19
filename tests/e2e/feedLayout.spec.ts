import { test, expect } from '@playwright/test';
import { setupDeterministicNetwork } from './helpers/network';
import { seedStorageState } from './helpers/auth';
import { defaultAppSettings } from '../../src/shared/types/settings';
import { feedArticle, feedPage } from '../fixtures/feed';

// Headless Chromium normally hides the classic scrollbars that trigger this shift.
test.use({ launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] } });

for (const width of [1280, 820]) {
test(`feed stays horizontally aligned while switching through a short loading state at ${width}px`, async ({ page }) => {
    await setupDeterministicNetwork(page, { isLoggedIn: true });
    await seedStorageState(page, { isLoggedIn: true, settings: { ...defaultAppSettings, appearance: { ...defaultAppSettings.appearance, language: 'english' } } });
    await page.route('https://api-s.anixsekai.com/**', route => {
        const path = new URL(route.request().url()).pathname;
        return route.fulfill({ json: path === '/channel/subscription/count'
            ? { code: 0, subscription_count: 1 } : feedPage([feedArticle]) });
    });
    await page.setViewportSize({ width, height: 700 });
    await page.addInitScript(() => document.addEventListener('DOMContentLoaded', () => {
        const style = document.createElement('style');
        style.textContent = '::-webkit-scrollbar { width: 16px; }';
        document.head.append(style);
    }));
    let finishLoading!: () => void;
    const pending = new Promise<void>(resolve => { finishLoading = resolve; });
    await page.route('**/feed/latest/all/0?*', async route => {
        await pending;
        await route.fulfill({ json: feedPage([feedArticle]) });
    });
    await page.goto('/feed?tab=my');
    await expect(page.getByRole('heading', { name: 'A new season begins' })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    const navigation = page.getByRole('navigation', { name: 'Feed', exact: true });
    const before = await navigation.boundingBox();
    await navigation.getByRole('link', { name: 'Latest', exact: true }).click();
    await expect(page.getByRole('status', { name: '' })).toBeVisible();
    const loading = await navigation.boundingBox();
    finishLoading();
    await expect(page.getByRole('heading', { name: 'A new season begins' })).toBeVisible();
    const loaded = await navigation.boundingBox();
    expect(loading!.x).toBeCloseTo(before!.x, 1);
    expect(loading!.width).toBeCloseTo(before!.width, 1);
    expect(loaded!.x).toBeCloseTo(before!.x, 1);
    await navigation.getByRole('link', { name: 'My feed', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'A new season begins' })).toBeVisible();
    expect((await navigation.boundingBox())!.x).toBeCloseTo(before!.x, 1);
});
}
