import { test, expect, type Page, type Route } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { setupDeterministicNetwork } from './helpers/network';
import { seedStorageState } from './helpers/auth';
import { mockAnime1, mockAnime2, mockAnimeDetail, mockProfile, mockDubs, mockSources, mockEpisodes, createPagedResponse } from './fixtures/mockData';
import { defaultAppSettings } from '../../src/shared/types/settings';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DESKTOP_VIEWPORT = { width: 1920, height: 1080 };
const MOBILE_VIEWPORT = { width: 390, height: 844 };

const FIXTURES_DIR = path.resolve(__dirname, '../fixtures/images');
const aotPosterBuffer = fs.readFileSync(path.join(FIXTURES_DIR, 'aot_poster.jpg'));
const jjkPosterBuffer = fs.readFileSync(path.join(FIXTURES_DIR, 'jjk_poster.jpg'));
const demonSlayerPosterBuffer = fs.readFileSync(path.join(FIXTURES_DIR, 'demonslayer_poster.jpg'));
const aotBannerBuffer = fs.readFileSync(path.join(FIXTURES_DIR, 'aot_banner.jpg'));

const mockDiscoverInteresting = [
  {
    id: 1,
    title: 'Атака титанов: Финал',
    description: 'Эпическая битва за будущее человечества разворачивается на континенте Марли.',
    image: 'https://images.example.com/banner1.jpg',
    release: mockAnime1,
  },
];

const mockDiscoverComments = [
  {
    id: 1,
    profile: mockProfile,
    release: mockAnime1,
    message: 'Невероятная режиссура и накал эмоций в финальной части. Саундтрек от Хироюки Савано как всегда на высоте!',
    timestamp: 1700000000,
    vote_count: 42,
    reply_count: 3,
    is_spoiler: false,
  },
  {
    id: 2,
    profile: { ...mockProfile, id: 2, login: 'MegumiFan' },
    release: mockAnime2,
    message: 'Анимация битв во второго сезоне просто поражает воображение. MAPPA держит планку качества.',
    timestamp: 1700000100,
    vote_count: 28,
    reply_count: 1,
    is_spoiler: false,
  },
];

async function setupApiMocks(page: Page) {
  await setupDeterministicNetwork(page, { isLoggedIn: true });

  // Override image interception specifically in designCapture runs to serve real representative anime artwork
  await page.route(
    /(images\.example\.com|\.(jpe?g|png|webp|gif))(\?.*)?$/i,
    async (route: Route) => {
      const url = route.request().url();
      if (url.includes('anime101.jpg') || url.includes('/release/101')) {
        return route.fulfill({ status: 200, contentType: 'image/jpeg', body: aotPosterBuffer });
      }
      if (url.includes('anime102.jpg') || url.includes('/release/102')) {
        return route.fulfill({ status: 200, contentType: 'image/jpeg', body: jjkPosterBuffer });
      }
      if (url.includes('anime103.jpg') || url.includes('/release/103')) {
        return route.fulfill({ status: 200, contentType: 'image/jpeg', body: demonSlayerPosterBuffer });
      }
      if (url.includes('banner1.jpg') || url.includes('shot101_') || url.includes('shot102_')) {
        return route.fulfill({ status: 200, contentType: 'image/jpeg', body: aotBannerBuffer });
      }
      return route.fulfill({ status: 200, contentType: 'image/jpeg', body: aotPosterBuffer });
    }
  );

  await page.route('https://api-s.anixsekai.com/**', async (route: Route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;

    if (path === '/discover/interesting') {
      return route.fulfill({ json: { code: 0, content: mockDiscoverInteresting } });
    }
    if (path.startsWith('/discover/recommendations') || path.startsWith('/discover/watching') || path === '/discover/discussing') {
      return route.fulfill({ json: createPagedResponse([mockAnime1, mockAnime2]) });
    }
    if (path === '/discover/comments') {
      return route.fulfill({ json: { code: 0, content: mockDiscoverComments } });
    }
    if (path.startsWith('/filter/')) {
      return route.fulfill({ json: createPagedResponse([mockAnime1, mockAnime2]) });
    }
    if (path.includes('/favorite') || path.includes('/profile/list/all/') || path.includes('/collectionFavorite') || path.includes('/history')) {
      return route.fulfill({ json: createPagedResponse([mockAnime1, mockAnime2]) });
    }
    if (path === '/release/101' || path === `/release/${mockAnimeDetail.id}`) {
      return route.fulfill({ json: { code: 0, release: mockAnimeDetail } });
    }
    if (path.includes('/episode/')) {
      const parts = path.split('/').filter(Boolean);
      if (parts.length >= 4) return route.fulfill({ json: { code: 0, episodes: mockEpisodes } });
      if (parts.length === 3) return route.fulfill({ json: { code: 0, sources: mockSources } });
      return route.fulfill({ json: { code: 0, types: mockDubs } });
    }
    return route.fallback();
  });
}

