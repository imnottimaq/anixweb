import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { setupDeterministicNetwork } from './helpers/network';
import { seedStorageState } from './helpers/auth';
import { defaultAppSettings } from '../../src/shared/types/settings';
import { feedArticle, feedChannel, feedPage } from '../fixtures/feed';

const file = { name: 'photo.jpg', mimeType: 'image/jpeg', buffer: readFileSync('tests/fixtures/images/jjk_poster.jpg') };
async function setup(page: Page, options: { creator?: boolean; administrator?: boolean; theme?: 'light' | 'dark' } = {}) {
    await setupDeterministicNetwork(page, { isLoggedIn: true });
    await seedStorageState(page, { isLoggedIn: true, onboarded: true, settings: { ...defaultAppSettings, appearance: { ...defaultAppSettings.appearance, language: 'english', theme: options.theme ?? 'dark' } } });
    const channel = { ...feedChannel, cover: 'https://images.example.com/cover.jpg', is_creator: options.creator ?? true, is_administrator_or_higher: options.administrator ?? true, is_episode_channel_widget_enabled: true, episode_channel_widget_sort: 1, episode_channel_widget_popularity_period: 2, episode_channel_widget_article_count: 4 };
    await page.route('https://api-s.anixsekai.com/**', route => {
        const url = new URL(route.request().url());
        expect(url.searchParams.get('token')).toBe('test-auth-token-123');
        if (url.pathname === '/channel/7') return route.fulfill({ json: { code: 0, channel } });
        if (url.pathname === '/channel/editor/available/all') return route.fulfill({ json: { code: 0, channels: [channel] } });
        if (url.pathname === '/channel/7/editor/available') return route.fulfill({ json: { code: 0, media_upload_token: 'editor-token' } });
        if (url.pathname === '/article/create/7') return route.fulfill({ json: { code: 0, article: feedArticle } });
        if (url.pathname === '/article/41') return route.fulfill({ json: { code: 0, article: feedArticle } });
        if (/\/subscribers\/\d+$|\/permission\/all\/\d+$|\/block\/all\/\d+$/.test(url.pathname)) return route.fulfill({ json: feedPage([{ id: 9, login: 'Member Nine', permission: 0 }]) });
        return route.fallback();
    });
    return channel;
}

test('uploads device images with the media token and publishes their unchanged metadata', async ({ page }) => {
    await setup(page);
    let payload: { payload: { blocks: { type: string; data: { items?: unknown[] } }[] } } | undefined;
    await page.route('https://editor.anixsekai.com/content/upload', route => {
        expect(route.request().headers().authorization).toBe('Bearer editor-token');
        expect(route.request().url()).not.toContain('token=');
        expect(route.request().postDataBuffer()?.toString()).toContain('name="file"');
        return route.fulfill({ json: { success: 1, file: { url: 'https://images.example.com/upload.png', hash: 'native-image-hash', width: 640, height: 360 } } });
    });
    await page.route('https://api-s.anixsekai.com/article/create/7*', route => { payload = route.request().postDataJSON(); return route.fulfill({ json: { code: 0, article: feedArticle } }); });
    await page.goto('/feed/compose?channel=7');
    await page.getByLabel('Upload images', { exact: true }).setInputFiles(file);
    await expect(page.getByLabel('Image URLs (one per line)')).toHaveValue('https://images.example.com/upload.png');
    await page.getByRole('button', { name: 'Publish', exact: true }).click();
    await expect(page).toHaveURL(/\/feed\/post\/41$/);
    expect(payload?.payload.blocks.find(block => block.type === 'media')?.data.items).toEqual([{ url: 'https://images.example.com/upload.png', hash: 'native-image-hash', width: 640, height: 360 }]);
});

