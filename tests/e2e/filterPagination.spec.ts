import { test, expect, type Page } from '@playwright/test';
import { setupDeterministicNetwork } from './helpers/network';
import { seedStorageState } from './helpers/auth';
import { mockAnime1, mockAnime2, mockAnime3 } from './fixtures/mockData';

async function prepareFilters(page: Page) {
  await setupDeterministicNetwork(page);
  await seedStorageState(page, { settings: { appearance: { language: 'english' } } });
}

async function applyGenres(page: Page, text = 'action, fantasy, action, ') {
  await page.goto('/filter');
  const dialog = page.getByRole('dialog', { name: 'Filters', exact: true });
  const genres = dialog.getByRole('textbox', { name: /^Genres/ });
  await genres.pressSequentially(text, { delay: 10 });
  await expect(genres).toHaveValue(text);
  await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(dialog).toHaveCount(0);
}

test('genre typing preserves separators and Apply trims and deduplicates the API values', async ({ page }) => {
  await prepareFilters(page);
  const requests: Record<string, unknown>[] = [];
  await page.route('**/filter/*', route => {
    requests.push(route.request().postDataJSON());
    return route.fulfill({ json: { code: 0, content: [mockAnime1], total_count: 1, total_page_count: 1, current_page: 0 } });
  });
  await applyGenres(page);
  await expect(page.getByRole('link', { name: new RegExp(mockAnime1.title_original) })).toBeVisible();
  expect(requests).toHaveLength(1);
  expect(requests[0].genres).toEqual(['action', 'fantasy']);
  await expect(page.getByRole('button', { name: 'Remove Genres: action', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Remove Genres: fantasy', exact: true })).toBeVisible();
});

test('filter pagination deduplicates releases, retries the failed page, and stops at metadata exhaustion', async ({ page }) => {
  await prepareFilters(page);
  const pages: number[] = [];
  let failLastPage = true;
  await page.route('**/filter/*', route => {
    const index = Number(new URL(route.request().url()).pathname.split('/').at(-1));
    pages.push(index);
    if (index === 2 && failLastPage) return route.fulfill({ status: 503, body: 'Unavailable' });
    const content = index === 0 ? [mockAnime1] : index === 1 ? [mockAnime1, mockAnime2] : [mockAnime3];
    return route.fulfill({ json: { code: 0, content, current_page: index, total_page_count: 3, total_count: 3 } });
  });
  await applyGenres(page, 'action');
  const results = page.getByRole('region', { name: 'Filter search', exact: true });
  const first = results.locator(`a[href="/anime/${mockAnime1.id}"]`);
  await expect(first).toHaveCount(1);
  await results.getByRole('button', { name: 'Load more', exact: true }).click();
  await expect(results.locator(`a[href="/anime/${mockAnime2.id}"]`)).toHaveCount(1);
  await expect(first).toHaveCount(1);
  await results.getByRole('button', { name: 'Load more', exact: true }).click();
  await expect(results.getByRole('alert')).toContainText('Unable to load releases.');
  await expect(first).toBeVisible();
  await expect(results.locator(`a[href="/anime/${mockAnime2.id}"]`)).toBeVisible();
  failLastPage = false;
  await results.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(results.locator(`a[href="/anime/${mockAnime3.id}"]`)).toHaveCount(1);
  await expect(results.getByRole('button', { name: 'Load more', exact: true })).toHaveCount(0);
  await expect(results.getByRole('alert')).toHaveCount(0);
  expect(pages).toEqual([0, 1, 2, 2]);
});

test('removing a filter restarts page zero and ignores a late page from the previous filter', async ({ page }) => {
  await prepareFilters(page);
  const requests: { index: number; genres: string[] }[] = [];
  let releaseOldPage!: () => void;
  let oldPageStarted!: () => void;
  let oldPageFinished!: () => void;
  const pending = new Promise<void>(resolve => { releaseOldPage = resolve; });
  const started = new Promise<void>(resolve => { oldPageStarted = resolve; });
  const finished = new Promise<void>(resolve => { oldPageFinished = resolve; });
  await page.route('**/filter/*', async route => {
    const index = Number(new URL(route.request().url()).pathname.split('/').at(-1));
    const genres = route.request().postDataJSON().genres as string[];
    requests.push({ index, genres });
    if (index === 1) {
      oldPageStarted();
      await pending;
      try {
        await route.fulfill({ json: { code: 0, content: [mockAnime3], current_page: 1, total_page_count: 2 } });
      } finally { oldPageFinished(); }
      return;
    }
    await route.fulfill({ json: {
      code: 0, content: genres.length ? [mockAnime1] : [mockAnime2], current_page: 0,
      total_page_count: genres.length ? 2 : 1,
    } });
  });
  await applyGenres(page, 'action');
  const results = page.getByRole('region', { name: 'Filter search', exact: true });
  await results.getByRole('button', { name: 'Load more', exact: true }).click();
  await started;
  await page.getByRole('button', { name: 'Remove Genres: action', exact: true }).click();
  await expect(results.locator(`a[href="/anime/${mockAnime2.id}"]`)).toBeVisible();
  releaseOldPage();
  await finished;
  await expect(results.locator(`a[href="/anime/${mockAnime3.id}"]`)).toHaveCount(0);
  await expect(results.locator(`a[href="/anime/${mockAnime1.id}"]`)).toHaveCount(0);
  await expect(results.getByRole('button', { name: 'Load more', exact: true })).toHaveCount(0);
  expect(requests).toEqual([{ index: 0, genres: ['action'] }, { index: 1, genres: ['action'] }, { index: 0, genres: [] }]);
});
