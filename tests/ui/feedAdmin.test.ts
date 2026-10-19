import { afterEach, expect, it, vi } from 'vitest';
import type { useApi } from '../../src/shared/apiClient';
import { apiPostForm } from '../../src/shared/apiClient';
import { loadFeedMembers, resolveFeedEmbed, setFeedBlock, setFeedPermission, uploadFeedArtwork, uploadFeedMedia } from '../../src/shared/feedAdmin';
import { feedCrop } from '../../src/shared/feedImage';
import { saveFeedArticle, saveFeedChannel } from '../../src/shared/feed';
import { feedArticle, feedChannel, feedPage } from '../fixtures/feed';

function mock() { return { get: vi.fn().mockResolvedValue({ code: 0, media_upload_token: 'short-lived-media-token' }), post: vi.fn().mockResolvedValue({ code: 0 }), postForm: vi.fn().mockResolvedValue({ code: 0, url: 'https://images.example.com/art.png' }) } as unknown as ReturnType<typeof useApi>; }
const signal = () => new AbortController().signal;
const image = () => new File(['image bytes'], 'image.png', { type: 'image/png' });
afterEach(() => vi.unstubAllGlobals());

it('keeps member searches, permissions and blocked lists on their native endpoints', async () => {
    const api = mock(), abort = signal();
    vi.mocked(api.post).mockResolvedValue(feedPage([{ id: 9, login: 'Reader', permission: 0 }]));
    vi.mocked(api.get).mockResolvedValue(feedPage([]));
    expect((await loadFeedMembers(api, 7, 'subscribers', ' Reader ', 0, abort)).content[0].login).toBe('Reader');
    expect(api.post).toHaveBeenLastCalledWith('/search/channel/7/subscribers/0', { query: 'Reader', searchBy: 0 }, undefined, { signal: abort });
    await loadFeedMembers(api, 7, 'administrators', '', 1, abort);
    expect(api.post).toHaveBeenLastCalledWith('/channel/7/permission/all/1', { permission: 1 }, undefined, { signal: abort });
    await loadFeedMembers(api, 7, 'blocked', '', 0, abort);
    expect(api.get).toHaveBeenLastCalledWith('/channel/7/block/all/0', { signal: abort });
});
it('rejects malformed member pages and invalid IDs before requesting', async () => {
    const api = mock();
    vi.mocked(api.post).mockResolvedValue(feedPage([{ id: 9 }]));
    await expect(loadFeedMembers(api, 7, 'subscribers', '', 0, signal())).rejects.toThrow('Invalid member response');
    vi.mocked(api.post).mockClear();
    await expect(loadFeedMembers(api, -1, 'subscribers', '', 0, signal())).rejects.toThrow();
    expect(api.post).not.toHaveBeenCalled();
});
it('uses administrator 1 and nullable removal without transferring ownership', async () => {
    const api = mock();
    await setFeedPermission(api, 7, 9, true);
    expect(api.post).toHaveBeenLastCalledWith('/channel/7/permission/manage', { target_profile_id: 9, permission: 1 });
    await setFeedPermission(api, 7, 9, false);
    expect(api.post).toHaveBeenLastCalledWith('/channel/7/permission/manage', { target_profile_id: 9, permission: null });
});
it('sends permanent, temporary and removed blocks with the exact native fields', async () => {
    const api = mock(), expires = Math.floor(Date.now() / 1000) + 86400;
    await setFeedBlock(api, 7, 9, true, { reason: ' Spam ', showReason: true, expires: null });
    expect(api.post).toHaveBeenLastCalledWith('/channel/7/block/manage', { target_profile_id: 9, is_blocked: true, is_perm_blocked: true, expire_date: null, reason: 'Spam', is_reason_showing_enabled: true });
    await setFeedBlock(api, 7, 9, true, { reason: '', showReason: false, expires });
    expect(api.post).toHaveBeenLastCalledWith('/channel/7/block/manage', expect.objectContaining({ expire_date: expires, is_perm_blocked: false }));
    await setFeedBlock(api, 7, 9, false, { reason: '', showReason: false, expires: null });
    expect(api.post).toHaveBeenLastCalledWith('/channel/7/block/manage', expect.objectContaining({ is_blocked: false, is_perm_blocked: false, expire_date: null }));
    vi.mocked(api.post).mockClear();
    await expect(setFeedBlock(api, 7, 9, true, { reason: '', showReason: false, expires: 1 })).rejects.toThrow();
    expect(api.post).not.toHaveBeenCalled();
});
it('uploads article media using a separate bearer token and preserves server metadata', async () => {
    const api = mock(), abort = signal(), file = image();
    const metadata = { url: 'https://images.example.com/photo.png', hash: 'native-hash', width: 640, height: 360 };
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: 1, file: metadata }) }); vi.stubGlobal('fetch', fetch);
    expect(await uploadFeedMedia(api, 7, file, { suggestion: true, edit: false }, abort)).toEqual(metadata);
    expect(api.get).toHaveBeenCalledWith('/channel/7/editor/available?is_suggestion=true&is_edit_mode=false', { signal: abort, cache: 'no-store' });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('https://editor.anixsekai.com/content/upload');
    expect(init.headers).toEqual({ Authorization: 'Bearer short-lived-media-token' });
    expect(init.body.get('file')).toBe(file);
    expect(init).toMatchObject({ signal: abort, credentials: 'omit', redirect: 'error' });
});
it('rejects bad files before obtaining credentials and rejects unsuccessful upload responses', async () => {
    const api = mock();
    await expect(uploadFeedMedia(api, 7, new File(['<svg/>'], 'bad.svg', { type: 'image/svg+xml' }), { suggestion: false, edit: false }, signal())).rejects.toThrow();
    expect(api.get).not.toHaveBeenCalled();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: 0 }) }));
    await expect(uploadFeedMedia(api, 7, image(), { suggestion: false, edit: false }, signal())).rejects.toThrow();
});
it('does not upload when native permission preflight rejects the request', async () => {
    const api = mock(), fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    vi.mocked(api.get).mockResolvedValue({ code: 9 });
    await expect(uploadFeedMedia(api, 7, image(), { suggestion: false, edit: false }, signal())).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
});
it('uses the native artwork image multipart field and supports aborting form requests', async () => {
    const api = mock(), abort = signal(), file = image();
    await uploadFeedArtwork(api, 7, 'cover', file, abort);
    const call = vi.mocked(api.postForm).mock.calls[0];
    expect(call[0]).toBe('/channel/cover/upload/7'); expect(call[1].get('image')).toBe(file); expect(call[2]).toEqual({ signal: abort });
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ code: 0 }) }); vi.stubGlobal('fetch', fetch);
    await apiPostForm('/channel/avatar/upload/7', 'account-token', new FormData(), { signal: abort });
    expect(fetch).toHaveBeenCalledWith('https://api-s.anixsekai.com/channel/avatar/upload/7?token=account-token', expect.objectContaining({ signal: abort, method: 'POST' }));
});
it('resolves native link metadata without forwarding account credentials or trusting URL hosts', async () => {
    const api = mock(), fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: 1, title: 'Video', hash: 'embed-hash' }) }); vi.stubGlobal('fetch', fetch);
    expect(await resolveFeedEmbed(api, 7, 'https://youtu.be/video123', { suggestion: false, edit: false }, signal())).toMatchObject({ service: 'youtube', hash: 'embed-hash' });
    expect(fetch.mock.calls[0][0]).toBe('https://editor.anixsekai.com/embed/youtube?url=https%3A%2F%2Fyoutu.be%2Fvideo123');
    fetch.mockClear();
    await expect(resolveFeedEmbed(api, 7, 'javascript:alert(1)', { suggestion: false, edit: false }, signal())).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
});
it('preserves all widget settings even while disabled and validates native ranges', async () => {
    const api = mock(); vi.mocked(api.post).mockResolvedValue({ code: 0, channel: feedChannel });
    await saveFeedChannel(api, 'Channel', '', true, false, 7, { enabled: false, sort: 1, period: 2, count: 4 });
    expect(api.post).toHaveBeenLastCalledWith('/channel/edit/7', expect.objectContaining({ is_episode_channel_widget_enabled: false, episode_channel_widget_sort: 1, episode_channel_widget_popularity_period: 2, episode_channel_widget_article_count: 4 }));
    vi.mocked(api.post).mockClear();
    await expect(saveFeedChannel(api, 'Channel', '', true, false, 7, { enabled: true, sort: 1, period: 2, count: 5 })).rejects.toThrow();
    expect(api.post).not.toHaveBeenCalled();
});
it('stops publishing after cancellation during availability checks', async () => {
    const api = mock(), controller = new AbortController();
    vi.mocked(api.get).mockImplementation(async () => { controller.abort(); return { code: 0 }; });
    vi.mocked(api.post).mockResolvedValue({ code: 0, article: feedArticle });
    await expect(saveFeedArticle(api, 7, [{ type: 'paragraph', data: { text: 'Draft' } }], { signed: true, signal: controller.signal })).rejects.toThrow();
    expect(api.post).not.toHaveBeenCalled();
});
it('crops to the requested aspect and keeps extreme pan and zoom inside the source image', () => {
    expect(feedCrop(1600, 900, 1, 1, 50, 50)).toEqual({ width: 900, height: 900, x: 350, y: 0 });
    const crop = feedCrop(600, 1200, 3, 3, 100, 100);
    expect(crop.width / crop.height).toBe(3); expect(crop.x + crop.width).toBeCloseTo(600); expect(crop.y + crop.height).toBeCloseTo(1200);
    expect(() => feedCrop(0, 900, 1, 1, 50, 50)).toThrow();
});
