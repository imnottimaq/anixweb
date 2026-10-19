import { test, expect } from '@playwright/test';
import { setupDeterministicNetwork } from './helpers/network';
import { seedStorageState } from './helpers/auth';
import {
  mockProfile,
  mockFriendProfile,
  mockNotifications,
  createPagedResponse,
} from './fixtures/mockData';

test.describe('Friends page flow', () => {
  test('displays signed-out guard when user is not authenticated', async ({ page }) => {
    await setupDeterministicNetwork(page);
    await seedStorageState(page, { onboarded: true, isLoggedIn: false });

    await page.goto('/friends');

    await expect(page.getByText(/Войдите в аккаунт, чтобы увидеть друзей/i)).toBeVisible();

    const loginButton = page.getByRole('button', { name: /Вход|Login|Sign in/i });
    await expect(loginButton).toBeVisible();
    await loginButton.click();

    await expect(page).toHaveURL(/\/account\/login/);
  });

  test('displays empty state when user has no friends in tab', async ({ page }) => {
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
          body: JSON.stringify({ code: 0, id: mockProfile.id, profile: mockProfile }),
        });
      }

      if (url.includes('/profile/friend/')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(createPagedResponse([])),
        });
      }

      return route.abort();
    });

    await seedStorageState(page, { onboarded: true, isLoggedIn: true });
    await page.goto('/friends');

    await expect(page.getByText(/У вас пока нет друзей/i)).toBeVisible();
  });

  test('displays error state on failure and recovers when clicking retry', async ({ page }) => {
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

      if (url.includes('/profile/info')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ code: 0, id: mockProfile.id, profile: mockProfile }),
        });
      }

      if (url.includes('/profile/friend/')) {
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
          body: JSON.stringify(createPagedResponse([mockFriendProfile])),
        });
      }

      return route.abort();
    });

    await seedStorageState(page, { onboarded: true, isLoggedIn: true });
    await page.goto('/friends');

    const retryButton = page.getByRole('button', { name: /Попробовать снова|Retry/i });
    await expect(retryButton).toBeVisible();

    failRequests = false;
    await retryButton.click();

    await expect(page.getByText(mockFriendProfile.login)).toBeVisible();
  });
});

test.describe('Notifications page flow', () => {
  test('shows a sign-in gate without reading or fetching private notifications for guests', async ({ page }) => {
    await setupDeterministicNetwork(page);
    await seedStorageState(page, { onboarded: true, isLoggedIn: false });
    const privateRequests: string[] = [];
    page.on('request', request => {
      if (/\/notification\/(?:read|all)(?:\/|\?|$)/.test(request.url())) privateRequests.push(request.url());
    });

    await page.goto('/notifications');
    await expect(page.getByRole('status').filter({ hasText: 'Anixart' })).toBeVisible();
    expect(privateRequests).toEqual([]);
    await expect(page.getByRole('combobox')).toHaveCount(0);
    const loginLink = page.getByRole('link', { name: /^(Вход|Sign in)$/i });
    await expect(loginLink).toHaveAttribute('href', '/account/login');
    await loginLink.click();
    await expect(page).toHaveURL(/\/account\/login/);
  });

  test('displays empty state when there are no notifications', async ({ page }) => {
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
          body: JSON.stringify({ code: 0, id: mockProfile.id, profile: { ...mockProfile, is_my_profile: true } }),
        });
      }

      if (url.includes('/notification/read')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ code: 0 }),
        });
      }

      if (url.includes('/notification/all/')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ code: 0, content: [] }),
        });
      }

      return route.abort();
    });

    await seedStorageState(page, { onboarded: true, isLoggedIn: true });
    await page.goto('/notifications');

    await expect(page.getByText(/нет уведомлений|no notifications/i)).toBeVisible();
  });

  test('displays error state on failure and recovers on retry', async ({ page }) => {
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

      if (url.includes('/profile/info')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ code: 0, id: mockProfile.id, profile: { ...mockProfile, is_my_profile: true } }),
        });
      }

      if (url.includes('/notification/read')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ code: 0 }),
        });
      }

      if (url.includes('/notification/all/')) {
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
          body: JSON.stringify({ code: 0, content: mockNotifications }),
        });
      }

      return route.abort();
    });

    await seedStorageState(page, { onboarded: true, isLoggedIn: true });
    await page.goto('/notifications');

    const retryButton = page.getByRole('button', { name: /Попробовать снова|Retry/i });
    await expect(retryButton).toBeVisible();

    failRequests = false;
    await retryButton.click();

    await expect(page.getByText(/28 серия/i)).toBeVisible();
  });

  test('renders notifications list and filters by category', async ({ page }) => {
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
          body: JSON.stringify({ code: 0, id: mockProfile.id, profile: { ...mockProfile, is_my_profile: true } }),
        });
      }

      if (url.includes('/notification/read')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ code: 0 }),
        });
      }

      if (url.includes('/notification/all/')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ code: 0, content: mockNotifications }),
        });
      }

      return route.abort();
    });

    await seedStorageState(page, { onboarded: true, isLoggedIn: true });
    await page.goto('/notifications');

    // Both episode notification and friend request notification should be visible under All
    await expect(page.getByText(/28 серия/i)).toBeVisible();
    await expect(page.getByText(/хочет добавить вас в друзья/i)).toBeVisible();

    // Filter by episode notifications
    const filterSelect = page.locator('select');
    await expect(filterSelect).toBeVisible();
    await filterSelect.selectOption('episode');

    // Episode notification visible, friend request hidden
    await expect(page.getByText(/28 серия/i)).toBeVisible();
    await expect(page.getByText(/хочет добавить вас в друзья/i)).not.toBeVisible();
  });
});
