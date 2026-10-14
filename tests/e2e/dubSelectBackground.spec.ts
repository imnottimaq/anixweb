import { test, expect } from '@playwright/test';
import { setupDeterministicNetwork } from './helpers/network';
import { seedStorageState } from './helpers/auth';
import { mockAnimeDetail, mockEpisodes } from './fixtures/mockData';
import { defaultAppSettings } from '../../src/shared/types/settings';

const DESKTOP_VIEWPORT = { width: 1280, height: 720 };

function getAlpha(colorStr: string): number {
  if (!colorStr || colorStr === 'transparent') return 0;
  if (colorStr.startsWith('rgb(')) return 1;
  const match = colorStr.match(/rgba\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*,\s*([\d.]+)\s*\)/);
  if (match) return parseFloat(match[1]);
  return 1;
}

test.describe('DubSelect Background and Theme Verification', () => {
  test('Dark, Light and Custom theme modal dialog and control backgrounds are opaque, anime cards remain transparent', async ({ page }) => {
    await page.setViewportSize(DESKTOP_VIEWPORT);
    await setupDeterministicNetwork(page, { isLoggedIn: true });

    // 1. Dark Theme
    await seedStorageState(page, {
      isLoggedIn: true,
      onboarded: true,
      settings: { ...defaultAppSettings, appearance: { ...defaultAppSettings.appearance, theme: 'dark' } },
    });

    await page.goto('/anime/101');
    await expect(page.getByRole('heading', { name: mockAnimeDetail.title_ru })).toBeVisible();

    // Verify anime cards are transparent
    const cardLocator = page.locator('a[class*="card"]').first();
    await expect(cardLocator).toBeVisible();
    const darkCardBgAlpha = await cardLocator.evaluate(el => {
      const bg = window.getComputedStyle(el).backgroundColor;
      if (!bg || bg === 'transparent') return 0;
      if (bg.startsWith('rgb(')) return 1;
      const m = bg.match(/rgba\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*,\s*([\d.]+)\s*\)/);
      return m ? parseFloat(m[1]) : 1;
    });
    expect(darkCardBgAlpha).toBe(0);

    // Open DubSelect Modal
    await page.getByRole('button', { name: /Воспроизвести|Play/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(page.getByText(mockEpisodes[0].name)).toBeVisible();

    // Verify dialog computed background alpha is 1
    const darkDialogBg = await dialog.evaluate(el => window.getComputedStyle(el).backgroundColor);
    const darkDialogAlpha = getAlpha(darkDialogBg);
    expect(darkDialogAlpha).toBe(1);

    // Verify native select and option computed background are opaque (alpha 1)
    const darkSelect = dialog.locator('select').first();
    await expect(darkSelect).toBeVisible();
    const darkSelectBg = await darkSelect.evaluate(el => window.getComputedStyle(el).backgroundColor);
    expect(getAlpha(darkSelectBg)).toBe(1);

    const darkOption = dialog.locator('select option').first();
    const darkOptionBg = await darkOption.evaluate(el => window.getComputedStyle(el).backgroundColor);
    expect(getAlpha(darkOptionBg)).toBe(1);

    // Capture Dark Screenshot
    await page.screenshot({ path: 'test-results/dub-select-background-dark.png', animations: 'disabled' });

    // Close Modal
    await page.getByRole('button', { name: /Закрыть|Close/i }).click();
    await expect(dialog).toBeHidden();

    // 2. Light Theme
    await page.evaluate(() => {
      const raw = localStorage.getItem('app_settings');
      const s = raw ? JSON.parse(raw) : {};
      s.appearance = { ...(s.appearance || {}), theme: 'light' };
      localStorage.setItem('app_settings', JSON.stringify(s));
    });
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(page.getByRole('heading', { name: mockAnimeDetail.title_ru })).toBeVisible();

    // Verify anime cards are transparent in light theme
    const lightCardBgAlpha = await cardLocator.evaluate(el => {
      const bg = window.getComputedStyle(el).backgroundColor;
      if (!bg || bg === 'transparent') return 0;
      if (bg.startsWith('rgb(')) return 1;
      const m = bg.match(/rgba\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*,\s*([\d.]+)\s*\)/);
      return m ? parseFloat(m[1]) : 1;
    });
    expect(lightCardBgAlpha).toBe(0);

    // Open DubSelect Modal
    await page.getByRole('button', { name: /Воспроизвести|Play/i }).click();
    await expect(dialog).toBeVisible();
    await expect(page.getByText(mockEpisodes[0].name)).toBeVisible();

    // Verify dialog computed background alpha is 1
    const lightDialogBg = await dialog.evaluate(el => window.getComputedStyle(el).backgroundColor);
    const lightDialogAlpha = getAlpha(lightDialogBg);
    expect(lightDialogAlpha).toBe(1);

    // Verify native select and option computed background are opaque (alpha 1)
    const lightSelect = dialog.locator('select').first();
    await expect(lightSelect).toBeVisible();
    const lightSelectBg = await lightSelect.evaluate(el => window.getComputedStyle(el).backgroundColor);
    expect(getAlpha(lightSelectBg)).toBe(1);

    const lightOption = dialog.locator('select option').first();
    const lightOptionBg = await lightOption.evaluate(el => window.getComputedStyle(el).backgroundColor);
    expect(getAlpha(lightOptionBg)).toBe(1);

    // Capture Light Screenshot
    await page.screenshot({ path: 'test-results/dub-select-background-light.png', animations: 'disabled' });

    // Close Modal
    await page.getByRole('button', { name: /Закрыть|Close/i }).click();
    await expect(dialog).toBeHidden();

    // 3. Custom Theme
    await page.evaluate(() => {
      const raw = localStorage.getItem('app_settings');
      const s = raw ? JSON.parse(raw) : {};
      s.appearance = {
        ...(s.appearance || {}),
        theme: 'dark',
        customColors: {
          enabled: true,
          backgroundColor: '#0f172a',
          accentColor: '#38bdf8',
          autoTextColor: true,
        },
      };
      localStorage.setItem('app_settings', JSON.stringify(s));
    });
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-custom-colors', 'true');

    // Open DubSelect Modal
    await page.getByRole('button', { name: /Воспроизвести|Play/i }).click();
    await expect(dialog).toBeVisible();
    await expect(page.getByText(mockEpisodes[0].name)).toBeVisible();

    const customDialogBg = await dialog.evaluate(el => window.getComputedStyle(el).backgroundColor);
    expect(getAlpha(customDialogBg)).toBe(1);

    const customSelect = dialog.locator('select').first();
    const customSelectBg = await customSelect.evaluate(el => window.getComputedStyle(el).backgroundColor);
    expect(getAlpha(customSelectBg)).toBe(1);

    const customOption = dialog.locator('select option').first();
    const customOptionBg = await customOption.evaluate(el => window.getComputedStyle(el).backgroundColor);
    expect(getAlpha(customOptionBg)).toBe(1);

    await page.screenshot({ path: 'test-results/dub-select-background-custom.png', animations: 'disabled' });
  });
});