test('preserves drafts and completed images when a later upload fails, then permits retry', async ({ page }) => {
    await setup(page);
    let count = 0;
    await page.route('https://editor.anixsekai.com/content/upload', route => ++count === 2 ? route.fulfill({ status: 503 }) : route.fulfill({ json: { success: 1, file: { url: `https://images.example.com/upload-${count}.png`, hash: `hash-${count}` } } }));
    await page.goto('/feed/compose?channel=7');
    await page.getByRole('textbox', { name: 'Text', exact: true }).fill('Keep this draft');
    await page.getByLabel('Upload images', { exact: true }).setInputFiles([file, { ...file, name: 'second.jpg' }]);
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Text', exact: true })).toHaveValue('Keep this draft');
    await expect(page.getByLabel('Image URLs (one per line)')).toHaveValue('https://images.example.com/upload-1.png');
    await page.getByLabel('Upload images', { exact: true }).setInputFiles({ ...file, name: 'retry.jpg' });
    await expect(page.getByLabel('Image URLs (one per line)').nth(1)).toHaveValue('https://images.example.com/upload-3.png');
    await expect(page.getByRole('alert')).toHaveCount(0);
});

test('resolves native embed metadata and edits quotes and lists before publishing', async ({ page }) => {
    await setup(page);
    let submitted: { payload: { blocks: { type: string; data: Record<string, unknown> }[] } } | undefined;
    await page.route('https://editor.anixsekai.com/embed/link*', route => {
        expect(new URL(route.request().url()).searchParams.get('url')).toBe('https://example.com/article');
        expect(route.request().headers().authorization).toBe('Bearer editor-token');
        return route.fulfill({ json: { success: 1, title: 'Link title', hash: 'embed-hash', description: 'Link description' } });
    });
    await page.route('https://api-s.anixsekai.com/article/create/7*', route => { submitted = route.request().postDataJSON(); return route.fulfill({ json: { code: 0, article: feedArticle } }); });
    await page.goto('/feed/compose?channel=7');
    await page.getByRole('button', { name: 'Add quote', exact: true }).click();
    await page.getByRole('textbox', { name: 'Quote', exact: true }).fill('A quotation');
    await page.getByRole('button', { name: 'Add list', exact: true }).click();
    await page.getByRole('textbox', { name: 'List items (one per line)', exact: true }).fill('First\nSecond');
    await page.getByRole('checkbox', { name: 'Numbered list' }).check();
    await page.getByRole('button', { name: 'Add link', exact: true }).click();
    await page.getByRole('textbox', { name: 'Link', exact: true }).fill('https://example.com/article');
    await page.getByRole('button', { name: 'Publish', exact: true }).click();
    await expect(page).toHaveURL(/\/feed\/post\/41$/);
    expect(submitted?.payload.blocks).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'quote', data: expect.objectContaining({ text: 'A quotation' }) }),
        expect.objectContaining({ type: 'list', data: { items: ['First', 'Second'], style: 'ordered' } }),
        expect.objectContaining({ type: 'embed', data: expect.objectContaining({ hash: 'embed-hash', service: 'link', url: 'https://example.com/article' }) }),
    ]));
});

test('preserves disabled widget settings while editing other channel fields', async ({ page }) => {
    await setup(page);
    let saved: unknown;
    await page.route('https://api-s.anixsekai.com/channel/edit/7*', route => { saved = route.request().postDataJSON(); return route.fulfill({ json: { code: 0, channel: feedChannel } }); });
    await page.goto('/feed/studio?edit=7');
    await page.getByRole('checkbox', { name: 'Show channel posts', exact: true }).uncheck();
    await page.getByRole('textbox', { name: 'Channel name', exact: true }).fill('Updated journal');
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(page).toHaveURL(/\/feed\/channel\/7$/);
    expect(saved).toMatchObject({ title: 'Updated journal', is_episode_channel_widget_enabled: false, episode_channel_widget_sort: 1, episode_channel_widget_popularity_period: 2, episode_channel_widget_article_count: 4 });
});

