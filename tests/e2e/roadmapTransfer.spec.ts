import { test, expect } from '@playwright/test';
import { setupDeterministicNetwork } from './helpers/network';
import { seedStorageState } from './helpers/auth';
import { mockAnime1 } from './fixtures/mockData';
import { defaultAppSettings } from '../../src/shared/types/settings';

test('list export resolves a genuine Shikimori candidate and saves its ID rather than the Anixart ID', async ({ page }) => {
  await setupDeterministicNetwork(page, { isLoggedIn: true });
  await seedStorageState(page, { isLoggedIn: true, onboarded: true, settings: {
    ...defaultAppSettings, appearance: { ...defaultAppSettings.appearance, language: 'english' },
  } });
  const anime = { ...mockAnime1, id: 42001, title_ru: 'Cowboy Bebop', title_original: 'Cowboy Bebop', profile_list_status: 1, your_vote: 4 };
  await page.route('**/profile/list/all/**', route => new URL(route.request().url()).hostname !== 'api-s.anixsekai.com'
    ? route.fallback() : route.fulfill({ json: { code: 0, current_page: 0, total_page_count: 1, content: [anime] } }));
  await page.route('**/favorite/all/**', route => new URL(route.request().url()).hostname !== 'api-s.anixsekai.com'
    ? route.fallback() : route.fulfill({ json: { code: 0, current_page: 0, total_page_count: 1, content: [] } }));
  let catalogRequests = 0;
  await page.route('https://shikimori.one/api/animes**', route => {
    catalogRequests++;
    expect(new URL(route.request().url()).searchParams.get('search')).toBe('Cowboy Bebop');
    return route.fulfill({ json: [{ id: 1, name: 'Cowboy Bebop', russian: 'Cowboy Bebop', kind: 'tv', aired_on: '1998-04-03' }] });
  });
  await page.goto('/settings');
  await page.getByRole('tab', { name: /^Data(?: & Cloud)?$/, exact: true }).click();
  const transfer = page.getByRole('region', { name: 'List Transfer (Shikimori / MAL)' });
  await transfer.getByRole('radio', { name: 'JSON (Shikimori)', exact: true }).check();
  await transfer.getByRole('button', { name: 'Export lists', exact: true }).click();
  await expect(transfer.getByRole('button', { name: 'Export lists', exact: true })).toBeDisabled();
  await transfer.getByRole('button', { name: 'Suggestions', exact: true }).click();
  await expect(transfer.getByText(/ID: 1(?:\D|$)/)).toBeVisible();
  expect(catalogRequests).toBe(1);
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
