import { test, expect } from '@playwright/test';
import { setupDeterministicNetwork } from './helpers/network';
import { seedStorageState } from './helpers/auth';
import { mockAnimeDetail, mockEpisodes } from './fixtures/mockData';

for (const viewport of [{ width: 360, height: 640 }, { width: 740, height: 360 }]) {
    test(`picker and nested confirmation fit ${viewport.width}x${viewport.height}`, async ({ page }) => {
        await page.setViewportSize(viewport);
        await setupDeterministicNetwork(page, { isLoggedIn: true });
        await seedStorageState(page, { isLoggedIn: true, onboarded: true });
        await page.goto('/anime/101');
        await expect(page.getByRole('heading', { name: mockAnimeDetail.title_ru })).toBeVisible();
        const play = page.getByRole('button', { name: /Play|Воспроизвести/i });
        await play.click();
        const picker = page.getByRole('dialog');
        await expect(page.getByText(mockEpisodes[0].name)).toBeVisible();
        const bounds = await picker.boundingBox();
        expect(bounds).not.toBeNull();
        expect(bounds!.x).toBeGreaterThanOrEqual(0);
        expect(bounds!.y).toBeGreaterThanOrEqual(0);
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width);
        expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height);
        await picker.getByRole('button', { name: /^(Watched|Просмотрено)$/i }).click();
        await expect(page.getByRole('dialog')).toHaveCount(2);
        await page.keyboard.press('Escape');
        await expect(page.getByRole('dialog')).toHaveCount(1);
        await expect(picker).toBeVisible();
        await page.screenshot({ path: `test-results/modal-${viewport.width}x${viewport.height}.png`, animations: 'disabled' });
        await page.keyboard.press('Escape');
        await expect(page.getByRole('dialog')).toHaveCount(0);
        await expect(play).toBeFocused();
        expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');
    });
}
