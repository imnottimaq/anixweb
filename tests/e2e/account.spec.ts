import { test, expect } from '@playwright/test';
import { setupDeterministicNetwork } from './helpers/network';
import { seedStorageState } from './helpers/auth';
import { mockProfile } from './fixtures/mockData';

test('Account navigation opens login for guests and Back returns home', async ({ page }) => {
    await setupDeterministicNetwork(page, { isLoggedIn: false });
    await seedStorageState(page, { isLoggedIn: false });
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/');
    await page.locator('#primary-navigation').getByRole('link', { name: /Аккаунт|Account/i }).click();
    await expect(page).toHaveURL(/\/account\/login$/);
    await expect(page.locator('input[type="password"]')).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(/\/$/);
    expect(errors).toEqual([]);
});

test('Opening account directly without a session opens login', async ({ page }) => {
    await setupDeterministicNetwork(page, { isLoggedIn: false });
    await seedStorageState(page, { isLoggedIn: false });
    await page.goto('/account');
    await expect(page).toHaveURL(/\/account\/login$/);
    await expect(page.locator('input[type="password"]')).toBeVisible();
});

test('Account navigation still opens the profile for signed-in users', async ({ page }) => {
    await setupDeterministicNetwork(page, { isLoggedIn: true });
    await seedStorageState(page, { isLoggedIn: true });
    await page.route(`**/profile/${mockProfile.id}?*`, route => route.fulfill({
        json: { code: 0, profile: mockProfile, is_my_profile: true },
    }));
    await page.goto('/');
    await page.locator('#primary-navigation').getByRole('link', { name: /Аккаунт|Account/i }).click();
    await expect(page).toHaveURL(/\/account$/);
    await expect(page.getByText(mockProfile.login, { exact: true })).toBeVisible();
});

test('A stale token returning a public profile opens login and clears the stale session', async ({ page }) => {
    await setupDeterministicNetwork(page, { isLoggedIn: true });
    await seedStorageState(page, { isLoggedIn: true });
    await page.route(`**/profile/${mockProfile.id}?*`, route => route.fulfill({
        json: { code: 0, profile: mockProfile, is_my_profile: false },
    }));
    await page.goto('/');
    await page.locator('#primary-navigation').getByRole('link', { name: /Аккаунт|Account/i }).click();
    await expect(page).toHaveURL(/\/account\/login$/);
    await expect(page.locator('input[type="password"]')).toBeVisible();
    expect((await page.context().cookies()).some(cookie => cookie.name === 'anixart_token')).toBe(false);
    expect(await page.evaluate(() => localStorage.getItem('user_id'))).toBeNull();
    await page.reload();
    await expect(page.locator('input[type="password"]')).toBeVisible();
});

for (const status of [200, 401]) {
    test(`Rejected session (${status}) opens login`, async ({ page }) => {
        await setupDeterministicNetwork(page, { isLoggedIn: true });
        await seedStorageState(page, { isLoggedIn: true });
        await page.route(`**/profile/${mockProfile.id}?*`, route => route.fulfill({ status, json: { code: 401 } }));
        await page.goto('/account');
        await expect(page).toHaveURL(/\/account\/login$/);
        await expect(page.locator('input[type="password"]')).toBeVisible();
    });
}

test('A temporary API outage preserves the session', async ({ page }) => {
    await setupDeterministicNetwork(page, { isLoggedIn: true });
    await seedStorageState(page, { isLoggedIn: true });
    await page.route(`**/profile/${mockProfile.id}?*`, route => route.fulfill({ status: 503, json: {} }));
    await page.goto('/account');
    await expect(page.getByRole('alert').getByRole('button')).toBeVisible();
    await expect(page).toHaveURL(/\/account$/);
    expect((await page.context().cookies()).some(cookie => cookie.name === 'anixart_token')).toBe(true);
});

test('Viewing another public profile preserves the session', async ({ page }) => {
    await setupDeterministicNetwork(page, { isLoggedIn: true });
    await seedStorageState(page, { isLoggedIn: true });
    await page.route('**/profile/2?*', route => route.fulfill({
        json: { code: 0, profile: { ...mockProfile, id: 2 }, is_my_profile: false },
    }));
    await page.goto('/account/2');
    await expect(page.getByText(mockProfile.login, { exact: true })).toBeVisible();
    await expect(page).toHaveURL(/\/account\/2$/);
    expect((await page.context().cookies()).some(cookie => cookie.name === 'anixart_token')).toBe(true);
});
