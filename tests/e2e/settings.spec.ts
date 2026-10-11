import { test, expect } from '@playwright/test';
import { setupDeterministicNetwork } from './helpers/network';
import { seedStorageState } from './helpers/auth';
import { defaultAppSettings, type AppSettings } from '../../src/shared/types/settings';

test.describe('Settings screen flow', () => {
  test('opens a separate keyboard shortcut dialog with persistent bindings, reset and capture cancellation', async ({ page }) => {
    await setupDeterministicNetwork(page);
    await seedStorageState(page, {onboarded:true,settings:{...defaultAppSettings,appearance:{...defaultAppSettings.appearance,language:'english'}}});
    await page.goto('/settings');
    await page.getByRole('tab',{name:'Player',exact:true}).click();
    const configure = page.getByRole('button',{name:'Configure shortcuts'});
    await expect(page.getByRole('button',{name:/^Play \/ pause/})).toHaveCount(0);
    await configure.click();
    const dialog = page.getByRole('dialog',{name:'Keyboard shortcuts'});
    const play = dialog.getByRole('button',{name:/^Play \/ pause/});
    await expect(dialog).toBeVisible();
    await play.click();
    await play.press('m');
    await expect(play).toHaveText('M');
    await expect(dialog.getByRole('button',{name:/^Mute \/ unmute/})).toHaveText('Unassigned');
    await play.click();
    await play.press('Escape');
    await expect(dialog).toBeVisible();
    await expect(play).toHaveText('M');
    await play.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(configure).toBeFocused();
    await page.reload();
    await page.getByRole('tab',{name:'Player',exact:true}).click();
    await configure.click();
    await expect(play).toHaveText('M');
    await expect(dialog.getByRole('button',{name:/^Mute \/ unmute/})).toHaveText('Unassigned');
    await page.setViewportSize({width:390,height:844});
    const fits = await dialog.evaluate(element=>{const rect=element.getBoundingClientRect();return rect.left>=0 && rect.right<=innerWidth && rect.height<=innerHeight;});
    expect(fits).toBe(true);
    await page.screenshot({path:'test-results/roadmap-shortcuts-mobile.png',animations:'disabled'});
    await dialog.getByRole('button',{name:'Reset',exact:true}).click();
    await expect(play).toHaveText('Space');
    await expect(dialog.getByRole('button',{name:/^Mute \/ unmute/})).toHaveText('M');
    const saved = await page.evaluate(()=>JSON.parse(localStorage.getItem('app_settings')!).player.keybindings);
    expect(saved).toEqual(defaultAppSettings.player.keybindings);
    await dialog.getByRole('button',{name:'Close',exact:true}).click();
    await expect(dialog).toHaveCount(0);
    await expect(configure).toBeFocused();
  });

  test('chosen initial favorites tab persists and opens in personal lists', async ({page}) => {
    await setupDeterministicNetwork(page,{isLoggedIn:true});
    await seedStorageState(page,{isLoggedIn:true,onboarded:true,settings:{...defaultAppSettings,appearance:{...defaultAppSettings.appearance,language:'english'}}});
    await page.goto('/settings');await page.getByRole('tab',{name:'Content',exact:true}).click();
    await page.getByRole('combobox',{name:'Initial favorites tab'}).selectOption('planned');
    await page.reload();await page.getByRole('tab',{name:'Content',exact:true}).click();
    await expect(page.getByRole('combobox',{name:'Initial favorites tab'})).toHaveValue('planned');
    await page.goto('/favorites');await expect(page.getByRole('tab',{name:'Plan to watch',exact:true})).toHaveAttribute('aria-selected','true');
  });

  test('switches themes and persists theme in localStorage and document dataset', async ({ page }) => {
    await setupDeterministicNetwork(page);
    await seedStorageState(page, { onboarded: true });

    await page.goto('/settings');

    // Appearance tab is active by default
    const darkThemeButton = page.getByRole('button', { name: /Тёмная|Dark/i });
    const lightThemeButton = page.getByRole('button', { name: /Светлая|Light/i });

    // Switch to Light
    await lightThemeButton.click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

    let storedSettings = await page.evaluate(() => {
      const raw = localStorage.getItem('app_settings');
      return raw ? JSON.parse(raw) : null;
    });
    expect(storedSettings?.appearance?.theme).toBe('light');

    // Switch to Dark
    await darkThemeButton.click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    storedSettings = await page.evaluate(() => {
      const raw = localStorage.getItem('app_settings');
      return raw ? JSON.parse(raw) : null;
    });
    expect(storedSettings?.appearance?.theme).toBe('dark');
  });

  test('exports valid settings json file', async ({ page }) => {
    await setupDeterministicNetwork(page);
    await seedStorageState(page, { onboarded: true });

    await page.goto('/settings');

    // Switch to Data tab
    const dataTab = page.getByRole('tab', { name: /Данные|Data/i });
    await expect(dataTab).toBeVisible();
    await dataTab.click();

    // Trigger export and wait for download
    const downloadPromise = page.waitForEvent('download');
    const exportButton = page.getByRole('heading', { name: /Резервная копия и данные|Backup & Data/i }).locator('..').getByRole('button', { name: /Экспортировать|Export/i, exact: true });
    await expect(exportButton).toBeVisible();
    await exportButton.click();

    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/anixweb-settings-.*\.json/);

    const stream = await download.createReadStream();
    if (!stream) throw new Error('Download stream not available');

    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.from(chunk));
    }
    const fileContent = Buffer.concat(chunks).toString('utf-8');
    const parsed = JSON.parse(fileContent);

    expect(parsed.version).toBe(1);
    expect(parsed.settings).toBeDefined();
    expect(parsed.settings.appearance).toBeDefined();
  });

  test('imports valid settings file and updates state with success message', async ({ page }) => {
    await setupDeterministicNetwork(page);
    await seedStorageState(page, { onboarded: true });

    await page.goto('/settings');

    // Switch to Data tab
    const dataTab = page.getByRole('tab', { name: /Данные|Data/i });
    await dataTab.click();

    const newSettings: AppSettings = {
      ...defaultAppSettings,
      appearance: {
        ...defaultAppSettings.appearance,
        theme: 'light',
        compactMode: true,
      },
    };

    const importPayload = JSON.stringify({
      version: 1,
      exportedAt: new Date().toISOString(),
      settings: newSettings,
      my_filters: { status_id: 1 },
    });

    // Upload via file input
    const fileInput = page.getByTestId('settings-backup-file');
    await fileInput.setInputFiles({
      name: 'valid-settings.json',
      mimeType: 'application/json',
      buffer: Buffer.from(importPayload, 'utf-8'),
    });

    // Success alert should appear
    await expect(page.getByText(/успешно импортированы|imported successfully/i)).toBeVisible();

    // Verify localStorage was updated
    const stored = await page.evaluate(() => {
      const raw = localStorage.getItem('app_settings');
      return raw ? JSON.parse(raw) : null;
    });
    expect(stored?.appearance?.theme).toBe('light');
    expect(stored?.appearance?.compactMode).toBe(true);
  });

  test('rejects malformed settings import without crashing or corrupting state', async ({ page }) => {
    await setupDeterministicNetwork(page);
    await seedStorageState(page, { onboarded: true });

    await page.goto('/settings');

    // Initial settings state
    const originalSettings = await page.evaluate(() => localStorage.getItem('app_settings'));

    // Switch to Data tab
    const dataTab = page.getByRole('tab', { name: /Данные|Data/i });
    await dataTab.click();

    const malformedPayload = '{"corrupted": true, broken';

    const fileInput = page.getByTestId('settings-backup-file');
    await fileInput.setInputFiles({
      name: 'corrupted-settings.json',
      mimeType: 'application/json',
      buffer: Buffer.from(malformedPayload, 'utf-8'),
    });

    // Error alert should appear
    await expect(page.locator('[role="alert"]').filter({ hasText: /ошибка.*импорт|failed to import/i })).toBeVisible();

    // App should still be healthy and interactive
    const appearanceTab = page.getByRole('tab', { name: /Внешний вид|Appearance/i });
    await expect(appearanceTab).toBeVisible();
    await appearanceTab.click();
    await expect(page.getByRole('heading', { name: /Внешний вид|Appearance/i })).toBeVisible();

    // Verify state was not wiped or corrupted
    const currentSettings = await page.evaluate(() => localStorage.getItem('app_settings'));
    expect(currentSettings).toBe(originalSettings);
  });
});
