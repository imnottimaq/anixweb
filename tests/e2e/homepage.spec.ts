import { test, expect } from '@playwright/test';
import { setupDeterministicNetwork } from './helpers/network';
import { seedStorageState } from './helpers/auth';
import { mockAnime1, mockAnime2, createPagedResponse } from './fixtures/mockData';

test.describe('Homepage flow', () => {
  test('renders loading state initially while request is pending', async ({ page }) => {
    let fulfillFilterRequest!: () => void;
    const filterPromise = new Promise<void>(resolve => {
      fulfillFilterRequest = resolve;
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

      if (url.includes('api-s.anixsekai.com') && url.includes('/filter/')) {
        await filterPromise;
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(createPagedResponse([mockAnime1])),
        });
      }

      return route.abort();
    });

    await seedStorageState(page, { onboarded: true });
    await page.goto('/');

    // Verify loading overlay is visible
    const loadingStatus = page.getByRole('status').filter({ hasText: /Загрузка|Loading/i });
    await expect(loadingStatus).toBeVisible();

    // Resolve network request
    fulfillFilterRequest?.();

    // Verify loading indicator is gone and release card is shown
    await expect(loadingStatus).not.toBeVisible();
    await expect(page.getByText(mockAnime1.title_ru)).toBeVisible();
  });

  test('renders releases successfully and allows navigation to release details', async ({ page }) => {
    await setupDeterministicNetwork(page);
    await seedStorageState(page, { onboarded: true });

    await page.goto('/');

    const releaseCard = page.getByRole('link', { name: new RegExp(mockAnime1.title_ru, 'i') });
    await expect(releaseCard).toBeVisible();

    // Click release card to navigate to /anime/101
    await releaseCard.click();
    await expect(page).toHaveURL(/\/anime\/101/);
  });

  test('displays error message on failed request and recovers when clicking retry', async ({ page }) => {
    let attemptCount = 0;

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

      if (url.includes('api-s.anixsekai.com') && url.includes('/filter/')) {
        attemptCount += 1;
        if (attemptCount === 1) {
          // Fail first request
          return route.fulfill({
            status: 500,
            contentType: 'application/json',
            body: JSON.stringify({ code: 1, message: 'Internal server error' }),
          });
        }
        // Succeed on retry
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(createPagedResponse([mockAnime2])),
        });
      }

      return route.abort();
    });

    await seedStorageState(page, { onboarded: true });
    await page.goto('/');

    // Error alert and retry button should be visible
    const errorAlert = page.getByRole('alert');
    await expect(errorAlert).toBeVisible();

    const retryButton = page.getByRole('button', { name: /Попробовать снова|Retry/i });
    await expect(retryButton).toBeVisible();

    // Click retry
    await retryButton.click();

    // Error alert should disappear and recovered content should appear
    await expect(errorAlert).not.toBeVisible();
    await expect(page.getByText(mockAnime2.title_ru)).toBeVisible();
  });

  test('allows switching between catalog tabs and updates requested filter', async ({ page }) => {
    let lastFilterPayload: unknown = null;

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

      if (url.includes('api-s.anixsekai.com') && url.includes('/filter/')) {
        try {
          lastFilterPayload = JSON.parse(route.request().postData() || '{}');
        } catch {
          lastFilterPayload = null;
        }

        const statusId = (lastFilterPayload as { status_id?: number })?.status_id;
        const resultAnime = statusId === 2 ? [mockAnime2] : [mockAnime1];

        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(createPagedResponse(resultAnime)),
        });
      }

      return route.abort();
    });

    await seedStorageState(page, { onboarded: true });
    await page.goto('/');

    // Initial tab is Latest (selected)
    const latestTab = page.getByRole('tab', { name: /Последнее|Latest/i });
    await expect(latestTab).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByText(mockAnime1.title_ru)).toBeVisible();

    // Click Ongoing tab
    const ongoingTab = page.getByRole('tab', { name: /Онгоинг|Ongoing/i });
    await ongoingTab.click();

    await expect(ongoingTab).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByText(mockAnime2.title_ru)).toBeVisible();
  });
});
