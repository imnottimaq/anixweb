import { test, expect } from '@playwright/test';
import { setupDeterministicNetwork } from './helpers/network';
import { seedStorageState } from './helpers/auth';
import { mockAnime1, mockProfile } from './fixtures/mockData';
import { defaultAppSettings } from '../../src/shared/types/settings';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let videoFixture: Promise<Buffer> | undefined;
function fixtureVideo() {
  return videoFixture ??= readFile(process.env.ANIXWEB_TEST_VIDEO || join(tmpdir(), 'anixweb-browser-fixtures', 'trailer.mp4'))
    .catch(async () => {
      const response = await fetch('https://media.w3.org/2010/05/sintel/trailer.mp4');
      if (!response.ok) throw new Error('Public MP4 test fixture unavailable');
      return Buffer.from(await response.arrayBuffer());
    });
}

test('weekly comments resolve interleaved and forward JSON identity references to the correct anime', async ({ page }) => {
  await setupDeterministicNetwork(page);
  await seedStorageState(page, { onboarded: true, settings: {
    ...defaultAppSettings, appearance: { ...defaultAppSettings.appearance, language: 'english' },
  } });
  const releases = [
    { ...mockAnime1, '@id': 71, id: 9101, title_original: 'First season' },
    { ...mockAnime1, '@id': 82, id: 9102, title_original: 'Second season' },
  ];
  const comments = [82, releases[0], releases[1], 71, 82, 999].map((release, index) => ({
    id: index + 1, profile: mockProfile, release, message: `Identity comment ${index + 1}`,
    timestamp: 1700000000, vote_count: 1, reply_count: 0, is_spoiler: false,
  }));
  await page.route('**/discover/*', route => new URL(route.request().url()).hostname !== 'api-s.anixsekai.com' ? route.fallback() : route.fulfill({ json: {
    code: 0, content: new URL(route.request().url()).pathname === '/discover/comments' ? comments : [],
  } }));
  await page.goto('/overview');
  for (const [number, id, title] of [[1, 9102, 'Second season'], [2, 9101, 'First season'],
    [3, 9102, 'Second season'], [4, 9101, 'First season'], [5, 9102, 'Second season']] as const) {
    const comment = page.getByRole('link').filter({ hasText: `Identity comment ${number}` });
    await expect(comment).toHaveAttribute('href', `/anime/${id}`);
    await expect(comment).toContainText(title);
  }
  await expect(page.getByRole('link').filter({ hasText: 'Identity comment 6' })).toHaveCount(0);
  await expect(page.getByText('Identity comment 6', { exact: true })).toBeVisible();
});

test('episode download saves the selected MP4 bytes and preserves working playback', async ({ page }) => {
  const videoBytes = await fixtureVideo();
  await setupDeterministicNetwork(page);
  await seedStorageState(page, { onboarded: true, settings: {
    ...defaultAppSettings, appearance: { ...defaultAppSettings.appearance, language: 'english' },
    content: { ...defaultAppSettings.content, rememberEpisodeTime: false },
  } });
  await page.route('https://media.example.test/episode.mp4', route => route.fulfill({
    status: 200, contentType: 'video/mp4', body: videoBytes,
    headers: { 'Access-Control-Allow-Origin': '*', 'Content-Length': String(videoBytes.length) },
  }));
  await page.addInitScript(() => sessionStorage.setItem('player_session', JSON.stringify({
    animeId: 101, animeName: 'Download fixture', episodeNumber: 2, episodeName: 'Episode two',
    sources: { '720': [{ src: 'https://media.example.test/episode.mp4', type: 'video/mp4' }] },
  })));
  await page.goto('/anime/101/watch');
  await expect.poll(() => page.locator('video').evaluate(video => (video as HTMLVideoElement).readyState)).toBeGreaterThan(0);
  await page.mouse.move(600, 300);
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Episode Download' });
  await expect(dialog).toContainText('Episode two');
  await expect(dialog.getByRole('button', { name: /720p/ })).toBeVisible();
  const savedFile = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Start download', exact: true }).click();
  const download = await savedFile;
  expect(download.suggestedFilename()).toMatch(/720.*\.mp4$/);
  const stream = await download.createReadStream();
  if (!stream) throw new Error('Downloaded file is missing');
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  expect(Buffer.concat(chunks)).toEqual(videoBytes);
  await expect(dialog).toContainText('File downloaded successfully');
  expect(await page.locator('video').evaluate(video => Number.isFinite((video as HTMLVideoElement).duration))).toBe(true);
});

