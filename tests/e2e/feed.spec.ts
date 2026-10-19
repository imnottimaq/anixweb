import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { setupDeterministicNetwork } from './helpers/network';
import { seedStorageState } from './helpers/auth';
import { defaultAppSettings } from '../../src/shared/types/settings';
import { feedArticle, feedChannel, feedComment, feedPage } from '../fixtures/feed';

const artwork = readFileSync('tests/fixtures/images/jjk_poster.jpg');
async function setup(page: Page, options: { loggedIn?: boolean; theme?: 'dark' | 'light'; failOnce?: boolean; subscriptions?: number } = {}) {
    const loggedIn = options.loggedIn ?? true;
    await setupDeterministicNetwork(page, { isLoggedIn: loggedIn });
    await seedStorageState(page, { isLoggedIn: loggedIn, onboarded: true, settings: {
        ...defaultAppSettings, appearance: { ...defaultAppSettings.appearance, language: 'english', theme: options.theme ?? 'dark' },
    } });
    await page.route('https://images.example.com/feed-*', route => route.fulfill({ contentType: 'image/jpeg', body: artwork }));
    const requests: { path: string; method: string }[] = [];
    let failed = false;
    await page.route('https://api-s.anixsekai.com/**', async route => {
        const url = new URL(route.request().url());
        const path = url.pathname;
        let body: unknown;
        if (path.startsWith('/feed/latest/all/')) {
            if (options.failOnce && !failed) { failed = true; return route.fulfill({ status: 503 }); }
            const index = Number(path.split('/').pop());
            body = feedPage(index === 0 ? [feedArticle] : index === 1 ? [feedArticle, { ...feedArticle, id: 42 }] : [], 50);
        } else if (path === '/channel/subscription/count') body = { code: 0, subscription_count: options.subscriptions ?? 0 };
        else if (path === '/feed/all/0') body = feedPage([feedArticle]);
        else if (path === '/channel/recommendations/0') body = feedPage([feedChannel]);
        else if (path === '/channel/7') body = { code: 0, channel: feedChannel };
        else if (path.startsWith('/channel/7/article/all/')) {
            expect(route.request().method()).toBe('POST');
            expect(route.request().postData()).toBeNull();
            body = feedPage([feedArticle]);
        } else if (path === '/article/41') body = { code: 0, article: feedArticle };
        else if (path === '/article/comment/all/41/0') body = feedPage([feedComment]);
        else if (path === '/article/comment/replies/81/0') {
            expect(route.request().method()).toBe('POST');
            body = feedPage([{ ...feedComment, id: 82, reply_count: 0, message: 'A reply to the discussion.' }]);
        }
        else if (path.startsWith('/search/feed/')) {
            expect(route.request().method()).toBe('POST');
            expect(route.request().postDataJSON()).toEqual({ query: 'studio', searchBy: 0 });
            body = { code: 0, channels: feedPage([feedChannel]), blogs: feedPage([]), articles: feedPage([feedArticle]) };
        } else return route.fallback();
        requests.push({ path, method: route.request().method() });
        expect(url.searchParams.get('token')).toBe('test-auth-token-123');
        return route.fulfill({ json: body });
    });
    return requests;
}

