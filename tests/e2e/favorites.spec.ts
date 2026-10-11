import { test, expect } from '@playwright/test';
import { setupDeterministicNetwork } from './helpers/network';
import { seedStorageState } from './helpers/auth';
import {
  mockAnime1,
  mockAnime2,
  mockAnime3,
  createPagedResponse,
} from './fixtures/mockData';

test.describe('Favorites and list tabs flow', () => {
  test('displays signed-out dialog when visiting favorites without auth token', async ({ page }) => {
    await setupDeterministicNetwork(page);
    await seedStorageState(page, { onboarded: true, isLoggedIn: false });

    await page.goto('/favorites');

    const authDialog = page.getByRole('dialog', { name: /Вход/i });
    await expect(authDialog).toBeVisible();

    const loginButton = authDialog.getByRole('button', { name: /Вход/i });
    await expect(loginButton).toBeVisible();
    await loginButton.click();

    await expect(page).toHaveURL(/\/account\/login/);
  });

  test('switches between profile list tabs (Watching, Planned, Completed)', async ({ page }) => {
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

      if (url.includes('/favorite/all/')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(createPagedResponse([mockAnime1])),
        });
      }

      // Watching list (id 1)
      if (url.includes('/profile/list/all/1/')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(createPagedResponse([mockAnime1])),
        });
      }

      // Planned list (id 2)
      if (url.includes('/profile/list/all/2/')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(createPagedResponse([mockAnime2])),
        });
      }

      // Completed list (id 3)
      if (url.includes('/profile/list/all/3/')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(createPagedResponse([mockAnime3])),
        });
      }

      return route.abort();
    });

    await seedStorageState(page, { onboarded: true, isLoggedIn: true });
    await page.goto('/favorites');

    // Default tab is Favorites
    await expect(page.getByText(mockAnime1.title_ru)).toBeVisible();

    // Click "Смотрю" (Watching)
    const watchingTab = page.getByRole('tab', { name: /Смотрю|Watching/i });
    await watchingTab.click();
    await expect(watchingTab).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByText(mockAnime1.title_ru)).toBeVisible();

    // Click "В планах" (Planned)
    const plannedTab = page.getByRole('tab', { name: /В планах|Planned/i });
    await plannedTab.click();
    await expect(plannedTab).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByText(mockAnime2.title_ru, { exact: true })).toBeVisible();

    // Click "Просмотрено" (Completed)
    const completedTab = page.getByRole('tab', { name: /Просмотрено|Watched|Completed/i });
    await completedTab.click();
    await expect(completedTab).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByText(mockAnime3.title_ru, { exact: true })).toBeVisible();
  });

  test('changes sort order using the sort select control', async ({ page }) => {
    let requestedSortParam = '';

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

      if (url.includes('/favorite/all/')) {
        const searchParams = new URL(url).searchParams;
        requestedSortParam = searchParams.get('sort') || '';
        const anime = requestedSortParam === '5' ? [mockAnime3] : [mockAnime1];

        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(createPagedResponse(anime)),
        });
      }

      return route.abort();
    });

    await seedStorageState(page, { onboarded: true, isLoggedIn: true });
    await page.goto('/favorites');

    await expect(page.getByText(mockAnime1.title_ru)).toBeVisible();
    expect(requestedSortParam).toBe('1'); // addedDesc

    // Change sort to titleAsc (От A до Z, sort value 5)
    const sortTrigger = page.getByRole('button', { name: /По дате добавления/i });
    await expect(sortTrigger).toBeVisible();
    await sortTrigger.click();

    const optionAtoZ = page.getByRole('option', { name: /От A до Z/i });
    await expect(optionAtoZ).toBeVisible();
    await optionAtoZ.click();

    await expect(page.getByText(mockAnime3.title_ru, { exact: true })).toBeVisible();
    expect(requestedSortParam).toBe('5');
  });

  test('renders empty state when tab has no releases', async ({ page }) => {
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

      if (url.includes('/favorite/all/')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(createPagedResponse([])),
        });
      }

      return route.abort();
    });

    await seedStorageState(page, { onboarded: true, isLoggedIn: true });
    await page.goto('/favorites');

    await expect(page.getByText(/Здесь пока ничего нет|Nothing here yet/i)).toBeVisible();
  });

  test('displays error alert on failure and recovers on retry', async ({ page }) => {
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

      if (url.includes('/favorite/all/')) {
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
          body: JSON.stringify(createPagedResponse([mockAnime1])),
        });
      }

      return route.abort();
    });

    await seedStorageState(page, { onboarded: true, isLoggedIn: true });
    await page.goto('/favorites');

    const errorAlert = page.getByRole('alert');
    await expect(errorAlert).toBeVisible();

    const retryButton = page.getByRole('button', { name: /Попробовать снова|Retry/i });
    await expect(retryButton).toBeVisible();

    failRequests = false;
    await retryButton.click();

    await expect(errorAlert).not.toBeVisible();
    await expect(page.getByText(mockAnime1.title_ru)).toBeVisible();
  });
});
