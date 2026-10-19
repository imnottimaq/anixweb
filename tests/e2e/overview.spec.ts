import { test, expect } from '@playwright/test';
import { setupDeterministicNetwork } from './helpers/network';
import { seedStorageState } from './helpers/auth';
import { mockAnime1 } from './fixtures/mockData';

test('Recommendations use the native request and can retry independently', async ({ page }) => {
    await setupDeterministicNetwork(page, { isLoggedIn: true });
    await seedStorageState(page, { isLoggedIn: true });
    let attempts = 0;
    let otherRequests = 0;
    await page.route('https://api-s.anixsekai.com/discover/**', async route => {
        const request = route.request();
        const url = new URL(request.url());
        expect(request.method()).toBe('POST');
        if (url.pathname.startsWith('/discover/recommendations/')) {
            expect(url.pathname).toBe('/discover/recommendations/-1');
            expect(url.searchParams.get('previous_page')).toBe('-1');
            expect(url.searchParams.get('token')).toBe('test-auth-token-123');
            attempts++;
            return route.fulfill(attempts === 1
                ? { status: 503, json: {} }
                : { json: { code: 0, content: [mockAnime1] } });
        }
        otherRequests++;
        return route.fulfill({ json: { code: 0, content: [] } });
    });
    await page.goto('/overview');
    const section = page.locator('section').filter({ has: page.getByRole('heading', { name: /Рекомендуем тебе|Recommended for you/ }) });
    await expect(section.getByRole('alert')).toBeVisible();
    await expect.poll(() => otherRequests).toBe(4);
    await section.getByRole('button').click();
    await expect(section.getByRole('link')).toHaveAttribute('href', `/anime/${mockAnime1.id}`);
    expect(attempts).toBe(2);
    expect(otherRequests).toBe(4);
});