test('confirms role changes and blocks, then reloads member lists', async ({ page }) => {
    await setup(page);
    let permission = 0, blocked = false;
    const writes: { path: string; body: Record<string, unknown> }[] = [];
    await page.route('https://api-s.anixsekai.com/**', route => {
        const path = new URL(route.request().url()).pathname;
        if (/\/subscribers\/0$|\/permission\/all\/0$|\/block\/all\/0$/.test(path)) return route.fulfill({ json: feedPage(blocked || !path.includes('/block/') ? [{ id: 9, login: 'Member Nine', permission, is_blocked: blocked }] : []) });
        if (path.endsWith('/permission/manage') || path.endsWith('/block/manage')) {
            const body = route.request().postDataJSON(); writes.push({ path, body });
            if (path.endsWith('/permission/manage')) permission = body.permission ?? 0;
            else blocked = body.is_blocked;
            return route.fulfill({ json: { code: 0 } });
        }
        return route.fallback();
    });
    await page.goto('/feed/studio?edit=7');
    await page.getByRole('button', { name: 'Make administrator', exact: true }).click();
    expect(writes).toHaveLength(0);
    await page.getByRole('dialog').getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Remove administrator', exact: true })).toBeVisible();
    expect(writes[0].body).toEqual({ target_profile_id: 9, permission: 1 });
    await page.getByRole('button', { name: 'Block member', exact: true }).click();
    await page.getByRole('dialog').getByRole('textbox', { name: 'Reason', exact: true }).fill('Spam');
    await page.getByRole('checkbox', { name: 'Show reason to member', exact: true }).check();
    await page.getByRole('dialog').getByRole('button', { name: 'Block member', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Unblock member', exact: true })).toBeVisible();
    expect(writes[1].body).toMatchObject({ target_profile_id: 9, is_blocked: true, is_perm_blocked: true, expire_date: null, reason: 'Spam', is_reason_showing_enabled: true });
    await page.getByRole('button', { name: 'Blocked', exact: true }).click();
    await page.getByRole('button', { name: 'Unblock member', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(page.getByText('Member Nine', { exact: true })).toHaveCount(0);
    expect(writes[2].body).toMatchObject({ is_blocked: false, is_perm_blocked: false, expire_date: null });
});

test('lets administrators moderate members but reserves role assignment for channel owners', async ({ page }) => {
    await setup(page, { creator: false, administrator: true });
    await page.goto('/feed/studio?edit=7');
    await expect(page.getByText('Member Nine', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Make administrator', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Block member', exact: true })).toBeVisible();
});

test('opens paginated reaction and repost lists using native methods', async ({ page }) => {
    await setup(page);
    await page.route('https://api-s.anixsekai.com/article/votes/41/*', route => {
        expect(route.request().method()).toBe('POST');
        const url = new URL(route.request().url());
        return route.fulfill({ json: feedPage(url.searchParams.get('sort') === '2' ? [] : [{ id: 9, login: 'Member Nine' }]) });
    });
    await page.route('https://api-s.anixsekai.com/article/reposts/41/*', route => {
        expect(route.request().method()).toBe('GET');
        expect(new URL(route.request().url()).searchParams.get('sort')).toBe('1');
        return route.fulfill({ json: feedPage([{ ...feedArticle, id: 42 }]) });
    });
    await page.goto('/feed/post/41');
    await page.getByRole('button', { name: 'Who reacted', exact: true }).click();
    await expect(page.getByRole('dialog').getByRole('link', { name: 'Member Nine' })).toHaveAttribute('href', '/account/9');
    await page.getByRole('combobox', { name: 'Reaction type', exact: true }).selectOption('2');
    await expect(page.getByRole('dialog').getByText('Member Nine')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByRole('button', { name: 'View reposts', exact: true }).click();
    await expect(page.getByRole('dialog').getByRole('link', { name: 'Read post', exact: true })).toHaveAttribute('href', '/feed/post/42');
});

test('routes native feed notifications to posts and hides comment spoilers', async ({ page }) => {
    await setup(page);
    await page.route('https://api-s.anixsekai.com/notification/all/0*', route => route.fulfill({ json: feedPage([
        { type: 'article', id: 1, timestamp: 1792100000, article: { id: 41, channel: feedChannel } },
        { type: 'myArticle', id: 2, timestamp: 1792100000, article_comment: { id: 3, message: 'Secret ending', is_spoiler: true, article: { id: 41 }, profile: { id: 9, login: 'Member Nine' } } },
    ]) }));
    await page.goto('/notifications');
    await page.getByRole('combobox').selectOption('feed');
    await expect(page.getByRole('link', { name: /New post in Anime journal/ })).toHaveAttribute('href', '/feed/post/41');
    await expect(page.getByText('Secret ending')).toHaveCount(0);
    await expect(page.getByRole('link', { name: /Member Nine/ })).toHaveAttribute('href', '/feed/post/41#comments');
    await page.getByRole('link', { name: /New post in Anime journal/ }).click();
    await expect(page).toHaveURL(/\/feed\/post\/41$/);
});

test('cancels in-flight file uploads when leaving the editor', async ({ page }) => {
    await setup(page);
    let release: (() => void) | undefined;
    const pending = new Promise<void>(resolve => { release = resolve; });
    await page.route('https://editor.anixsekai.com/content/upload', async route => {
        await pending;
        await route.fulfill({ json: { success: 1, file: { url: 'https://images.example.com/stale.png' } } }).catch(() => undefined);
    });
    await page.goto('/feed/compose?channel=7');
    const requested = page.waitForRequest('https://editor.anixsekai.com/content/upload');
    await page.getByLabel('Upload images', { exact: true }).setInputFiles(file);
    const request = await requested;
    await expect(page.getByRole('button', { name: 'Publish', exact: true })).toBeDisabled();
    const aborted = page.waitForEvent('requestfailed', item => item === request);
    await page.getByRole('link', { name: 'Back to feed', exact: true }).click();
    await aborted;
    release?.();
    await expect(page).toHaveURL(/\/feed$/);
    await page.goto('/feed/compose?channel=7');
    await expect(page.getByLabel('Image URLs (one per line)')).toHaveCount(0);
});

for (const theme of ['light', 'dark'] as const) {
    test(`crops artwork and keeps channel controls aligned at 390px in ${theme} theme`, async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await setup(page, { theme });
        const writes: string[] = [];
        await page.route('https://api-s.anixsekai.com/channel/avatar/upload/7*', route => {
            writes.push('avatar');
            expect(route.request().postDataBuffer()?.toString()).toContain('name="image"');
            expect(route.request().postDataBuffer()?.toString()).toContain('filename="channel.png"');
            return route.fulfill({ json: { code: 0, url: 'https://images.example.com/new-avatar.png' } });
        });
        await page.goto('/feed/studio?edit=7');
        await expect(page.getByRole('heading', { name: 'Channel artwork' })).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.getByLabel('Avatar', { exact: true }).setInputFiles(file);
        const modal = page.getByRole('dialog', { name: 'Crop image', exact: true });
        await expect(modal.getByRole('button', { name: 'Crop and upload' })).toBeEnabled();
        await page.getByRole('slider', { name: 'Zoom', exact: true }).fill('1.5');
        await page.screenshot({ path: `test-results/feed-crop-mobile-${theme}.png`, animations: 'disabled' });
        await modal.getByRole('button', { name: 'Crop and upload', exact: true }).click();
        await expect(modal).toHaveCount(0);
        expect(writes).toEqual(['avatar']);
        await expect(page.getByRole('img', { name: 'Avatar', exact: true })).toHaveAttribute('src', 'https://images.example.com/new-avatar.png');
        await page.screenshot({ path: `test-results/feed-settings-mobile-${theme}.png`, fullPage: true });
    });
}
