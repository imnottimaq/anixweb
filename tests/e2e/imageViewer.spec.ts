import { test, expect } from '@playwright/test';
import { setupDeterministicNetwork } from './helpers/network';
import { seedStorageState } from './helpers/auth';
import { mockAnimeDetail } from './fixtures/mockData';
import { defaultAppSettings } from '../../src/shared/types/settings';

test.use({ launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] } });

for (const theme of ['light', 'dark'] as const) {
    test(`photo backdrop covers the scrollbar gutter without shifting the page in ${theme} theme`, async ({ page }) => {
        await setupDeterministicNetwork(page);
        await seedStorageState(page, { settings: { ...defaultAppSettings, appearance: { ...defaultAppSettings.appearance, language: 'english', theme } } });
        await page.goto(`/anime/${mockAnimeDetail.id}`);
        const poster = page.getByRole('button', { name: 'Open image', exact: true });
        await expect(poster).toBeVisible();
        const before = (await poster.boundingBox())!.x;
        await poster.click();
        const viewer = page.getByRole('dialog');
        await expect(viewer).toBeVisible();
        const bounds = (await viewer.boundingBox())!;
        expect(bounds.x + bounds.width).toBe(await page.evaluate(() => innerWidth));
        expect(Math.abs((await poster.boundingBox())!.x - before)).toBeLessThan(1);
        await page.screenshot({ path: `test-results/image-viewer-no-gutter-${theme}.png` });
        await page.keyboard.press('Escape');
        await expect(viewer).toHaveCount(0);
        expect(Math.abs((await poster.boundingBox())!.x - before)).toBeLessThan(1);
    });
}

test('release poster and screenshots open in a fullscreen keyboard-accessible gallery', async ({ page }) => {
    await setupDeterministicNetwork(page);
    await seedStorageState(page, { settings: { appearance: { language: 'english' } } });
    await page.goto(`/anime/${mockAnimeDetail.id}`);
    const poster = page.getByRole('button', { name: 'Open image', exact: true });
    await poster.click();
    const viewer = page.getByRole('dialog');
    await expect(viewer.locator('img')).toHaveAttribute('src', mockAnimeDetail.image);
    await page.keyboard.press('Escape');
    await expect(viewer).toHaveCount(0);
    await expect(poster).toBeFocused();
    const screenshot = page.getByRole('button', { name: 'Screenshot 1', exact: true });
    await screenshot.click();
    await expect(viewer.locator('img')).toHaveAttribute('src', mockAnimeDetail.screenshot_images[0]);
    await page.keyboard.press('ArrowRight');
    await expect(viewer.locator('img')).toHaveAttribute('src', mockAnimeDetail.screenshot_images[1]);
    await viewer.getByRole('button', { name: 'Previous image' }).click();
    await expect(viewer.locator('img')).toHaveAttribute('src', mockAnimeDetail.screenshot_images[0]);
    await page.keyboard.press('Shift+Tab');
    expect(await viewer.evaluate(element => element.contains(document.activeElement))).toBe(true);
    await viewer.click({ position: { x: 4, y: 120 } });
    await expect(viewer).toHaveCount(0);
    await expect(screenshot).toBeFocused();
    expect(await page.locator('body').evaluate(element => element.style.overflow)).toBe('');
});
