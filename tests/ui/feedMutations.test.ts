import { expect, it, vi } from 'vitest';
import type { useApi } from '../../src/shared/apiClient';
import { feedMutation, loadFeedDirectory, saveFeedArticle, saveFeedChannel, saveFeedComment, setChannelSubscription, setFeedMute, voteOnFeed } from '../../src/shared/feed';
import { feedArticle, feedChannel, feedPage } from '../fixtures/feed';

function mock() { return { get: vi.fn().mockResolvedValue({ code: 0 }), post: vi.fn().mockResolvedValue({ code: 0 }) } as unknown as ReturnType<typeof useApi>; }
it('uses native subscription, mute and toggle-vote methods with uncached GET mutations', async () => {
    const api = mock();
    await setChannelSubscription(api, 7, true); await setChannelSubscription(api, 7, false);
    await setFeedMute(api, 'channel', 7, true); await setFeedMute(api, 'article', 41, false);
    await voteOnFeed(api, 'article', 41, 1); await voteOnFeed(api, 'comment', 81, 2);
    expect(vi.mocked(api.post).mock.calls.map(call => call[0])).toEqual(['/channel/subscribe/7', '/channel/unsubscribe/7', '/channel/mute/7']);
    expect(api.get).toHaveBeenCalledWith('/article/unmute/41', { cache: 'no-store' });
    expect(api.get).toHaveBeenCalledWith('/article/vote/41/1', { cache: 'no-store' });
    expect(api.get).toHaveBeenCalledWith('/article/comment/vote/81/2', { cache: 'no-store' });
});
it('preserves native camel-case reply metadata and spoiler fields', async () => {
    const api = mock();
    await saveFeedComment(api, 41, ' Reply ', true, { parentId: 81, profileId: 19 });
    expect(api.post).toHaveBeenCalledWith('/article/comment/add/41', { message: 'Reply', spoiler: true, parentCommentId: 81, replyToProfileId: 19 });
    await saveFeedComment(api, 41, 'Edited', false, { editId: 81 });
    expect(api.post).toHaveBeenLastCalledWith('/article/comment/edit/81', { message: 'Edited', spoiler: false });
});
it('checks publishing availability before sending structured EditorJS payload and snake-case flags', async () => {
    const api = mock(); vi.mocked(api.post).mockResolvedValue({ code: 0, article: feedArticle });
    const blocks = [{ type: 'paragraph', data: { text: 'A post' } }];
    await saveFeedArticle(api, 7, blocks, { signed: false, repostId: 42 });
    expect(api.get).toHaveBeenCalledWith('/channel/7/editor/available?is_suggestion=false&is_edit_mode=false', { cache: 'no-store' });
    expect(api.post).toHaveBeenCalledWith('/article/create/7', { payload: expect.objectContaining({ blocks, block_count: 1 }), is_signed: false, repost_article_id: 42 });
});
it('does not publish when availability fails and rejects unsafe media before any request', async () => {
    const api = mock(); vi.mocked(api.get).mockResolvedValue({ code: 7 });
    await expect(saveFeedArticle(api, 7, [{ type: 'paragraph', data: { text: 'A post' } }], { signed: true })).rejects.toThrow();
    expect(api.post).not.toHaveBeenCalled();
    vi.mocked(api.get).mockClear();
    await expect(saveFeedArticle(api, 7, [{ type: 'media', data: { items: [{ url: 'javascript:alert(1)' }] } }], { signed: true })).rejects.toThrow();
    expect(api.get).not.toHaveBeenCalled();
});
it('creates suggestions through their own endpoint and edits through the article endpoint', async () => {
    const api = mock(); vi.mocked(api.post).mockResolvedValue({ code: 0, article: feedArticle });
    const blocks = [{ type: 'paragraph', data: { text: 'A post' } }];
    await saveFeedArticle(api, 7, blocks, { signed: true, suggestion: true });
    expect(api.post).toHaveBeenLastCalledWith('/article/suggestion/create/7', { payload: expect.objectContaining({ blocks }) });
    await saveFeedArticle(api, 7, blocks, { signed: true, editId: 41 });
    expect(api.post).toHaveBeenLastCalledWith('/article/edit/41', expect.objectContaining({ is_signed: true }));
});
it('loads each channel directory using native filters and keeps editing flags', async () => {
    const api = mock(), signal = new AbortController().signal;
    vi.mocked(api.post).mockResolvedValue(feedPage([feedChannel]));
    await loadFeedDirectory(api, 'managed', 0, signal);
    expect(api.post).toHaveBeenCalledWith('/channel/all/0', { permission: 1, is_blog: null, is_subscribed: null, sort: 1 }, undefined, { signal });
    vi.mocked(api.post).mockResolvedValue({ code: 0, channel: feedChannel });
    await saveFeedChannel(api, ' Journal ', 'News', false, true, 7);
    expect(api.post).toHaveBeenLastCalledWith('/channel/edit/7', { title: 'Journal', description: 'News', is_commenting_enabled: false, is_article_suggestion_enabled: true });
});
it('rejects API error envelopes even when a caller supplies a raw API mock', async () => {
    const api = mock(); vi.mocked(api.post).mockResolvedValue({ code: 403 });
    await expect(feedMutation(api, 'post', '/channel/subscribe/7')).rejects.toThrow();
});
