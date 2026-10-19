import { test, expect, type Page } from '@playwright/test';
import { setupDeterministicNetwork } from './helpers/network';
import { seedStorageState } from './helpers/auth';
import { defaultAppSettings } from '../../src/shared/types/settings';
import { mockAnime1 } from './fixtures/mockData';

async function setup(page: Page) {
    await setupDeterministicNetwork(page, { isLoggedIn: true });
    await seedStorageState(page, { isLoggedIn: true, onboarded: true, settings: {
        ...defaultAppSettings, appearance: { ...defaultAppSettings.appearance, language: 'english' },
    } });
}

test('Donghua uses the native China filter and can be the default Home tab', async ({ page }) => {
    await setup(page);
    const filters: Record<string, unknown>[] = [];
    await page.route('https://api-s.anixsekai.com/filter/**', async route => {
        filters.push(route.request().postDataJSON());
        await route.fulfill({ json: { code: 0, content: [mockAnime1] } });
    });
    await page.goto('/');
    const tab = page.getByRole('tab', { name: 'Donghua', exact: true });
    await tab.click();
    await expect(tab).toHaveAttribute('aria-selected', 'true');
    await expect.poll(() => filters.at(-1)?.country).toBe('\u041a\u0438\u0442\u0430\u0439');
    expect(filters.at(-1)).toMatchObject({ category_id: null, status_id: null, sort: 0 });
    await tab.click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Make this tab default', exact: true }).click();
    await page.reload();
    await expect(tab).toHaveAttribute('aria-selected', 'true');
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('app_settings')!).content.defaultTabOnHome)).toBe('donghua');
});

test('dragged Home and Favorites tab orders persist independently without changing selection or defaults', async ({ page }) => {
    await setup(page);
    await page.goto('/');
    const tabs = page.getByRole('tab');
    const movies = page.getByRole('tab', { name: 'Movies', exact: true });
    await movies.dragTo(page.getByRole('tab', { name: 'My tab', exact: true }));
    await expect(tabs.first()).toHaveText('Movies');
    await expect(page.getByRole('tab', { name: 'Latest', exact: true })).toHaveAttribute('aria-selected', 'true');
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('app_settings')!).content.defaultTabOnHome)).toBe('latest');
    await page.reload();
    await expect(tabs.first()).toHaveText('Movies');
    await movies.focus();
    await movies.press('Alt+ArrowDown');
    await expect(tabs.first()).toHaveText('My tab');
    await expect(tabs.nth(1)).toHaveText('Movies');
    await expect(movies).toBeFocused();
    await page.goto('/favorites');
    await page.getByRole('tab', { name: 'History', exact: true }).dragTo(page.getByRole('tab', { name: 'Collections', exact: true }));
    await expect(tabs.first()).toHaveText('History');
    await expect(page.getByRole('tab', { name: 'Favorites', exact: true })).toHaveAttribute('aria-selected', 'true');
    await page.reload();
    await expect(tabs.first()).toHaveText('History');
    await page.goto('/');
    await expect(tabs.nth(1)).toHaveText('Movies');
    await expect(page.getByRole('tab', { name: 'Latest', exact: true })).toHaveAttribute('aria-selected', 'true');
    await page.screenshot({ path: 'test-results/home-reordered-tabs.png', fullPage: true });
});

test.describe('Touch tab ordering', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    test('the grip reorders mobile tabs without selecting the dragged tab', async ({ page }) => {
        await setup(page);
        await page.goto('/');
        const source = page.getByRole('tab', { name: 'My tab', exact: true }).locator('[data-tab-grip]');
        const target = page.getByRole('tab', { name: 'Latest', exact: true });
        const start = (await source.boundingBox())!, end = (await target.boundingBox())!;
        const from = { x: start.x + start.width / 2, y: start.y + start.height / 2 };
        const to = { x: end.x + end.width / 2, y: end.y + end.height / 2 };
        const session = await page.context().newCDPSession(page);
        await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] });
        for (let step = 1; step <= 10; step++) await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x + (to.x - from.x) * step / 10, y: from.y + (to.y - from.y) * step / 10 }] });
        await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await expect(page.getByRole('tab').first()).toHaveText('Latest');
        await expect(target).toHaveAttribute('aria-selected', 'true');
        await page.reload();
        await expect(page.getByRole('tab').first()).toHaveText('Latest');
        expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
        await page.screenshot({ path: 'test-results/home-reordered-tabs-mobile.png', fullPage: true });
    });
});

test('custom tab menus persist independent Home and Favorites defaults across reloads', async ({ page }) => {
    await setup(page);
    await page.goto('/');
    await page.getByRole('tab', { name: 'Completed', exact: true }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Make this tab default', exact: true }).click();
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('app_settings')!).content.defaultTabOnHome)).toBe('finished');
    await page.reload();
    await expect(page.getByRole('tab', { name: 'Completed', exact: true })).toHaveAttribute('aria-selected', 'true');
    await page.goto('/favorites');
    await page.getByRole('tab', { name: 'On hold', exact: true }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Make this tab default', exact: true }).click();
    await page.reload();
    await expect(page.getByRole('tab', { name: 'On hold', exact: true })).toHaveAttribute('aria-selected', 'true');
    const content = await page.evaluate(() => JSON.parse(localStorage.getItem('app_settings')!).content);
    expect(content.defaultTabOnHome).toBe('finished');
    expect(content.defaultTabOnFavorites).toBe('hold_on');
});

test('keyboard menu opens My Page filters, persists edits and restores focus', async ({ page }) => {
    await setup(page);
    await page.goto('/');
    const myTab = page.getByRole('tab', { name: 'My tab', exact: true });
    await myTab.focus();
    await myTab.press('Shift+F10');
    await expect(page.getByRole('menu')).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Make this tab default', exact: true })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(myTab).toBeFocused();
    await myTab.press('Shift+F10');
    await page.getByRole('menuitem', { name: 'Change filters', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Filters', exact: true });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('spinbutton', { name: 'Year: from', exact: true }).fill('2020');
    await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(myTab).toBeFocused();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('my_filters')!))).toMatchObject({ start_year: 2020 });
    await myTab.click();
    await page.reload();
    await page.getByRole('tab', { name: 'My tab', exact: true }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Change filters', exact: true }).click();
    await expect(page.getByRole('spinbutton', { name: 'Year: from', exact: true })).toHaveValue('2020');
});

test('context menu stays in the viewport and closes on outside clicks', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await setup(page);
    await page.goto('/');
    const tab = page.getByRole('tab', { name: 'Latest', exact: true });
    await tab.evaluate(element => element.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 389, clientY: 843 })));
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    await expect.poll(async () => { const bounds = await menu.boundingBox(); return bounds!.x + bounds!.width; }).toBeLessThanOrEqual(390);
    await expect.poll(async () => { const bounds = await menu.boundingBox(); return bounds!.y + bounds!.height; }).toBeLessThanOrEqual(844);
    await page.screenshot({ path: 'test-results/tab-context-menu-mobile.png' });
    await page.mouse.click(5, 70);
    await expect(menu).toHaveCount(0);
});
