import { test, expect, type Page } from '@playwright/test';
import { seedStorageState } from './helpers/auth';
import {
  mockAnimeDetail,
  mockRelatedAnime,
  mockAnime2,
  mockDubs,
  mockSources,
  mockEpisodes,
} from './fixtures/mockData';

async function findVisibleByText(page: Page, text: string | RegExp) {
  const matches = page.getByText(text);
  const count = await matches.count();
  for (let index = 0; index < count; index++) {
    const match = matches.nth(index);
    if (await match.isVisible()) return match;
  }
  throw new Error(`No visible match for text: ${text}`);
}

test.describe('Release screen flow', () => {
  test('displays loading state and then renders full release data', async ({ page }) => {
    let resolveRelease!: () => void;
    const releasePromise = new Promise<void>(resolve => {
      resolveRelease = resolve;
    });

    await page.route('**/*', async route => {
      const url = route.request().url();
      if (
        url.startsWith('http://127.0.0.1:') ||
        url.startsWith('http://localhost:') ||
        url.startsWith('data:') ||
        url.startsWith('blob:')
      ) {
        return route.continue();
      }

      if (url.includes(`/release/${mockAnimeDetail.id}`)) {
        await releasePromise;
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ code: 0, release: mockAnimeDetail }),
        });
      }

      if (url.includes('/release/comment/all/')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ code: 0, content: [] }),
        });
      }

      return route.abort();
    });

    await seedStorageState(page, { onboarded: true });
    await page.goto(`/anime/${mockAnimeDetail.id}`);

    // Verify loading overlay is visible
    const loadingOverlay = page.getByRole('status');
    await expect(loadingOverlay).toBeVisible();

    resolveRelease?.();

    // Verify loading is dismissed and release info is visible
    await expect(loadingOverlay).not.toBeVisible();
    await expect(page.getByRole('heading', { name: mockAnimeDetail.title_ru })).toBeVisible();
    await expect(await findVisibleByText(page, mockAnimeDetail.title_original)).toBeVisible();
    await expect(await findVisibleByText(page, mockAnimeDetail.description)).toBeVisible();
    await expect(await findVisibleByText(page, mockAnimeDetail.studio)).toBeVisible();

    // Related and recommended sections
    await expect(page.getByText(mockRelatedAnime.title_ru)).toBeVisible();
    await expect(await findVisibleByText(page, new RegExp(`^${mockAnime2.title_ru}$`))).toBeVisible();
  });

  test('opens episode selector modal with dub labels and episode list', async ({ page }) => {
    await page.route('**/*', async route => {
      const url = route.request().url();
      if (
        url.startsWith('http://127.0.0.1:') ||
        url.startsWith('http://localhost:') ||
        url.startsWith('data:') ||
        url.startsWith('blob:')
      ) {
        return route.continue();
      }

      if (url.includes(`/release/${mockAnimeDetail.id}`)) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ code: 0, release: mockAnimeDetail }),
        });
      }

      if (url.includes('/episode/')) {
        const segments = new URL(url).pathname.split('/').filter(Boolean);
        if (segments.length >= 4) {
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ code: 0, episodes: mockEpisodes }),
          });
        }
        if (segments.length === 3) {
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ code: 0, sources: mockSources }),
          });
        }
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ code: 0, types: mockDubs }),
        });
      }

      if (url.includes('/release/comment/all/')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ code: 0, content: [] }),
        });
      }

      return route.abort();
    });

    await seedStorageState(page, { onboarded: true });
    await page.goto(`/anime/${mockAnimeDetail.id}`);

    const watchButton = page.getByRole('button', { name: /Воспроизвести|Play|Watch/i });
    await expect(watchButton).toBeVisible();
    await watchButton.click();

    // Dub modal heading should be visible
    const modalHeading = page.getByRole('heading', { name: /Выбор озвучки|Dub selection/i });
    await expect(modalHeading).toBeVisible();

    // Verify dub option labels
    const dubSelect = page.locator('select').filter({ hasText: /Studio Band/i });
    await expect(dubSelect).toBeVisible();
    await expect(page.getByText(new RegExp(`${mockDubs[0].name}.*${mockDubs[0].episodes_count}.*сер`))).toBeAttached();

    // Verify episode buttons with episode names
    await expect(page.getByRole('heading', { name: mockEpisodes[0].name })).toBeVisible();
    await expect(page.getByRole('heading', { name: mockEpisodes[1].name })).toBeVisible();

    await page.setViewportSize({ width: 390, height: 844 });
    const picker = page.getByRole('dialog').filter({ has: modalHeading });
    await expect.poll(async () => picker.evaluate(element => {
      const rect = element.getBoundingClientRect();
      return rect.left >= 0 && rect.right <= innerWidth && (rect.bottom <= innerHeight || element.scrollHeight > element.clientHeight);
    })).toBe(true);
    await page.screenshot({ path: 'test-results/roadmap-dub-picker-mobile.png', animations: 'disabled' });

    // Close modal via close button
    const closeBtn = picker.getByRole('button', { name: /Закрыть|Close/i });
    await closeBtn.click();
    await expect(modalHeading).not.toBeVisible();
  });

  test('interacts with watchlist selector, favorite toggle, and rating controls', async ({ page }) => {
    let favoriteToggled = false;
    let listStatusUpdated = false;
    let voteSubmitted = false;

    await page.route('**/*', async route => {
      const url = route.request().url();
      if (
        url.startsWith('http://127.0.0.1:') ||
        url.startsWith('http://localhost:') ||
        url.startsWith('data:') ||
        url.startsWith('blob:')
      ) {
        return route.continue();
      }

      if (url.includes('/profile/info')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ code: 0, id: 1 }),
        });
      }

      if (url.includes(`/release/${mockAnimeDetail.id}`)) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ code: 0, release: mockAnimeDetail }),
        });
      }

      if (url.includes('/favorite/delete/') || url.includes('/favorite/add/')) {
        favoriteToggled = true;
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ code: 0 }),
        });
      }

      if (url.includes('/profile/list/add/')) {
        listStatusUpdated = true;
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ code: 0 }),
        });
      }

      if (url.includes('/release/vote/add/')) {
        voteSubmitted = true;
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ code: 0 }),
        });
      }

      if (url.includes('/release/comment/all/')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ code: 0, content: [] }),
        });
      }

      return route.abort();
    });

    await seedStorageState(page, { onboarded: true, isLoggedIn: true });
    await page.goto(`/anime/${mockAnimeDetail.id}`);

    // Watchlist dropdown
    const watchlistSelect = page.locator('#watchlist-select');
    await expect(watchlistSelect).toBeVisible();
    await watchlistSelect.selectOption('2'); // In plans
    expect(listStatusUpdated).toBe(true);

    // Favorite toggle button
    const favoriteButton = page.locator('button').filter({ hasText: String(mockAnimeDetail.favorites_count) });
    await expect(favoriteButton).toBeVisible();
    await favoriteButton.click();
    expect(favoriteToggled).toBe(true);

    // Rating star buttons
    const star4 = page.getByRole('button', { name: /4 из 5|Оценка: 4/i });
    if (await star4.isVisible()) {
      await star4.click();
      expect(voteSubmitted).toBe(true);
    }
  });

  test('displays error state and retries on API failure', async ({ page }) => {
    let failRequests = true;

    await page.route('**/*', async route => {
      const url = route.request().url();
      if (
        url.startsWith('http://127.0.0.1:') ||
        url.startsWith('http://localhost:') ||
        url.startsWith('data:') ||
        url.startsWith('blob:')
      ) {
        return route.continue();
      }

      if (url.includes(`/release/${mockAnimeDetail.id}`)) {
        if (failRequests) {
          return route.fulfill({
            status: 500,
            contentType: 'application/json',
            body: JSON.stringify({ code: 1, message: 'Server error' }),
          });
        }
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ code: 0, release: mockAnimeDetail }),
        });
      }

      if (url.includes('/release/comment/all/')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ code: 0, content: [] }),
        });
      }

      return route.abort();
    });

    await seedStorageState(page, { onboarded: true });
    await page.goto(`/anime/${mockAnimeDetail.id}`);

    // Should display error state
    const retryButton = page.getByRole('button', { name: /Попробовать снова|Retry/i });
    await expect(retryButton).toBeVisible();

    // Enable success and click retry
    failRequests = false;
    await retryButton.click();

    // After retry succeeds, heading should appear
    await expect(page.getByRole('heading', { name: mockAnimeDetail.title_ru })).toBeVisible();
  });

  test('maintains mobile release hierarchy, initial viewport visibility, and no horizontal overflow on 390px and 360px', async ({ page }) => {
    await page.route('**/*', async route => {
      const url = route.request().url();
      if (
        url.startsWith('http://127.0.0.1:') ||
        url.startsWith('http://localhost:') ||
        url.startsWith('data:') ||
        url.startsWith('blob:')
      ) {
        return route.continue();
      }

      if (url.includes(`/release/${mockAnimeDetail.id}`)) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ code: 0, release: mockAnimeDetail }),
        });
      }

      if (url.includes('/release/comment/all/')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ code: 0, content: [] }),
        });
      }

      return route.abort();
    });

    for (const viewport of [{ width: 390, height: 844 }, { width: 360, height: 740 }]) {
      await page.setViewportSize(viewport);
      await seedStorageState(page, { onboarded: true });
      await page.goto(`/anime/${mockAnimeDetail.id}`);

      const titleHeading = page.getByRole('heading', { name: mockAnimeDetail.title_ru });
      await expect(titleHeading).toBeVisible();

      const watchButton = page.getByRole('button', { name: /Воспроизвести|Play|Watch/i });
      await expect(watchButton).toBeVisible();

      // Geometry checks: Title and Watch button are both visible within the initial viewport
      const titleBox = await titleHeading.boundingBox();
      const watchBox = await watchButton.boundingBox();

      expect(titleBox).not.toBeNull();
      expect(watchBox).not.toBeNull();

      // Title is rendered near top of the page above the fold
      expect(titleBox!.y).toBeGreaterThan(0);
      expect(titleBox!.y).toBeLessThan(watchBox!.y);

      // Watch button bottom is within the initial viewport
      expect(watchBox!.y + watchBox!.height).toBeLessThanOrEqual(viewport.height);

      // Usable touch target heights
      expect(watchBox!.height).toBeGreaterThanOrEqual(40);

      // No horizontal overflow
      const hasHorizontalOverflow = await page.evaluate(() => {
        return document.documentElement.scrollWidth > window.innerWidth ||
               document.body.scrollWidth > window.innerWidth;
      });
      expect(hasHorizontalOverflow).toBe(false);

      // Rating breakdown is located below summary/description
      const descElement = await findVisibleByText(page, mockAnimeDetail.description);
      await expect(descElement).toBeVisible();
      const descBox = await descElement.boundingBox();
      const ratingHeader = await findVisibleByText(page, /Оценки|Рейтинг|Rating/i);
      await expect(ratingHeader).toBeVisible();
      const ratingBox = await ratingHeader.boundingBox();

      expect(descBox).not.toBeNull();
      expect(ratingBox).not.toBeNull();
      expect(ratingBox!.y).toBeGreaterThan(descBox!.y);
    }
  });
});