test('schedule retries an outage and day navigation uses the real weekday payload', async ({ page }) => {
  await setupDeterministicNetwork(page);
  await seedStorageState(page, { onboarded: true, settings: {
    ...defaultAppSettings, appearance: { ...defaultAppSettings.appearance, language: 'english' },
  } });
  let fail = true;
  await page.route('**/schedule', route => new URL(route.request().url()).hostname !== 'api-s.anixsekai.com' ? route.fallback() : fail
    ? route.fulfill({ status: 503, body: 'Unavailable' })
    : route.fulfill({ json: { code: 0,
      monday: [{ ...mockAnime1, title_original: 'Monday broadcast', title_ru: 'Monday broadcast' }],
      tuesday: [], wednesday: [], thursday: [], friday: [], saturday: [], sunday: [],
    } }));
  await page.goto('/schedule');
  await expect(page.getByRole('alert')).toContainText('Failed to load schedule');
  fail = false;
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await page.getByRole('tab', { name: /^Monday/ }).click();
  await expect(page.getByRole('link', { name: /Monday broadcast/ })).toBeVisible();
  await page.getByRole('tab', { name: /^Tuesday/ }).click();
  await expect(page.getByText('Nothing scheduled for this day.', { exact: true })).toBeVisible();
});

test('popular respects pagination metadata and retains loaded releases while retrying a later page', async ({ page }) => {
  await setupDeterministicNetwork(page);
  await seedStorageState(page, { onboarded: true, settings: {
    ...defaultAppSettings, appearance: { ...defaultAppSettings.appearance, language: 'english' },
  } });
  let failNext = true;
  const requestedPages: number[] = [];
  await page.route('**/filter/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname !== 'api-s.anixsekai.com') return route.fallback();
    expect(route.request().postDataJSON().sort).toBe(3);
    const number = Number(url.pathname.split('/').at(-1));
    requestedPages.push(number);
    if (number === 1 && failNext) return route.fulfill({ status: 503, body: 'Unavailable' });
    return route.fulfill({ json: { code: 0, current_page: number, total_page_count: 2,
      content: [{ ...mockAnime1, id: 101 + number, title_ru: `Popular page ${number}`, title_original: `Popular page ${number}` }],
    } });
  });
  await page.goto('/popular');
  const first = page.getByRole('link', { name: /Popular page 0/ });
  await expect(first).toBeVisible();
  await page.getByRole('button', { name: 'Load more', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Failed to load popular releases');
  await expect(first).toBeVisible();
  failNext = false;
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByRole('link', { name: /Popular page 1/ })).toBeVisible();
  await expect(first).toBeVisible();
  await expect(page.getByRole('button', { name: 'Load more', exact: true })).toHaveCount(0);
  expect(requestedPages.slice(-2)).toEqual([1, 1]);
});

test('focus loss during media loading defers autoplay until focus returns, then preserves a manual pause', async ({ page }) => {
  const bytes = await fixtureVideo();
  await setupDeterministicNetwork(page);
  await seedStorageState(page, { onboarded: true, settings: {
    ...defaultAppSettings, appearance: { ...defaultAppSettings.appearance, language: 'english' },
    player: { ...defaultAppSettings.player, autoPauseOnTabSwitch: true, volume: 0 },
    content: { ...defaultAppSettings.content, rememberEpisodeTime: false },
  } });
  let release!: () => void;
  const wait = new Promise<void>(resolve => { release = resolve; });
  await page.route('https://media.example.test/loading.mp4', async route => {
    await wait;
    await route.fulfill({ contentType: 'video/mp4', body: bytes });
  });
  await page.addInitScript(() => sessionStorage.setItem('player_session', JSON.stringify({
    animeId: 101, animeName: 'Focus fixture', episodeNumber: 1,
    sources: { '720': [{ src: 'https://media.example.test/loading.mp4', type: 'video/mp4' }] },
  })));
  await page.goto('/anime/101/watch', { waitUntil: 'domcontentloaded' });
  const video = page.locator('video');
  await expect(video).toBeAttached();
  await video.evaluate(element => { (element as HTMLVideoElement).muted = true; window.dispatchEvent(new Event('blur')); });
  release();
  await expect.poll(() => video.evaluate(element => (element as HTMLVideoElement).readyState)).toBeGreaterThanOrEqual(3);
  expect(await video.evaluate(element => (element as HTMLVideoElement).paused)).toBe(true);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect.poll(() => video.evaluate(element => (element as HTMLVideoElement).paused)).toBe(false);
  await video.evaluate(element => (element as HTMLVideoElement).pause());
  await page.evaluate(() => { window.dispatchEvent(new Event('blur')); window.dispatchEvent(new Event('focus')); });
  expect(await video.evaluate(element => (element as HTMLVideoElement).paused)).toBe(true);
});

