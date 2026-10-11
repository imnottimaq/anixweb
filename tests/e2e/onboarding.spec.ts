import { test, expect } from '@playwright/test';
import { setupDeterministicNetwork } from './helpers/network';
import { seedStorageState } from './helpers/auth';

test.describe('First-visit onboarding flow', () => {
  test('displays onboarding modal on first visit without onboarded flag in storage', async ({ page }) => {
    await setupDeterministicNetwork(page);
    await seedStorageState(page, { onboarded: false });

    await page.goto('/');

    const warningHeading = page.getByRole('heading', { name: /Предупреждение|Warning/i });
    await expect(warningHeading).toBeVisible();

    const continueButton = page.getByRole('button', { name: /Продолжить|Continue/i });
    await expect(continueButton).toBeVisible();

    const languageButton = page.getByRole('button', { name: /Change language to English/i });
    await expect(languageButton).toBeVisible();
  });

  test('switches language to English from onboarding modal', async ({ page }) => {
    await setupDeterministicNetwork(page);
    await seedStorageState(page, { onboarded: false });

    await page.goto('/');

    const languageButton = page.getByRole('button', { name: /Change language to English/i });
    await expect(languageButton).toBeVisible();
    await languageButton.click();

    // Verify document language changed to English and Continue button updated
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByRole('button', { name: 'Continue' })).toBeVisible();
  });

  test('dismissing onboarding saves preference to localStorage and does not show on reload', async ({ page }) => {
    await setupDeterministicNetwork(page);
    await seedStorageState(page, { onboarded: false });

    await page.goto('/');

    const continueButton = page.getByRole('button', { name: /Продолжить|Continue/i });
    await expect(continueButton).toBeVisible();
    await continueButton.click();

    // Modal should disappear
    const warningHeading = page.getByRole('heading', { name: /Предупреждение|Warning/i });
    await expect(warningHeading).not.toBeVisible();

    // Verify localStorage has onboarded = 'true'
    const onboardedValue = await page.evaluate(() => localStorage.getItem('onboarded'));
    expect(onboardedValue).toBe('true');

    // Reload page and verify modal does not reappear
    await page.reload();
    await expect(warningHeading).not.toBeVisible();
  });
});
