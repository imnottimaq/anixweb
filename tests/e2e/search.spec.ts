import { test, expect } from '@playwright/test';
import { setupDeterministicNetwork } from './helpers/network';
import { seedStorageState } from './helpers/auth';
import {
  mockAnime1,
  mockAnime3,
  mockFriendProfile,
  mockCollection1,
  mockProfile,
} from './fixtures/mockData';

test.describe('Header search bar flow', () => {
  test('announces debounced loading, result counts, and empty results', async ({ page }) => {
    await setupDeterministicNetwork(page);
    let finishSearch!: () => void;
    const pendingSearch = new Promise<void>(resolve => { finishSearch = resolve; });
    await page.route('**/search/releases/*', async route => {
      const query = route.request().postDataJSON().query as string;
      if (query === 'Titan') await pendingSearch;
      await route.fulfill({ json: { code: 0, releases: query === 'Titan' ? [mockAnime1] : [] } });
    });
    await seedStorageState(page, { settings: { appearance: { language: 'english' } } });
    await page.goto('/settings');
    await page.getByRole('button', { name: 'Search anime' }).click();
    const input = page.getByRole('textbox', { name: 'Search anime' });
    const status = page.locator('span[role="status"]');
    await input.fill('Titan');
    await expect(status).toHaveText('Searching...');
    finishSearch();
    await expect(status).toHaveText('Results: 1');
    await input.fill('Missing');
    await expect(status).toHaveText('Nothing found');
  });

  test('shows the search label on desktop and a compact trigger on narrower screens', async ({ page }) => {
    await setupDeterministicNetwork(page);
    await seedStorageState(page, { settings: { appearance: { language: 'english' } } });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/settings');
    const trigger = page.getByRole('button', { name: 'Search anime' });
    await expect(trigger.getByText('Search anime')).toBeVisible();
    await page.setViewportSize({ width: 1024, height: 768 });
    await expect(trigger).toBeVisible();
    await expect(trigger.getByText('Search anime')).not.toBeVisible();
  });

  test('hides earlier results after a failed new query and retries the current query', async ({ page }) => {
    await setupDeterministicNetwork(page);
    const queries: string[] = [];
    let fail = true;
    await page.route('**/search/releases/*', async route => {
      const query = route.request().postDataJSON().query as string;
      queries.push(query);
      if (query === 'Second' && fail) return route.fulfill({ status: 503, body: '{}' });
      return route.fulfill({ json: { code: 0, releases: [query === 'First' ? mockAnime1 : mockAnime3] } });
    });
    await seedStorageState(page, { settings: { appearance: { language: 'english' } } });
    await page.goto('/settings');
    await page.getByRole('button', { name: 'Search anime' }).click();
    const input = page.getByRole('textbox', { name: 'Search anime' });
    await input.fill('First');
    await expect(page.getByText(mockAnime1.title_original, { exact: true })).toBeVisible();
    await input.fill('Second');
    await expect(page.getByText(mockAnime1.title_original, { exact: true })).not.toBeVisible();
    await expect(page.getByRole('alert')).toContainText('Search failed');
    await expect(page.getByText(mockAnime1.title_original, { exact: true })).not.toBeVisible();
    fail = false;
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByText(mockAnime3.title_original, { exact: true })).toBeVisible();
    expect(queries).toEqual(['First', 'Second', 'Second']);
    await expect(page.getByRole('alert')).not.toBeVisible();
  });

  test('debounces search requests and does not query before delay', async ({ page }) => {
    let searchRequestCount = 0;

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

      if (url.includes('/search/releases/')) {
        searchRequestCount += 1;
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ code: 0, releases: [mockAnime1] }),
        });
      }

      if (url.includes('/filter/')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ code: 0, content: [] }),
        });
      }

      return route.abort();
    });

    await seedStorageState(page, { onboarded: true });
    await page.goto('/');

    const searchTrigger = page.getByRole('button', { name: /Поиск аниме|Search anime/i });
    await searchTrigger.click();

    const searchInput = page.getByRole('textbox', { name: /Поиск аниме|Search anime/i });
    await expect(searchInput).toBeVisible();

    // Type rapidly
    await searchInput.pressSequentially('Attack', { delay: 30 });

    // Immediately after typing, no request should have fired yet
    expect(searchRequestCount).toBe(0);

    // Wait for debounce (500ms)
    await expect(page.getByText(mockAnime1.title_ru)).toBeVisible();
    expect(searchRequestCount).toBe(1);
  });

  test('clears results and closes overlay when query is emptied', async ({ page }) => {
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

      if (url.includes('/search/releases/')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ code: 0, releases: [mockAnime1] }),
        });
      }

      if (url.includes('/filter/')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ code: 0, content: [] }),
        });
      }

      return route.abort();
    });

    await seedStorageState(page, { onboarded: true });
    await page.goto('/');

    const searchTrigger = page.getByRole('button', { name: /Поиск аниме|Search anime/i });
    await searchTrigger.click();

    const searchInput = page.getByRole('textbox', { name: /Поиск аниме|Search anime/i });
    await searchInput.fill('Titan');

    await expect(page.getByText(mockAnime1.title_ru)).toBeVisible();

    // Clear input
    await searchInput.fill('');

    // Overlay and results should be gone
    await expect(page.getByText(mockAnime1.title_ru)).not.toBeVisible();
  });

  test('protects against race condition so late earlier response does not overwrite latest query', async ({ page }) => {
    let resolveFirstQuery!: () => void;
    const firstQueryPromise = new Promise<void>(resolve => {
      resolveFirstQuery = resolve;
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

      if (url.includes('/search/releases/')) {
        const postData = JSON.parse(route.request().postData() || '{}');
        const query = postData.query as string;

        if (query === 'QueryOne') {
          // Intentionally delay the first query
          await firstQueryPromise;
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ code: 0, releases: [mockAnime1] }),
          });
        }

        if (query === 'QueryTwo') {
          // Second query resolves immediately
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ code: 0, releases: [mockAnime3] }),
          });
        }
      }

      if (url.includes('/filter/')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ code: 0, content: [] }),
        });
      }

      return route.abort();
    });

    await seedStorageState(page, { onboarded: true });
    await page.goto('/');

    const searchTrigger = page.getByRole('button', { name: /Поиск аниме|Search anime/i });
    await searchTrigger.click();

    const searchInput = page.getByRole('textbox', { name: /Поиск аниме|Search anime/i });

    // Send query 1
    await searchInput.fill('QueryOne');
    // Wait slightly past debounce so query 1 request is sent and held
    await page.waitForTimeout(550);

    // Send query 2 before resolving query 1
    await searchInput.fill('QueryTwo');

    // Wait for query 2 results to display
    await expect(page.getByText(mockAnime3.title_ru)).toBeVisible();

    // Now resolve query 1 late
    resolveFirstQuery?.();

    // Small delay to ensure any potential rogue state update would have executed
    await page.waitForTimeout(200);

    // Query 2 results MUST stay, Query 1 results must NOT overwrite them
    await expect(page.getByText(mockAnime3.title_ru)).toBeVisible();
    await expect(page.getByText(mockAnime1.title_ru)).not.toBeVisible();
  });

  test('clears and collapses search bar on Escape key', async ({ page }) => {
    await setupDeterministicNetwork(page);
    await seedStorageState(page, { onboarded: true });
    await page.goto('/');

    const searchTrigger = page.getByRole('button', { name: /Поиск аниме|Search anime/i });
    await searchTrigger.click();

    const searchInput = page.getByRole('textbox', { name: /Поиск аниме|Search anime/i });
    await searchInput.fill('TestingEscape');

    // Press Escape
    await searchInput.press('Escape');

    // Search input should collapse and trigger should be restored
    await expect(searchInput).not.toBeVisible();
    await expect(searchTrigger).toBeVisible();
    await expect(searchTrigger).toBeFocused();
  });

  test('clear button clears the input query', async ({ page }) => {
    await setupDeterministicNetwork(page);
    await seedStorageState(page, { onboarded: true });
    await page.goto('/');

    const searchTrigger = page.getByRole('button', { name: /Поиск аниме|Search anime/i });
    await searchTrigger.click();

    const searchInput = page.getByRole('textbox', { name: /Поиск аниме|Search anime/i });
    await searchInput.fill('SomeQuery');

    const clearButton = page.getByRole('button', { name: /Очистить|Clear/i });
    await expect(clearButton).toBeVisible();
    await clearButton.click();

    await expect(searchInput).toHaveValue('');
  });

  test('navigates to release detail when clicking anime search result', async ({ page }) => {
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

      if (url.includes('/search/releases/')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ code: 0, releases: [mockAnime1] }),
        });
      }

      if (url.includes(`/release/${mockAnime1.id}`)) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ code: 0, release: mockAnime1 }),
        });
      }

      if (url.includes('/filter/')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ code: 0, content: [] }),
        });
      }

      return route.abort();
    });

    await seedStorageState(page, { onboarded: true });
    await page.goto('/');

    const searchTrigger = page.getByRole('button', { name: /Поиск аниме|Search anime/i });
    await searchTrigger.click();

    const searchInput = page.getByRole('textbox', { name: /Поиск аниме|Search anime/i });
    await searchInput.fill('Titan');

    const resultLink = page.getByRole('link', { name: new RegExp(mockAnime1.title_ru, 'i') });
    await expect(resultLink).toBeVisible();
    await resultLink.click();

    await expect(page).toHaveURL(new RegExp(`/anime/${mockAnime1.id}`));
    await expect(searchTrigger).not.toBeFocused();
  });

  test('navigates to user profile when searching in profile scope', async ({ page }) => {
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

      if (url.includes(`/profile/${mockProfile.id}`)) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ code: 0, profile: mockProfile, is_my_profile: true }),
        });
      }

      if (url.includes(`/profile/${mockFriendProfile.id}`)) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ code: 0, profile: mockFriendProfile }),
        });
      }

      if (url.includes('/search/profiles/')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            code: 0,
            profiles: [mockFriendProfile],
            total_count: 1,
            total_page_count: 1,
            current_page: 0,
          }),
        });
      }

      return route.abort();
    });

    await seedStorageState(page, { onboarded: true, isLoggedIn: true });
    // Navigate to /account which activates profile search scope
    await page.goto('/account');

    const searchTrigger = page.getByRole('button', { name: /Поиск пользователей|Search users/i });
    await expect(searchTrigger).toBeVisible();
    await searchTrigger.click();

    const searchInput = page.getByRole('textbox', { name: /Поиск пользователей|Search users/i });
    await searchInput.fill('AnimeFriend');

    const profileButton = page.getByRole('button', { name: new RegExp(mockFriendProfile.login, 'i') });
    await expect(profileButton).toBeVisible();
    await profileButton.click();

    await expect(page).toHaveURL(new RegExp(`/account/${mockFriendProfile.id}`));
  });

  test('navigates to collection when searching in collection scope', async ({ page }) => {
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

      if (url.includes('/collection/all/')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ code: 0, content: [mockCollection1] }),
        });
      }

      if (url.includes(`/collection/${mockCollection1.id}/releases/0`)) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ code: 0, content: [] }),
        });
      }

      if (url.includes(`/collection/${mockCollection1.id}`)) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ code: 0, collection: mockCollection1 }),
        });
      }

      if (url.includes('/search/collections/')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            code: 0,
            collections: [mockCollection1],
            total_count: 1,
            total_page_count: 1,
            current_page: 0,
          }),
        });
      }

      return route.abort();
    });

    await seedStorageState(page, { onboarded: true });
    // Navigate to /collections which activates collection search scope
    await page.goto('/collections');

    const searchTrigger = page.getByRole('button', { name: /^Коллекции$|^Collections$/i });
    await expect(searchTrigger).toBeVisible();
    await searchTrigger.click();

    const searchInput = page.getByRole('textbox', { name: /^Коллекции$|^Collections$/i });
    await searchInput.fill('Fantasy');

    const collectionButton = page.getByRole('button', { name: new RegExp(mockCollection1.title, 'i') });
    await expect(collectionButton).toBeVisible();
    await collectionButton.click();

    await expect(page).toHaveURL(new RegExp(`/collection/${mockCollection1.id}`));
  });
});