test('reads and paginates the feed, opens full posts, replies and channel pages', async ({ page }) => {
    const requests = await setup(page);
    await page.goto('/feed');
    await expect(page.getByRole('heading', { name: 'A new season begins' })).toBeVisible();
    await expect(page.getByText('The full article continues here, beyond the feed preview.')).toHaveCount(0);
    await page.screenshot({ path: 'test-results/feed-desktop.png', fullPage: true });
    await page.getByRole('button', { name: 'Load more', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'A new season begins' })).toHaveCount(2);
    await page.getByRole('link', { name: 'Read post', exact: true }).first().click();
    await expect(page.getByText('The full article continues here, beyond the feed preview.')).toBeVisible();
    await expect(page.getByText(feedComment.message)).toBeVisible();
    await page.getByRole('button', { name: 'Replies: 1' }).click();
    await expect(page.getByText('A reply to the discussion.')).toBeVisible();
    await page.getByRole('link', { name: 'Anime journal', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Anime journal', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'A new season begins' })).toBeVisible();
    expect(requests.some(request => request.path === '/feed/latest/all/1')).toBe(true);
    expect(requests.some(request => /vote|subscribe\/|create|event/.test(request.path))).toBe(false);
});

test('reposts show the original content separately and open the original post', async ({ page }) => {
    await setup(page);
    const repost = { ...feedArticle, id: 42, channel: { ...feedChannel, id: 8, title: 'My journal' },
        payload: { blocks: [{ type: 'paragraph', data: { text: 'My comment on this post' } }] }, repost_article: feedArticle };
    await page.route('**/feed/latest/all/0?*', route => route.fulfill({ json: feedPage([repost]) }));
    await page.route('**/article/42?*', route => route.fulfill({ json: { code: 0, article: repost } }));
    await page.goto('/feed');
    const original = page.getByRole('region', { name: 'Original post', exact: true });
    await expect(page.getByText('My comment on this post')).toBeVisible();
    await expect(original.getByRole('link', { name: 'Anime journal' })).toHaveAttribute('href', '/feed/channel/7');
    await expect(original.getByRole('heading', { name: 'A new season begins' })).toBeVisible();
    await expect(original.getByRole('button', { name: 'Open image' })).toBeVisible();
    await expect(page.getByText('The full article continues here, beyond the feed preview.')).toHaveCount(0);
    await page.screenshot({ path: 'test-results/feed-repost-desktop.png', fullPage: true });
    await page.getByRole('link', { name: 'Read post', exact: true }).click();
    await expect(page).toHaveURL(/\/feed\/post\/42$/);
    await expect(original.getByText('The full article continues here, beyond the feed preview.')).toBeVisible();
    await original.getByRole('button', { name: 'Open image' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => {
        const settings = JSON.parse(localStorage.getItem('app_settings')!);
        settings.appearance.compactMode = true;
        localStorage.setItem('app_settings', JSON.stringify(settings));
    });
    await page.reload();
    await expect(original.getByRole('heading', { name: 'A new season begins' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    await page.screenshot({ path: 'test-results/feed-repost-mobile-compact.png', fullPage: true });
    await original.getByRole('link', { name: 'Original post', exact: true }).click();
    await expect(page).toHaveURL(/\/feed\/post\/41$/);
    await expect(page.getByRole('heading', { name: 'A new season begins' })).toBeVisible();
});

for (const { level, required, blocked } of [{ level: 1, required: 3, blocked: true }, { level: 3, required: 3, blocked: false }, { level: 3, required: 4, blocked: true }]) {
    test(`posting reputation notice follows server levels ${level}/${required}`, async ({ page }) => {
        await setup(page);
        await page.route('**/channel/editor/available/all?*', route => route.fulfill({ json: { code: 0, channels: [] } }));
        await page.route('**/profile/info?*', route => route.fulfill({ json: { code: 0, rating_score: level } }));
        await page.route('**/config/toggles?*', route => route.fulfill({ json: { min_blog_create_rating_score: required, staticDomain: 'anixmirai.com' } }));
        const writes: string[] = [];
        page.on('request', request => { if (/\/article\/(create|edit)\//.test(request.url())) writes.push(request.url()); });
        await page.goto('/feed?tab=my&date=2');
        await page.getByRole('link', { name: 'Write a post', exact: true }).click();
        if (blocked) {
            const notice = page.getByRole('dialog', { name: 'Profile features' });
            await expect(notice).toBeVisible();
            await expect(notice.getByRole('progressbar')).toHaveAttribute('value', String(level));
            await expect(notice.getByRole('progressbar')).toHaveAttribute('max', String(required));
            await expect(notice.getByText(`Publishing posts on your profile requires reputation level ${required}.`)).toBeVisible();
            await expect(notice.getByRole('button', { name: 'Learn how to level up' })).toBeVisible();
            await expect(page.getByRole('textbox', { name: 'Text', exact: true })).toHaveCount(0);
            await page.screenshot({ path: `test-results/feed-posting-reputation-${level}-${required}.png` });
            const helpButton = notice.getByRole('button', { name: 'Learn how to level up' });
            await helpButton.click();
            const help = page.getByRole('dialog', { name: 'How to increase reputation', exact: true });
            await expect(help).toBeVisible();
            await expect(help.getByText('Write helpful comments on releases.')).toBeVisible();
            await expect(help.getByText('Create interesting collections.')).toBeVisible();
            expect(page.context().pages()).toHaveLength(1);
            await page.setViewportSize({ width: 390, height: 844 });
            await page.screenshot({ path: 'test-results/feed-reputation-help-mobile.png' });
            await page.keyboard.press('Escape');
            await expect(help).toHaveCount(0);
            await expect(helpButton).toBeFocused();
            await expect(notice).toBeVisible();
            await notice.getByRole('button', { name: 'Got it' }).click();
            await expect(page).toHaveURL(/\/feed\?tab=my&date=2$/);
        } else {
            await expect(page.getByRole('textbox', { name: 'Text', exact: true })).toBeVisible();
            await expect(page.getByRole('dialog')).toHaveCount(0);
        }
        expect(writes).toEqual([]);
    });
}

test('existing channel publishing permissions are not blocked by the personal blog reputation gate', async ({ page }) => {
    await setup(page);
    await page.route('**/channel/editor/available/all?*', route => route.fulfill({ json: { code: 0, channels: [feedChannel] } }));
    await page.goto('/feed/compose?channel=7');
    await expect(page.getByRole('textbox', { name: 'Text', exact: true })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
});

for (const response of ['empty', 'unavailable'] as const) {
    test(`posting reputation notice handles ${response} native config responses`, async ({ page }) => {
        await setup(page);
        await page.route('**/channel/editor/available/all?*', route => route.fulfill({ json: { code: 0, channels: [] } }));
        await page.route('**/profile/info?*', route => route.fulfill({ json: { code: 0, rating_score: 1 } }));
        await page.route('**/config/toggles?*', route => route.fulfill(response === 'empty'
            ? { status: 200, body: '' } : { status: 503, body: '' }));
        await page.goto('/feed/compose');
        const notice = page.getByRole('dialog', { name: 'Profile features' });
        await expect(notice).toBeVisible();
        await expect(notice.getByRole('progressbar')).toHaveAttribute('value', '1');
        await expect(notice.getByRole('progressbar')).toHaveAttribute('max', '3');
        await expect(notice.getByRole('button', { name: 'Learn how to level up' })).toBeVisible();
        await expect(page.getByRole('alert')).toHaveCount(0);
        await page.screenshot({ path: `test-results/feed-posting-config-${response}.png` });
    });
}

test('compact feed persists and images open in the same-page fullscreen viewer', async ({ page }) => {
    await setup(page);
    await page.goto('/feed');
    const image = page.getByRole('button', { name: 'Open image', exact: true });
    await expect(image).toBeVisible();
    await expect(image.locator('img')).toHaveJSProperty('complete', true);
    const regularHeight = (await page.locator('article').first().boundingBox())!.height;
    await expect(page.getByRole('button', { name: 'Compact mode', exact: true })).toHaveCount(0);
    await page.goto('/settings');
    const compactSetting = page.getByRole('checkbox', { name: 'Compact mode', exact: true });
    await compactSetting.focus();
    await page.keyboard.press('Space');
    await expect(compactSetting).toBeChecked();
    await page.goto('/feed');
    await expect(image).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-compact', 'true');
    expect((await page.locator('article').first().boundingBox())!.height).toBeLessThan(regularHeight - 80);
    await image.click();
    const viewer = page.getByRole('dialog');
    await expect(viewer).toBeVisible();
    await expect(viewer.locator('img')).toHaveAttribute('src', 'https://images.example.com/feed-art.jpg');
    expect(await page.locator('body').evaluate(element => element.style.overflow)).toBe('hidden');
    await page.keyboard.press('Escape');
    await expect(viewer).toHaveCount(0);
    await expect(image).toBeFocused();
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-compact', 'true');
    await page.getByRole('link', { name: 'Read post', exact: true }).click();
    await page.getByRole('button', { name: 'Open image', exact: true }).click();
    await expect(viewer).toBeVisible();
    await page.screenshot({ path: 'test-results/feed-image-viewer-desktop.png' });
    await viewer.click({ position: { x: 100, y: 120 } });
    await expect(viewer).toHaveCount(0);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: 'Open image', exact: true }).click();
    await expect(viewer).toBeVisible();
    const bounds = (await viewer.locator('img').boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(844);
    await page.screenshot({ path: 'test-results/feed-image-viewer-mobile.png' });
    await viewer.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(viewer).toHaveCount(0);
});

test('recovers from a feed error and searches posts and channels', async ({ page }) => {
    await setup(page, { failOnce: true });
    await page.goto('/feed');
    await expect(page.getByRole('alert')).toContainText('Could not load posts.');
    await page.getByRole('button', { name: /Retry|Try again/i }).click();
    await expect(page.getByRole('heading', { name: 'A new season begins' })).toBeVisible();
    await page.getByRole('searchbox', { name: 'Search posts, channels and blogs' }).fill('studio');
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(page).toHaveURL(/\/feed\?q=studio$/);
    await expect(page.getByRole('heading', { name: 'Channels', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'A new season begins' })).toBeVisible();
});

test('handles empty and populated subscription feeds', async ({ page }) => {
    const requests = await setup(page);
    await page.goto('/feed?tab=my');
    await expect(page.getByText('Your feed has no posts yet. Explore the recommended channels below.')).toBeVisible();
    await expect(page.getByRole('link', { name: /Anime journal/ })).toBeVisible();
    expect(requests.some(request => request.path === '/feed/all/0')).toBe(false);
});

test('loads posts for an account with subscriptions', async ({ page }) => {
    const requests = await setup(page, { subscriptions: 2 });
    await page.goto('/feed?tab=my');
    await expect(page.getByRole('heading', { name: 'A new season begins' })).toBeVisible();
    expect(requests.some(request => request.path === '/feed/all/0')).toBe(true);
});

test('returns to the same paginated feed and scroll position after reading a post', async ({ page }) => {
    const requests = await setup(page);
    await page.route('https://api-s.anixsekai.com/article/42*', route => route.fulfill({ json: { code: 0, article: { ...feedArticle, id: 42 } } }));
    await page.goto('/feed');
    await page.getByRole('button', { name: 'Load more', exact: true }).click();
    const read = page.getByRole('link', { name: 'Read post', exact: true }).nth(1);
    await read.scrollIntoViewIfNeeded();
    const savedY = await page.evaluate(() => window.scrollY);
    expect(savedY).toBeGreaterThan(100);
    await read.click();
    await expect(page).toHaveURL(/\/feed\/post\/42$/);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
    await page.getByRole('link', { name: 'Back to feed', exact: true }).click();
    await expect(page).toHaveURL(/\/feed$/);
    await expect(page.getByRole('link', { name: 'Read post', exact: true })).toHaveCount(2);
    await expect.poll(() => page.evaluate(y => Math.abs(window.scrollY - y), savedY)).toBeLessThan(5);
    expect(requests.filter(request => request.path === '/feed/latest/all/0')).toHaveLength(1);
});

test('keeps personal filters and selected navigation while searching and returning from posts', async ({ page }) => {
    await setup(page, { subscriptions: 2 });
    await page.goto('/feed?tab=my&date=2');
    await page.getByRole('searchbox', { name: 'Search posts, channels and blogs' }).fill('studio');
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(page).toHaveURL(/tab=my&date=2&q=studio$/);
    await expect(page.getByRole('navigation', { name: 'Feed', exact: true }).getByRole('link', { name: 'My feed', exact: true })).toHaveAttribute('aria-current', 'page');
    await page.getByRole('link', { name: 'Read post', exact: true }).click();
    await page.getByRole('link', { name: 'Back to feed', exact: true }).click();
    await expect(page).toHaveURL(/tab=my&date=2&q=studio$/);
    await expect(page.getByRole('heading', { name: 'Channels', exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'Clear search', exact: true }).click();
    await expect(page).toHaveURL(/tab=my&date=2$/);
    await expect(page.getByRole('combobox', { name: 'Period', exact: true })).toHaveValue('2');
});

test('returns from a post to its channel and then to the original feed', async ({ page }) => {
    await setup(page);
    await page.goto('/feed?tab=my');
    await page.getByRole('link', { name: /Anime journal/ }).click();
    await page.getByRole('link', { name: 'Read post', exact: true }).click();
    await expect(page.getByRole('link', { name: 'Back to channel', exact: true })).toHaveAttribute('href', '/feed/channel/7');
    await page.getByRole('link', { name: 'Comments: 1', exact: true }).click();
    await expect(page).toHaveURL(/\/feed\/post\/41#comments$/);
    await expect(page.getByRole('link', { name: 'Back to channel', exact: true })).toHaveAttribute('href', '/feed/channel/7');
    await page.getByRole('link', { name: 'Back to channel', exact: true }).click();
    await expect(page).toHaveURL(/\/feed\/channel\/7$/);
    await page.getByRole('link', { name: 'Back to feed', exact: true }).click();
    await expect(page).toHaveURL(/\/feed\?tab=my$/);
});

test('keeps channels in the feed navigation and removes directory tabs from creation', async ({ page }) => {
    await setup(page);
    await page.goto('/feed');
    await page.getByRole('navigation', { name: 'Feed', exact: true }).getByRole('link', { name: 'Channels', exact: true }).click();
    await expect(page).toHaveURL(/\/feed\/studio\?tab=managed$/);
    await expect(page.getByRole('navigation', { name: 'Channels and blogs', exact: true }).getByRole('link', { name: 'My channels', exact: true })).toHaveAttribute('aria-current', 'page');
    await page.screenshot({ path: 'test-results/feed-navigation-channels.png', fullPage: true, animations: 'disabled' });
    await page.getByRole('link', { name: 'Create channel', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Create channel', exact: true })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Channels and blogs', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Create my blog', exact: true })).toHaveCount(0);
    await page.screenshot({ path: 'test-results/feed-navigation-create.png', fullPage: true, animations: 'disabled' });
    await page.getByRole('link', { name: 'Back to channels', exact: true }).click();
    await expect(page).toHaveURL(/\/feed\/studio\?tab=managed$/);
    await page.goBack();
    await expect(page).toHaveURL(/\/feed$/);
});

test('uses feed search from the global header and returns to the originating channel', async ({ page }) => {
    const requests = await setup(page);
    await page.goto('/feed/channel/7');
    await page.getByRole('button', { name: 'Search posts, channels and blogs', exact: true }).click();
    await expect(page).toHaveURL(/\/feed\?search=1$/);
    await expect(page.getByRole('searchbox', { name: 'Search posts, channels and blogs' })).toBeFocused();
    await page.getByRole('searchbox', { name: 'Search posts, channels and blogs' }).fill('studio');
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Channels', exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'Back to channel', exact: true }).click();
    await expect(page).toHaveURL(/\/feed\/channel\/7$/);
    expect(requests.some(request => request.path.startsWith('/search/release/'))).toBe(false);
});

test('returns to the previous personal feed filters when switching primary tabs', async ({ page }) => {
    await setup(page, { subscriptions: 2 });
    await page.goto('/feed?tab=my&date=2');
    const nav = page.getByRole('navigation', { name: 'Feed', exact: true });
    await nav.getByRole('link', { name: 'Latest', exact: true }).click();
    await expect(page).toHaveURL(/\/feed$/);
    await nav.getByRole('link', { name: 'My feed', exact: true }).click();
    await expect(page).toHaveURL(/tab=my&date=2$/);
    await expect(page.getByRole('combobox', { name: 'Period', exact: true })).toHaveValue('2');
});

test('replaces the composer after publishing so Back returns to reading', async ({ page }) => {
    await setup(page);
    await page.route('https://api-s.anixsekai.com/channel/editor/available/all*', route => route.fulfill({ json: { code: 0, channels: [feedChannel] } }));
    await page.route('https://api-s.anixsekai.com/channel/7/editor/available*', route => route.fulfill({ json: { code: 0 } }));
    await page.route('https://api-s.anixsekai.com/article/create/7*', route => route.fulfill({ json: { code: 0, article: feedArticle } }));
    await page.goto('/feed');
    await page.getByRole('link', { name: 'Write a post', exact: true }).click();
    await page.getByRole('textbox', { name: 'Text', exact: true }).fill('Navigation check');
    await page.getByRole('button', { name: 'Publish', exact: true }).click();
    await expect(page).toHaveURL(/\/feed\/post\/41$/);
    await page.getByRole('link', { name: 'Back to feed', exact: true }).click();
    await expect(page).toHaveURL(/\/feed$/);
    await page.goForward();
    await expect(page).toHaveURL(/\/feed\/post\/41$/);
});

test('keeps the unsaved post when returning from feed search', async ({ page }) => {
    await setup(page);
    await page.route('https://api-s.anixsekai.com/channel/editor/available/all*', route => route.fulfill({ json: { code: 0, channels: [feedChannel] } }));
    await page.goto('/feed/compose');
    await page.getByRole('textbox', { name: 'Text', exact: true }).fill('Keep my unsaved post');
    await page.getByRole('checkbox', { name: 'Show my name as author', exact: true }).uncheck();
    await page.getByRole('button', { name: 'Search posts, channels and blogs', exact: true }).click();
    await expect(page).toHaveURL(/\/feed\?search=1$/);
    await page.getByRole('link', { name: 'Back to editor', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Text', exact: true })).toHaveValue('Keep my unsaved post');
    await expect(page.getByRole('checkbox', { name: 'Show my name as author', exact: true })).not.toBeChecked();
});

test('ignores an old search response after navigating to another query', async ({ page }) => {
    await setup(page);
    let releaseOld: (() => void) | undefined;
    const oldPending = new Promise<void>(resolve => { releaseOld = resolve; });
    let oldStarted: (() => void) | undefined;
    const started = new Promise<void>(resolve => { oldStarted = resolve; });
    await page.route('https://api-s.anixsekai.com/search/feed/0*', async route => {
        const query = route.request().postDataJSON().query as string;
        if (query === 'old') { oldStarted?.(); await oldPending; }
        await route.fulfill({ json: { code: 0, channels: feedPage([]), blogs: feedPage([]), articles: feedPage([{
            ...feedArticle, payload: { blocks: [{ type: 'header', data: { text: `${query} search result` } }] },
        }]) } }).catch(() => {});
    });
    await page.goto('/feed?q=old');
    await started;
    await page.getByRole('searchbox', { name: 'Search posts, channels and blogs' }).fill('new');
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'new search result' })).toBeVisible();
    releaseOld?.();
    await expect(page.getByRole('heading', { name: 'old search result' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'new search result' })).toBeVisible();
});

test('requires authentication and rejects invalid post IDs without requests', async ({ page }) => {
    const requests = await setup(page, { loggedIn: false });
    await page.goto('/feed');
    await expect(page.getByRole('link', { name: 'Sign in', exact: true })).toBeVisible();
    expect(requests).toHaveLength(0);
    await page.goto('/feed/post/not-an-id');
    await expect(page.getByRole('alert')).toContainText('This post or channel is unavailable.');
    expect(requests).toHaveLength(0);
});

test('subscribes and mutes channels and recovers from a failed vote without optimistic drift', async ({ page }) => {
    await setup(page);
    const writes: string[] = [];
    let fail = true;
    await page.route('https://api-s.anixsekai.com/**', async route => {
        const path = new URL(route.request().url()).pathname;
        if (/^\/channel\/(subscribe|unsubscribe|mute|unmute)\/7$/.test(path)) {
            expect(route.request().method()).toBe('POST'); writes.push(path);
            return route.fulfill({ json: { code: 0 } });
        }
        if (path === '/article/vote/41/1') {
            writes.push(path);
            if (fail) { fail = false; return route.fulfill({ json: { code: 403 } }); }
            return route.fulfill({ json: { code: 0 } });
        }
        return route.fallback();
    });
    await page.goto('/feed/channel/7');
    await page.getByRole('button', { name: 'Subscribe', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Unsubscribe', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Hide from feed', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Show in feed', exact: true })).toBeVisible();
    const like = page.getByRole('button', { name: 'Like', exact: true });
    await like.click();
    await expect(page.getByRole('alert')).toContainText('Could not save.');
    await expect(like).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByRole('status', { name: 'Score: 12', exact: true })).toBeVisible();
    await like.click();
    await expect(like).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('status', { name: 'Score: 13', exact: true })).toBeVisible();
    await like.click();
    await expect(page.getByRole('status', { name: 'Score: 12', exact: true })).toBeVisible();
    expect(writes.filter(path => path === '/article/vote/41/1')).toHaveLength(3);
});

test('posts spoiler comments and replies with native reply metadata', async ({ page }) => {
    await setup(page);
    let added: typeof feedComment | undefined;
    const bodies: unknown[] = [];
    await page.route('https://api-s.anixsekai.com/article/comment/**', async route => {
        const path = new URL(route.request().url()).pathname;
        if (path === '/article/comment/add/41') {
            const body = route.request().postDataJSON(); bodies.push(body);
            added = { ...feedComment, id: 88, message: body.message, is_spoiler: body.spoiler, reply_count: 0 };
            return route.fulfill({ json: { code: 0, comment: added } });
        }
        if (path === '/article/comment/all/41/0') return route.fulfill({ json: feedPage([feedComment, ...(added ? [added] : [])]) });
        return route.fallback();
    });
    await page.goto('/feed/post/41');
    await page.getByRole('textbox', { name: 'Write a comment', exact: true }).fill('A hidden review');
    await page.getByRole('checkbox', { name: 'Contains spoilers', exact: true }).check();
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.getByText('A hidden review', { exact: true })).not.toBeVisible();
    await page.getByText('Show spoiler', { exact: true }).click();
    await expect(page.getByText('A hidden review', { exact: true })).toBeVisible();
    expect(bodies[0]).toEqual({ message: 'A hidden review', spoiler: true, parentCommentId: null, replyToProfileId: null });
    await page.getByRole('button', { name: 'Reply', exact: true }).first().click();
    await page.getByRole('textbox', { name: 'Reply', exact: true }).fill('A threaded reply');
    await page.getByRole('button', { name: 'Send', exact: true }).last().click();
    await expect.poll(() => bodies.length).toBe(2);
    expect(bodies[1]).toEqual({ message: 'A threaded reply', spoiler: false, parentCommentId: 81, replyToProfileId: 19 });
});

test('publishes and edits posts only after availability succeeds, preserving unknown editor blocks', async ({ page }) => {
    await setup(page);
    const saved: { path: string; body: Record<string, unknown> }[] = [];
    const original = { ...feedArticle, channel: { ...feedChannel, is_creator: true }, is_signed: false,
        payload: { blocks: [{ id: 'custom', type: 'quote', data: { text: 'Keep this quotation', caption: 'Source' } }, { id: 'paragraph', type: 'paragraph', data: { text: 'Original text' } }] } };
    await page.route('https://api-s.anixsekai.com/**', async route => {
        const path = new URL(route.request().url()).pathname;
        if (path === '/channel/editor/available/all') return route.fulfill({ json: { code: 0, channels: [feedChannel] } });
        if (path === '/article/41') return route.fulfill({ json: { code: 0, article: original } });
        if (path === '/channel/7/editor/available') return route.fulfill({ json: { code: 0 } });
        if (path === '/article/create/7' || path === '/article/edit/41') {
            saved.push({ path, body: route.request().postDataJSON() });
            return route.fulfill({ json: { code: 0, article: feedArticle } });
        }
        return route.fallback();
    });
    await page.goto('/feed/compose?channel=7');
    await page.getByRole('textbox', { name: 'Text', exact: true }).fill('My first feed post');
    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    await expect(page.getByLabel('Preview', { exact: true })).toContainText('My first feed post');
    expect(saved).toHaveLength(0);
    await page.getByRole('button', { name: 'Publish', exact: true }).click();
    await expect(page).toHaveURL(/\/feed\/post\/41$/);
    expect(saved[0].body).toMatchObject({ is_signed: true, repost_article_id: null, payload: { blocks: [{ type: 'paragraph', data: { text: 'My first feed post' } }] } });
    await page.goto('/feed/compose?edit=41');
    await expect(page.getByRole('checkbox', { name: 'Show my name as author' })).not.toBeChecked();
    await page.getByRole('textbox', { name: 'Text', exact: true }).fill('Edited text');
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect.poll(() => saved.length).toBe(2);
    expect(saved[1]).toMatchObject({ path: '/article/edit/41', body: { is_signed: false, payload: { blocks: [{ type: 'quote', data: { text: 'Keep this quotation', caption: 'Source' } }, { type: 'paragraph', data: { text: 'Edited text' } }] } } });
});

test('channel creation preserves form data on API rejection and creates a channel on retry', async ({ page }) => {
    await setup(page);
    let fail = true;
    let body: unknown;
    await page.route('https://api-s.anixsekai.com/channel/create*', route => {
        body = route.request().postDataJSON();
        if (fail) { fail = false; return route.fulfill({ json: { code: 403 } }); }
        return route.fulfill({ json: { code: 0, channel: feedChannel } });
    });
    await page.goto('/feed/studio?create=1');
    await page.getByRole('textbox', { name: 'Channel name', exact: true }).fill('Anime journal');
    await page.getByRole('textbox', { name: 'Description', exact: true }).fill('News');
    await page.getByRole('button', { name: 'Create channel', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Could not save.');
    await expect(page.getByRole('textbox', { name: 'Channel name', exact: true })).toHaveValue('Anime journal');
    await page.getByRole('button', { name: 'Create channel', exact: true }).click();
    await expect(page).toHaveURL(/\/feed\/channel\/7$/);
    expect(body).toEqual({ title: 'Anime journal', description: 'News', is_commenting_enabled: true, is_article_suggestion_enabled: false, is_episode_channel_widget_enabled: false, episode_channel_widget_sort: 0, episode_channel_widget_popularity_period: 0, episode_channel_widget_article_count: 2 });
});

test('edits and deletes owned comments with confirmation, and reports a post', async ({ page }) => {
    await setup(page);
    let message = 'My original comment', removed = false;
    const actions: string[] = [];
    await page.route('https://api-s.anixsekai.com/**', async route => {
        const path = new URL(route.request().url()).pathname;
        if (path === '/article/comment/all/41/0') return route.fulfill({ json: feedPage(removed ? [] : [{ ...feedComment, profile: { id: 1, login: 'Me' }, message }]) });
        if (path === '/article/comment/edit/81') { message = route.request().postDataJSON().message; actions.push(path); return route.fulfill({ json: { code: 0 } }); }
        if (path === '/article/comment/delete/81') { removed = true; actions.push(path); return route.fulfill({ json: { code: 0 } }); }
        if (path === '/report/article/reasons') return route.fulfill({ json: [{ id: 1, name: 'Spam' }] });
        if (path === '/report/article') {
            expect(route.request().postDataJSON()).toEqual({ entity_id: 41, reason: 1, message: 'Unwanted advertising' });
            return route.fulfill({ json: { code: 0 } });
        }
        return route.fallback();
    });
    await page.goto('/feed/post/41');
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await page.getByRole('textbox', { name: 'Edit comment', exact: true }).fill('My revised comment');
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(page.getByText('My revised comment', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Delete comment?' })).toBeVisible();
    expect(removed).toBe(false);
    await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(page.getByText('No comments yet.', { exact: true })).toBeVisible();
    expect(actions).toEqual(['/article/comment/edit/81', '/article/comment/delete/81']);
    await page.getByRole('button', { name: 'Report', exact: true }).click();
    await page.getByRole('combobox', { name: 'Reason', exact: true }).selectOption('1');
    await page.getByRole('dialog').getByRole('textbox', { name: 'Text', exact: true }).fill('Unwanted advertising');
    await page.getByRole('dialog').getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.getByText('Report sent.', { exact: true })).toBeVisible();
});

test('reviews suggested posts and uses the native publish endpoint', async ({ page }) => {
    await setup(page);
    let published = false;
    await page.route('https://api-s.anixsekai.com/**', async route => {
        const path = new URL(route.request().url()).pathname;
        if (path === '/channel/editor/available/all') return route.fulfill({ json: { code: 0, channels: [feedChannel] } });
        if (path === '/article/suggestion/all/0') {
            expect(route.request().postDataJSON()).toEqual({ channel_id: 7 });
            return route.fulfill({ json: feedPage(published ? [] : [feedArticle]) });
        }
        if (path === '/article/suggestion/publish/41') { published = true; expect(route.request().method()).toBe('POST'); return route.fulfill({ json: { code: 0 } }); }
        return route.fallback();
    });
    await page.goto('/feed/studio?tab=suggestions');
    await expect(page.getByRole('heading', { name: 'A new season begins' })).toBeVisible();
    expect(published).toBe(false);
    await page.getByRole('button', { name: 'Publish', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'A new season begins' })).toHaveCount(0);
    expect(published).toBe(true);
});

test('respects disabled comments and rejects invalid editor routes before making feed requests', async ({ page }) => {
    const requests = await setup(page);
    await page.route('https://api-s.anixsekai.com/article/41*', route => route.fulfill({ json: { code: 0, article: { ...feedArticle, channel: { ...feedChannel, is_commenting_enabled: false } } } }));
    await page.goto('/feed/post/41');
    await expect(page.getByText('Comments are disabled for this channel.')).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Write a comment', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Reply', exact: true })).toHaveCount(0);
    requests.length = 0;
    await page.goto('/feed/compose?edit=invalid');
    await expect(page.getByRole('alert')).toContainText('This post or channel is unavailable.');
    expect(requests).toHaveLength(0);
});

test('paginates channel search independently and opens hashtag searches', async ({ page }) => {
    await setup(page);
    await page.route('https://api-s.anixsekai.com/search/**', route => {
        const path = new URL(route.request().url()).pathname;
        if (path === '/search/feed/0') return route.fulfill({ json: { code: 0, articles: feedPage([]), channels: feedPage([feedChannel], 2), blogs: feedPage([]), tags: feedPage(['anime']) } });
        if (path === '/search/channels/1') {
            expect(route.request().postDataJSON()).toEqual({ query: 'studio', searchBy: 0, is_blog: false, is_subscribed: null });
            return route.fulfill({ json: feedPage([{ ...feedChannel, id: 8, title: 'Another studio' }], 2) });
        }
        return route.fallback();
    });
    await page.goto('/feed?q=studio');
    await page.getByRole('region', { name: 'Channels', exact: true }).getByRole('button', { name: 'Load more', exact: true }).click();
    await expect(page.getByRole('link', { name: /Another studio/ })).toBeVisible();
    await page.getByRole('link', { name: '#anime', exact: true }).click();
    await expect(page).toHaveURL(/\/feed\?q=%23anime$/);
});

test('pins and deletes owned posts through a confirmation dialog', async ({ page }) => {
    await setup(page);
    let deleted = false;
    await page.route('https://api-s.anixsekai.com/**', route => {
        const url = new URL(route.request().url());
        if (url.pathname === '/article/41') return route.fulfill({ json: { code: 0, article: { ...feedArticle, channel: { ...feedChannel, is_creator: true } } } });
        if (url.pathname === '/article/edit/pinned/41') { expect(url.searchParams.get('is_pinned')).toBe('true'); return route.fulfill({ json: { code: 0 } }); }
        if (url.pathname === '/article/delete/41') { expect(route.request().method()).toBe('POST'); deleted = true; return route.fulfill({ json: { code: 0 } }); }
        return route.fallback();
    });
    await page.goto('/feed/post/41');
    await page.getByRole('button', { name: 'Pin post', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Unpin post', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Delete post?' })).toBeVisible();
    expect(deleted).toBe(false);
    await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(page).toHaveURL(/\/feed\/channel\/7$/);
    expect(deleted).toBe(true);
});

for (const theme of ['dark', 'light'] as const) {
    test(`feed is usable at 390px in ${theme} theme and retries failed media`, async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await setup(page, { theme });
        let failed = false;
        await page.route('https://images.example.com/feed-art.jpg', route => {
            if (!failed) { failed = true; return route.fulfill({ status: 503 }); }
            return route.fulfill({ contentType: 'image/jpeg', body: artwork });
        });
        await page.goto('/feed');
        await expect(page.getByText('Could not load the image.')).toBeVisible();
        await page.getByRole('button', { name: 'Retry image', exact: true }).click();
        await expect(page.getByRole('img', { name: 'Post image' })).toBeVisible();
        await expect.poll(() => page.getByRole('img', { name: 'Post image' }).evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(1);
        expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
        await page.screenshot({ path: `test-results/feed-mobile-${theme}.png`, fullPage: true });
        await page.setViewportSize({ width: 1440, height: 1000 });
        await page.screenshot({ path: `test-results/feed-desktop-${theme}.png`, fullPage: true, animations: 'disabled' });
        await page.setViewportSize({ width: 390, height: 844 });
        await page.route('https://api-s.anixsekai.com/channel/editor/available/all*', route => route.fulfill({ json: { code: 0, channels: [feedChannel] } }));
        await page.goto('/feed/compose');
        await page.getByRole('textbox', { name: 'Text', exact: true }).fill('A new episode\nA second line');
        await expect(page.getByRole('textbox', { name: 'Text', exact: true })).toHaveValue('A new episode\nA second line');
        expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
        await page.screenshot({ path: `test-results/feed-editor-mobile-${theme}.png`, fullPage: true });
        await page.evaluate(() => {
            const settings = JSON.parse(localStorage.getItem('app_settings') ?? '{}');
            settings.appearance.language = 'russian';
            localStorage.setItem('app_settings', JSON.stringify(settings));
        });
        await page.goto('/feed');
        await expect(page.getByRole('heading', { name: 'Лента', exact: true })).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
        await page.screenshot({ path: `test-results/feed-mobile-ru-${theme}.png`, fullPage: true, animations: 'disabled' });
        await page.goto('/feed/compose');
        await expect(page.getByRole('heading', { name: 'Написать запись', exact: true })).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
        await page.screenshot({ path: `test-results/feed-editor-mobile-ru-${theme}.png`, fullPage: true, animations: 'disabled' });
    });
}
