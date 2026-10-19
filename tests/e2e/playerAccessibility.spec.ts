import { test, expect, type Page } from '@playwright/test';
import { setupDeterministicNetwork } from './helpers/network';
import { seedStorageState } from './helpers/auth';
import { defaultAppSettings } from '../../src/shared/types/settings';

async function preparePlayer(page: Page, sessionAnimeId: number | null = 101, rememberEpisodeTime = false) {
  await setupDeterministicNetwork(page);
  await seedStorageState(page, { settings: {
    ...defaultAppSettings,
    appearance: { ...defaultAppSettings.appearance, language: 'english' },
    content: { ...defaultAppSettings.content, rememberEpisodeTime },
    player: { ...defaultAppSettings.player, autoFullscreen: false, autoPauseOnTabSwitch: false },
  } });
  await page.addInitScript(animeId => {
    // Exercise the real player events without relying on a streaming provider or codec.
    const paused = new WeakMap<HTMLMediaElement, boolean>();
    Object.defineProperties(HTMLMediaElement.prototype, {
      paused: { configurable: true, get() { return paused.get(this) ?? true; } },
      duration: { configurable: true, get() { return 1200; } },
      readyState: { configurable: true, get() { return 4; } },
      error: { configurable: true, get() { return null; } },
    });
    HTMLMediaElement.prototype.load = function () {};
    HTMLMediaElement.prototype.play = function () {
      paused.set(this, false);
      this.dispatchEvent(new Event('play'));
      this.dispatchEvent(new Event('playing'));
      return Promise.resolve();
    };
    HTMLMediaElement.prototype.pause = function () {
      paused.set(this, true);
      this.dispatchEvent(new Event('pause'));
    };
    if (animeId !== null) sessionStorage.setItem('player_session', JSON.stringify({
      animeId, animeName: 'Accessibility fixture', episodeNumber: 2, episodeName: 'Episode two',
      dubId: 1, sourceId: 10,
      episodes: [1, 2, 3].map(position => ({ position, name: `Episode ${position}`, url: `https://media.example.test/${position}` })),
      sources: { '720': [{ src: 'https://media.example.test/accessibility.mp4', type: 'video/mp4' }] },
    }));
  }, sessionAnimeId);
}

async function openPlayer(page: Page) {
  await preparePlayer(page);
  await page.goto('/anime/101/watch');
  const player = page.getByRole('dialog', { name: 'Video player', exact: true });
  await expect(player).toBeVisible();
  return player;
}

test('player initially focuses Back to release and contains keyboard focus with an inert app behind it', async ({ page }) => {
  const player = await openPlayer(page);
  const back = player.getByRole('button', { name: 'Back to release', exact: true });
  await expect(back).toBeFocused();
  await expect(page.locator('#root')).toHaveAttribute('inert', '');
  expect(await player.evaluate(element => !document.querySelector('#root')?.contains(element))).toBe(true);
  await page.keyboard.press('Shift+Tab');
  expect(await player.evaluate(element => element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Tab');
  await expect(back).toBeFocused();
  for (let index = 0; index < 20; index++) {
    await page.keyboard.press('Tab');
    expect(await player.evaluate(element => element.contains(document.activeElement))).toBe(true);
  }
});

test('focused player controls remain visible beyond the auto-hide timer during playback', async ({ page }) => {
  const player = await openPlayer(page);
  const settings = player.getByRole('button', { name: 'Player settings', exact: true });
  await settings.focus();
  await page.clock.install();
  await player.locator('video').evaluate(video => {
    video.dispatchEvent(new Event('loadedmetadata'));
    video.dispatchEvent(new Event('canplay'));
    video.dispatchEvent(new Event('play'));
    video.dispatchEvent(new Event('playing'));
  });
  await page.clock.fastForward(3500);
  await expect(settings).toBeFocused();
  const controls = settings.locator('xpath=ancestor::div[contains(@class,"player-controls")][1]');
  await expect(controls).toHaveCSS('opacity', '1');
  await expect(settings).toBeVisible();
});

test('player names episode, sound, skip, fullscreen, timeline, and volume controls', async ({ page }) => {
  const player = await openPlayer(page);
  await expect(player.getByRole('button', { name: 'Previous episode', exact: true })).toBeVisible();
  await expect(player.getByRole('button', { name: 'Next episode', exact: true })).toBeVisible();
  await expect(player.getByRole('button', { name: 'Mute', exact: true })).toBeVisible();
  await expect(player.getByRole('button', { name: 'Skip opening', exact: true })).toBeVisible();
  await expect(player.getByRole('button', { name: 'Enter fullscreen', exact: true })).toBeVisible();
  await expect(player.getByRole('slider', { name: 'Playback position', exact: true })).toBeAttached();
  await player.getByRole('button', { name: 'Show volume control', exact: true }).click();
  await expect(player.getByRole('slider', { name: 'Volume', exact: true })).toBeVisible();
});

test('Escape continues saved progress and clears the pending resume state so playback progress saves', async ({ page }) => {
  await preparePlayer(page, 101, true);
  await page.addInitScript(() => localStorage.setItem('watch_progress', JSON.stringify({ '101': { '2': 240 } })));
  await page.goto('/anime/101/watch');
  const player = page.getByRole('dialog', { name: 'Video player', exact: true });
  const video = player.locator('video');
  await video.evaluate(element => element.dispatchEvent(new Event('loadedmetadata')));
  const resume = page.getByRole('dialog', { name: 'Continue', exact: true });
  await expect(resume).toBeVisible();
  await expect.poll(() => video.evaluate(element => (element as HTMLVideoElement).paused)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(resume).toHaveCount(0);
  await expect(player).toBeVisible();
  expect(await video.evaluate(element => (element as HTMLVideoElement).currentTime)).toBe(240);
  await video.evaluate(element => element.dispatchEvent(new Event('canplay')));
  await expect.poll(() => video.evaluate(element => (element as HTMLVideoElement).paused)).toBe(false);
  await video.evaluate(element => {
    (element as HTMLVideoElement).currentTime = 310;
    element.dispatchEvent(new Event('timeupdate'));
  });
  await player.getByRole('button', { name: 'Back to release', exact: true }).click();
  await expect(page).toHaveURL(/\/anime\/101$/);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('watch_progress') ?? '{}')['101']['2'])).toBe(310);
});

for (const sessionAnimeId of [null, 999]) {
  test(`direct player link recovers the requested release with ${sessionAnimeId === null ? 'no' : 'a mismatched'} saved session`, async ({ page }) => {
    await preparePlayer(page, sessionAnimeId);
    await page.goto('/anime/101/watch');
    await expect(page).toHaveURL(/\/anime\/101$/);
    await expect(page.getByRole('dialog', { name: 'Select dub', exact: true })).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Video player', exact: true })).toHaveCount(0);
  });
}