async function switchTheme(page: Page, theme: 'dark' | 'light') {
  await page.evaluate((t: string) => {
    const raw = localStorage.getItem('app_settings');
    const s = raw ? JSON.parse(raw) : {};
    s.appearance = { ...(s.appearance || {}), theme: t };
    localStorage.setItem('app_settings', JSON.stringify(s));
  }, theme);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
}

async function waitForPosterLoaded(page: Page) {
  await page.waitForFunction(() => {
    const img = document.querySelector('img[class*="poster"], [class*="poster"] img, [class*="poster-wrapper"] img') as HTMLImageElement | null;
    return img && img.complete && img.naturalWidth > 1;
  }, { timeout: 6000 }).catch(() => {});
}

test.describe('Design Inspection Screenshots', () => {
  test.setTimeout(90000);

  test('Capture Desktop 1920 Dark and Light views with computed style verifications', async ({ page }) => {
    await page.setViewportSize(DESKTOP_VIEWPORT);
    await setupApiMocks(page);

    // 1. Home Desktop Dark
    await seedStorageState(page, {
      isLoggedIn: true,
      onboarded: true,
      settings: { ...defaultAppSettings, appearance: { ...defaultAppSettings.appearance, theme: 'dark' } },
    });
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.getByRole('link', { name: new RegExp(mockAnime1.title_ru, 'i') })).toBeVisible();
    await waitForPosterLoaded(page);

    // Verify logo wordmark font is Varela Round
    const logoText = page.locator('header a[class*="nav-logo-block"] p');
    await expect(logoText).toBeVisible();
    const logoFont = await logoText.evaluate(el => window.getComputedStyle(el).fontFamily);
    expect(logoFont.toLowerCase()).toContain('varela round');

    // Verify header navigation: Overview available, Popular & Schedule absent
    const nav = page.locator('header nav#primary-navigation');
    await expect(nav.getByRole('link', { name: /Обзор|Overview/i })).toBeVisible();
    expect(await nav.getByRole('link', { name: /Популярное|Popular/i }).count()).toBe(0);
    expect(await nav.getByRole('link', { name: /Расписание|Schedule/i }).count()).toBe(0);

    // Verify Home sidebar typography
    const homeSidebarBtn = page.locator('div[class*="side-panel"] button').first();
    await expect(homeSidebarBtn).toBeVisible();
    const homeSidebarStyle = await homeSidebarBtn.evaluate(el => {
      const cs = window.getComputedStyle(el);
      return {
        fontSize: cs.fontSize,
        fontWeight: cs.fontWeight,
        lineHeight: cs.lineHeight,
        paddingTop: cs.paddingTop,
        paddingRight: cs.paddingRight,
        paddingBottom: cs.paddingBottom,
        paddingLeft: cs.paddingLeft,
      };
    });
    expect(homeSidebarStyle.fontSize).toBe('15px');
    expect(homeSidebarStyle.fontWeight).toBe('400');
    expect(homeSidebarStyle.lineHeight).toBe('21px');
    expect(homeSidebarStyle.paddingTop).toBe('13px');
    expect(homeSidebarStyle.paddingRight).toBe('15px');

    // Verify card hover neutral (no accent glow/border)
    const animeCard = page.locator('a[class*="card"]').first();
    await animeCard.hover();
    const hoverBorder = await animeCard.evaluate(el => window.getComputedStyle(el).borderColor);
    const hoverShadow = await animeCard.evaluate(el => window.getComputedStyle(el).boxShadow);
    expect(hoverBorder).not.toBe('rgb(255, 96, 96)');
    expect(hoverShadow).toBe('none');

    await page.screenshot({ path: 'test-results/style-revert-home-desktop-dark.png', animations: 'disabled' });
    await page.screenshot({ path: 'test-results/design-home-desktop-dark.png', animations: 'disabled' });

    // 2. Home Desktop Light
    await switchTheme(page, 'light');
    await expect(page.getByRole('link', { name: new RegExp(mockAnime1.title_ru, 'i') })).toBeVisible();
    await waitForPosterLoaded(page);
    await page.screenshot({ path: 'test-results/style-revert-home-desktop-light.png', animations: 'disabled' });
    await page.screenshot({ path: 'test-results/design-home-desktop-light.png', animations: 'disabled' });

    // 3. Favorites Desktop Light & Dark (with matching sidebar check)
    await page.goto('/favorites');
    await waitForPosterLoaded(page);
    await page.screenshot({ path: 'test-results/style-revert-favorites-desktop-light.png', animations: 'disabled' });

    await switchTheme(page, 'dark');
    await waitForPosterLoaded(page);
    await page.screenshot({ path: 'test-results/style-revert-favorites-desktop-dark.png', animations: 'disabled' });
    const favSidebarBtn = page.locator('div[class*="side-panel"] button').first();
    await expect(favSidebarBtn).toBeVisible();
    const favSidebarStyle = await favSidebarBtn.evaluate(el => {
      const cs = window.getComputedStyle(el);
      return {
        fontSize: cs.fontSize,
        fontWeight: cs.fontWeight,
        lineHeight: cs.lineHeight,
        paddingTop: cs.paddingTop,
        paddingRight: cs.paddingRight,
        paddingBottom: cs.paddingBottom,
        paddingLeft: cs.paddingLeft,
      };
    });
    expect(favSidebarStyle).toEqual(homeSidebarStyle);

    // 4. Overview Desktop Dark
    await page.goto('/overview');
    await expect(page.getByText('Интересное')).toBeVisible();
    await waitForPosterLoaded(page);
    await page.screenshot({ path: 'test-results/design-overview-desktop-dark.png', animations: 'disabled' });

    // 5. Release Desktop Dark
    await page.goto('/anime/101');
    await expect(page.getByRole('heading', { name: mockAnimeDetail.title_ru })).toBeVisible();
    await waitForPosterLoaded(page);
    await page.screenshot({ path: 'test-results/style-revert-release-desktop-dark.png', animations: 'disabled' });
    await page.screenshot({ path: 'test-results/design-release-desktop-dark.png', animations: 'disabled' });

    // 6. Dub Picker Modal Desktop Dark
    await page.getByRole('button', { name: /Воспроизвести|Play/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByText(mockEpisodes[0].name)).toBeVisible();
    await page.waitForTimeout(250);
    await page.screenshot({ path: 'test-results/design-dub-picker-desktop-dark.png', animations: 'disabled' });
    await page.getByRole('button', { name: /Закрыть|Close/i }).click();

    // 7. Release Desktop Light
    await switchTheme(page, 'light');
    await expect(page.getByRole('heading', { name: mockAnimeDetail.title_ru })).toBeVisible();
    await waitForPosterLoaded(page);
    await page.screenshot({ path: 'test-results/style-revert-release-desktop-light.png', animations: 'disabled' });
    await page.screenshot({ path: 'test-results/design-release-desktop-light.png', animations: 'disabled' });

    // 8. Settings Desktop Light
    await page.goto('/settings');
    await expect(page.getByRole('tab', { name: /Внешний вид|Appearance/i })).toBeVisible();
    await page.screenshot({ path: 'test-results/style-revert-settings-desktop-light.png', animations: 'disabled' });

    // 9. Settings Desktop Dark & rectangular tabs with readable accent labels
    await switchTheme(page, 'dark');
    await page.goto('/settings');
    await expect(page.getByRole('tab', { name: /Внешний вид|Appearance/i })).toBeVisible();
    const activeTab = page.locator('button[class*="tab-button"].active, button[class*="tab-button"][aria-selected="true"]').first();
    await expect(activeTab).toBeVisible();
    const activeTabStyle = await activeTab.evaluate(el => {
      const cs = window.getComputedStyle(el);
      const context = document.createElement('canvas').getContext('2d')!;
      const luminance = (color: string) => {
        context.clearRect(0, 0, 1, 1);
        context.fillStyle = color;
        context.fillRect(0, 0, 1, 1);
        const channels = [...context.getImageData(0, 0, 1, 1).data].slice(0, 3).map(value => {
          const normalized = value / 255;
          return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
        });
        return .2126 * channels[0] + .7152 * channels[1] + .0722 * channels[2];
      };
      const foreground = luminance(cs.color), background = luminance(cs.backgroundColor);
      return {
        contrast: (Math.max(foreground, background) + .05) / (Math.min(foreground, background) + .05),
        borderRadius: parseFloat(cs.borderRadius),
      };
    });
    expect(activeTabStyle.contrast).toBeGreaterThanOrEqual(4.5);
    expect(activeTabStyle.borderRadius).toBeLessThanOrEqual(10);

    await page.screenshot({ path: 'test-results/style-revert-settings-desktop-dark.png', animations: 'disabled' });
    await page.screenshot({ path: 'test-results/design-settings-desktop-dark.png', animations: 'disabled' });
  });

  test('Capture Mobile 390 Dark views and check release overflow', async ({ page }) => {
    await page.setViewportSize(MOBILE_VIEWPORT);
    await setupApiMocks(page);
    await seedStorageState(page, {
      isLoggedIn: true,
      onboarded: true,
      settings: { ...defaultAppSettings, appearance: { ...defaultAppSettings.appearance, theme: 'dark' } },
    });

    // 1. Home Mobile Dark
    await page.goto('/');
    await expect(page.getByRole('link', { name: new RegExp(mockAnime1.title_ru, 'i') })).toBeVisible();
    await waitForPosterLoaded(page);
    await page.screenshot({ path: 'test-results/style-revert-home-mobile-dark.png', animations: 'disabled' });
    await page.screenshot({ path: 'test-results/design-home-mobile-dark.png', animations: 'disabled' });

    // 2. Navigation Mobile Dark (Drawer Open)
    const toggle = page.getByRole('button', { name: /Меню|Menu/i });
    if (await toggle.count() > 0 && await toggle.first().isVisible()) {
      await toggle.first().click();
      await expect(page.getByRole('navigation', { name: /Основная навигация|Primary navigation/i })).toBeVisible();
      await page.keyboard.press('Escape');
    } else {
      await expect(page.getByRole('navigation', { name: /Нижняя навигация|Bottom navigation/i })).toBeVisible();
    }
    await page.screenshot({ path: 'test-results/design-navigation-mobile-dark.png', animations: 'disabled' });

    // 3. Favorites Mobile Dark
    await page.goto('/favorites');
    await waitForPosterLoaded(page);
    await page.screenshot({ path: 'test-results/style-revert-favorites-mobile-dark.png', animations: 'disabled' });

    // 4. Release Mobile Dark - Viewport capture and Full-page capture to inspect complete hierarchy
    await page.goto('/anime/101');
    await expect(page.getByRole('heading', { name: mockAnimeDetail.title_ru })).toBeVisible();
    await waitForPosterLoaded(page);
    await page.screenshot({ path: 'test-results/style-revert-release-mobile-dark.png', animations: 'disabled' });
    await page.screenshot({ path: 'test-results/design-release-mobile-dark.png', animations: 'disabled' });
    await page.screenshot({ path: 'test-results/design-release-mobile-fullpage.png', fullPage: true, animations: 'disabled' });

    // Release 390px and 360px overflow checks
    for (const vp of [{ width: 390, height: 844 }, { width: 360, height: 740 }]) {
      await page.setViewportSize(vp);
      await page.goto('/anime/101');
      await expect(page.getByRole('heading', { name: mockAnimeDetail.title_ru })).toBeVisible();
      await expect(page.getByRole('button', { name: /Воспроизвести|Play/i })).toBeVisible();
      const hasHorizontalOverflow = await page.evaluate(() => {
        return document.documentElement.scrollWidth > window.innerWidth ||
               document.body.scrollWidth > window.innerWidth;
      });
      expect(hasHorizontalOverflow).toBe(false);
    }

    // 5. Dub Picker Modal Mobile Dark
    await page.setViewportSize(MOBILE_VIEWPORT);
    await page.goto('/anime/101');
    await page.getByRole('button', { name: /Воспроизвести|Play/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByText(mockEpisodes[0].name)).toBeVisible();
    await page.waitForTimeout(250);
    await page.screenshot({ path: 'test-results/design-dub-picker-mobile-dark.png', animations: 'disabled' });
    await page.getByRole('button', { name: /Закрыть|Close/i }).click();

    // 6. Settings Mobile Dark
    await page.goto('/settings');
    await expect(page.getByRole('tab', { name: /Внешний вид|Appearance/i })).toBeVisible();
    await page.screenshot({ path: 'test-results/style-revert-settings-mobile-dark.png', animations: 'disabled' });
    await page.screenshot({ path: 'test-results/design-settings-mobile-dark.png', animations: 'disabled' });
  });
});