test('automatic fullscreen can retry after denial and does not re-enter when changing quality', async ({ page }) => {
  const bytes = await fixtureVideo();
  await setupDeterministicNetwork(page);
  await seedStorageState(page, { onboarded: true, settings: {
    ...defaultAppSettings, appearance: { ...defaultAppSettings.appearance, language: 'english' },
    player: { ...defaultAppSettings.player, autoFullscreen: true, volume: 0 },
    content: { ...defaultAppSettings.content, rememberEpisodeTime: false },
  } });
  await page.route('https://media.example.test/fullscreen-*.mp4', route => route.fulfill({ contentType: 'video/mp4', body: bytes }));
  await page.addInitScript(() => {
    const currentWindow = window as typeof window & { fullscreenAttempts: number };
    currentWindow.fullscreenAttempts = 0;
    const request = HTMLElement.prototype.requestFullscreen;
    HTMLElement.prototype.requestFullscreen = function(options) {
      currentWindow.fullscreenAttempts++;
      if (currentWindow.fullscreenAttempts === 1) return Promise.reject(new DOMException('Fixture denial', 'NotAllowedError'));
      return request.call(this, options);
    };
    sessionStorage.setItem('player_session', JSON.stringify({
      animeId: 101, animeName: 'Fullscreen fixture', episodeNumber: 1,
      sources: {
        '1080': [{ src: 'https://media.example.test/fullscreen-1080.mp4', type: 'video/mp4' }],
        '720': [{ src: 'https://media.example.test/fullscreen-720.mp4', type: 'video/mp4' }],
      },
    }));
  });
  await page.goto('/anime/101/watch');
  const attempts = () => page.evaluate(() => (window as typeof window & { fullscreenAttempts: number }).fullscreenAttempts);
  await expect.poll(attempts).toBe(1);
  await page.locator('video').evaluate(element => (element as HTMLVideoElement).pause());
  await page.mouse.move(600, 300);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(true);
  await expect.poll(attempts).toBe(2);
  await page.evaluate(() => document.exitFullscreen());
  await page.mouse.move(600, 300);
  await page.getByRole('button', { name: 'Player settings', exact: true }).click();
  await page.getByRole('button', { name: '720p', exact: true }).click();
  await expect.poll(() => page.locator('video').evaluate(element => (element as HTMLVideoElement).currentSrc)).toContain('fullscreen-720.mp4');
  await expect.poll(() => page.locator('video').evaluate(element => (element as HTMLVideoElement).paused)).toBe(false);
  expect(await attempts()).toBe(2);
  expect(await page.evaluate(() => Boolean(document.fullscreenElement))).toBe(false);
});

test('mobile navigation fits the viewport, restores focus and opens the schedule with keyboard tabs', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setupDeterministicNetwork(page);
  await seedStorageState(page, { onboarded: true, settings: {
    ...defaultAppSettings, appearance: { ...defaultAppSettings.appearance, language: 'english', theme: 'light' },
  } });
  await page.goto('/popular');
  const toggle = page.getByRole('button', { name: 'Menu', exact: true });
  const navigation = page.getByRole('navigation', { name: 'Primary navigation' });
  await toggle.click();
  await expect(navigation.getByRole('link', { name: 'Popular', exact: true })).toHaveCount(0);
  await expect(navigation.getByRole('link', { name: 'Schedule', exact: true })).toHaveCount(0);
  expect(await navigation.evaluate(element => {
    const rect = element.getBoundingClientRect();
    return rect.left >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight;
  })).toBe(true);
  await page.screenshot({ path: 'test-results/roadmap-navigation-mobile.png' });
  await page.keyboard.press('Escape');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(toggle).toBeFocused();
  await toggle.click();
  await navigation.getByRole('link', { name: 'Discover', exact: true }).click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await page.getByRole('link', { name: 'Schedule', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Release Schedule', exact: true })).toBeVisible();
  const monday = page.getByRole('tab', { name: /^Monday/ });
  await monday.click();
  await monday.press('ArrowRight');
  const tuesday = page.getByRole('tab', { name: /^Tuesday/ });
  await expect(tuesday).toHaveAttribute('aria-selected', 'true');
  await expect(tuesday).toBeFocused();
});
