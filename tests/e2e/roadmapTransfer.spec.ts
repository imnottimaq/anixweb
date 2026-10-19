import { test, expect } from '@playwright/test';
import { setupDeterministicNetwork } from './helpers/network';
import { seedStorageState } from './helpers/auth';
import { mockAnime1 } from './fixtures/mockData';
import { defaultAppSettings } from '../../src/shared/types/settings';

test('native Shikimori JSON with a null note automatically matches the exact anime and imports after confirmation', async ({ page }) => {
  await setupDeterministicNetwork(page, { isLoggedIn: true });
  await seedStorageState(page, { isLoggedIn: true, onboarded: true, settings: {
    ...defaultAppSettings, appearance: { ...defaultAppSettings.appearance, language: 'english' },
  } });
  const anime = { ...mockAnime1, id: 42001, title_ru: 'Great Teacher Onizuka', title_original: 'Great Teacher Onizuka', profile_list_status: 0, your_vote: 0 };
  await page.route('**/search/releases/0**', route => route.fulfill({ json: { code: 0, releases: [anime] } }));
  let saved = false;
  await page.route('**/profile/list/add/1/42001**', route => {
    saved = true;
    return route.fulfill({ json: { code: 0 } });
  });
  await page.goto('/settings');
  await page.getByRole('tab', { name: /^Data(?: & Cloud)?$/ }).click();
  const transfer = page.getByRole('region', { name: 'List Transfer (Shikimori / MAL)' });
  await transfer.getByRole('tab', { name: 'Import lists', exact: true }).click();
  await transfer.locator('input[type="file"]').setInputFiles({
    name: 'shikimori_animes.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify([{ target_title: 'Great Teacher Onizuka', target_title_ru: 'Крутой учитель Онидзука', target_id: 245, target_type: 'Anime', score: 0, status: 'watching', rewatches: 0, episodes: 0, text: null }])),
  });
  await expect(transfer.getByText('Matched by title', { exact: true })).toBeVisible();
  await expect(transfer.getByRole('button', { name: 'Change match', exact: true })).toBeVisible();
  expect(saved).toBe(false);
  await transfer.getByRole('button', { name: 'Confirm and import (1)', exact: true }).click();
  await expect(transfer.getByText('All selected entries were imported successfully!', { exact: true })).toBeVisible();
  expect(saved).toBe(true);
});

test('list export resolves a genuine Shikimori candidate and saves its ID rather than the Anixart ID', async ({ page }) => {
  await setupDeterministicNetwork(page, { isLoggedIn: true });
  await seedStorageState(page, { isLoggedIn: true, onboarded: true, settings: {
    ...defaultAppSettings, appearance: { ...defaultAppSettings.appearance, language: 'english' },
  } });
  const anime = { ...mockAnime1, id: 42001, title_ru: 'Cowboy Bebop', title_original: 'Cowboy Bebop', profile_list_status: 1, your_vote: 4 };
  let exportRequests = 0;
  await page.route('**/export/bookmarks**', async route => {
    exportRequests++;
    expect(route.request().method()).toBe('POST');
    expect(new URL(route.request().url()).searchParams.get('token')).toBe('test-auth-token-123');
    expect(route.request().postDataJSON()).toEqual({ bookmarksExportProfileLists: [1, 2, 3, 4, 5] });
    return route.fulfill({ json: { releases: [{ ...anime, is_favorite: false }] } });
  });
  let catalogRequests = 0;
  await page.route('https://shikimori.one/api/animes**', route => {
    catalogRequests++;
    expect(new URL(route.request().url()).searchParams.get('search')).toBe('Cowboy Bebop');
    return route.fulfill({ json: [{ id: 1, name: 'Cowboy Bebop', russian: 'Cowboy Bebop', kind: 'tv', aired_on: '1998-04-03' }] });
  });
  await page.goto('/settings');
  await page.getByRole('tab', { name: /^Data(?: & Cloud)?$/, exact: true }).click();
  const transfer = page.getByRole('region', { name: 'List Transfer (Shikimori / MAL)' });
  await expect(transfer.getByRole('checkbox')).toHaveCount(5);
  await transfer.getByRole('radio', { name: 'JSON (Shikimori)', exact: true }).check();
  await transfer.getByRole('button', { name: 'Export lists', exact: true }).click();
  await expect(transfer.getByRole('button', { name: 'Export lists', exact: true })).toBeDisabled();
  await transfer.getByRole('button', { name: 'Suggestions', exact: true }).click();
  await expect(transfer.getByText(/ID: 1(?:\D|$)/)).toBeVisible();
  expect(catalogRequests).toBe(1);
  expect(exportRequests).toBe(1);
  await transfer.getByRole('button', { name: 'Select', exact: true }).click();
  const pending = page.waitForEvent('download');
  await transfer.getByRole('button', { name: 'Export lists', exact: true }).click();
  const download = await pending;
  expect(download.suggestedFilename()).toMatch(/\.json$/);
  const stream = await download.createReadStream();
  if (!stream) throw new Error('Export file missing');
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  expect(data).toHaveLength(1);
  expect(data[0]).toMatchObject({ target_id: 1, target_type: 'Anime', status: 'watching', score: 8 });
  expect(data[0].target_id).not.toBe(anime.id);
});
