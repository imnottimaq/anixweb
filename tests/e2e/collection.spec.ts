import { test, expect } from '@playwright/test';
import { seedStorageState } from './helpers/auth';
import {
  mockCollection1,
  mockCollection2,
  mockAnime1,
  mockAnime3,
  createPagedResponse,
} from './fixtures/mockData';

test.describe('Collection screen flow', () => {
  test('renders collection details, creator, and release items', async ({ page }) => {
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

      if (url.includes(`/collection/${mockCollection1.id}/releases/`)) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(createPagedResponse([mockAnime1])),
        });
      }

      if (url.includes(`/collection/${mockCollection1.id}`)) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ code: 0, collection: mockCollection1 }),
        });
      }

      return route.abort();
    });

    await seedStorageState(page, { onboarded: true });
    await page.goto(`/collection/${mockCollection1.id}`);

    // Verify title, description and creator are visible
    await expect(page.getByRole('heading', { name: mockCollection1.title })).toBeVisible();
    await expect(page.getByText(mockCollection1.description)).toBeVisible();
    await expect(page.getByRole('link', { name: new RegExp(mockCollection1.creator.login, 'i') })).toBeVisible();

    // Verify releases in collection
    await expect(page.getByText(mockAnime1.title_ru)).toBeVisible();
  });

  test('toggles collection saved state and updates action button', async ({ page }) => {
    let saveEndpointCalled = false;

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

      if (url.includes(`/collection/${mockCollection1.id}/releases/`)) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(createPagedResponse([])),
        });
      }

      if (url.includes(`/collection/${mockCollection1.id}`)) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            code: 0,
            collection: { ...mockCollection1, is_favorite: false },
          }),
        });
      }

      if (url.includes('/collectionFavorite/add/')) {
        saveEndpointCalled = true;
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ code: 0 }),
        });
      }

      return route.abort();
    });

    await seedStorageState(page, { onboarded: true, isLoggedIn: true });
    await page.goto(`/collection/${mockCollection1.id}`);

    // Initial state: not saved -> button says "Сохранить" / "Save"
    const saveButton = page.getByRole('button', { name: /Сохранить|Save/i });
    await expect(saveButton).toBeVisible();

    // Click to save
    await saveButton.click();

    // Button updates to "Сохранено" / "Saved"
    const savedButton = page.getByRole('button', { name: /Сохранено|Saved/i });
    await expect(savedButton).toBeVisible();
    expect(saveEndpointCalled).toBe(true);
  });

  test('handles collection loading error and recovers on retry', async ({ page }) => {
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

      if (url.includes(`/collection/${mockCollection1.id}/releases/`)) {
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

      if (url.includes(`/collection/${mockCollection1.id}`)) {
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
          body: JSON.stringify({ code: 0, collection: mockCollection1 }),
        });
      }

      return route.abort();
    });

    await seedStorageState(page, { onboarded: true });
    await page.goto(`/collection/${mockCollection1.id}`);

    const retryButton = page.getByRole('button', { name: /Попробовать снова|Retry/i });
    await expect(retryButton).toBeVisible();

    failRequests = false;
    await retryButton.click();

    await expect(page.getByRole('heading', { name: mockCollection1.title })).toBeVisible();
    await expect(page.getByText(mockAnime1.title_ru)).toBeVisible();
  });

  test('navigates from Collection A to Collection B isolating data and refreshing on route param change', async ({ page }) => {
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

      // Collection 1
      if (url.includes(`/collection/${mockCollection1.id}/releases/`)) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(createPagedResponse([mockAnime1])),
        });
      }
      if (url.includes(`/collection/${mockCollection1.id}`)) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ code: 0, collection: mockCollection1 }),
        });
      }

      // Collection 2
      if (url.includes(`/collection/${mockCollection2.id}/releases/`)) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(createPagedResponse([mockAnime3])),
        });
      }
      if (url.includes(`/collection/${mockCollection2.id}`)) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ code: 0, collection: mockCollection2 }),
        });
      }

      return route.abort();
    });

    await seedStorageState(page, { onboarded: true });

    // Visit Collection A
    await page.goto(`/collection/${mockCollection1.id}`);
    await expect(page.getByRole('heading', { name: mockCollection1.title })).toBeVisible();
    await expect(page.getByText(mockAnime1.title_ru)).toBeVisible();

    // Navigate to Collection B via client-side routing
    await page.evaluate(targetId => {
      window.history.pushState({}, '', `/collection/${targetId}`);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }, mockCollection2.id);

    // Verify Collection B is loaded cleanly and Collection A content is replaced
    await expect(page.getByRole('heading', { name: mockCollection2.title })).toBeVisible();
    await expect(page.getByText(mockAnime3.title_ru, { exact: true })).toBeVisible();
    await expect(page.getByText(mockCollection1.description)).not.toBeVisible();
  });
});
