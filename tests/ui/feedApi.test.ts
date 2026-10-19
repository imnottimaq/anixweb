import { describe, expect, it, vi } from 'vitest';
import type { useApi } from '../../src/shared/apiClient';
import { feedId, feedUrl, loadFeed, loadFeedArticle, loadFeedChannel, loadFeedComments, loadFeedRecommendations, loadFeedReplies, loadFeedSearch } from '../../src/shared/feed';
import { feedArticle, feedChannel, feedComment, feedPage } from '../fixtures/feed';

function apiMock() { return { get: vi.fn(), post: vi.fn() } as unknown as ReturnType<typeof useApi>; }
const signal = new AbortController().signal;

describe('captured native feed API contract', () => {
    it('loads latest pages with GET and channel posts with an empty POST', async () => {
        const api = apiMock();
        vi.mocked(api.get).mockResolvedValue(feedPage([feedArticle], 200));
        vi.mocked(api.post).mockResolvedValue(feedPage([feedArticle]));
        expect((await loadFeed(api, { kind: 'latest' }, 1, signal)).content).toHaveLength(1);
        expect(api.get).toHaveBeenCalledWith('/feed/latest/all/1', { signal });
        await loadFeed(api, { kind: 'channel', id: 7 }, 0, signal);
        expect(api.post).toHaveBeenCalledWith('/channel/7/article/all/0', undefined, undefined, { signal });
    });
    it('short-circuits an empty personal feed using the native subscription count', async () => {
        const api = apiMock();
        vi.mocked(api.get).mockResolvedValue({ code: 0, subscription_count: 0 });
        expect((await loadFeed(api, { kind: 'personal' }, 0, signal)).content).toEqual([]);
        expect(api.get).toHaveBeenCalledExactlyOnceWith('/channel/subscription/count', { signal });
    });
    it('requests the personal stream when subscriptions exist', async () => {
        const api = apiMock();
        vi.mocked(api.get).mockResolvedValueOnce({ code: 0, subscription_count: 2 }).mockResolvedValueOnce(feedPage([feedArticle]));
        expect((await loadFeed(api, { kind: 'personal' }, 0, signal)).content[0].id).toBe(41);
        expect(api.get).toHaveBeenLastCalledWith('/feed/all/0?date=0', { signal });
    });
    it('reads the combined search response rather than treating it as one paged array', async () => {
        const api = apiMock();
        vi.mocked(api.post).mockResolvedValue({ code: 0, articles: feedPage([feedArticle]), channels: feedPage([feedChannel]), blogs: feedPage([]) });
        expect((await loadFeedSearch(api, ' anime ', 0, signal)).channels.content[0].id).toBe(7);
        expect(api.post).toHaveBeenCalledWith('/search/feed/0', { query: 'anime', searchBy: 0 }, undefined, { signal });
    });
    it('loads article, channel, comments, replies and recommendations from their own endpoints', async () => {
        const api = apiMock();
        vi.mocked(api.get).mockResolvedValueOnce({ code: 0, article: feedArticle }).mockResolvedValueOnce({ code: 0, channel: feedChannel })
            .mockResolvedValueOnce(feedPage([feedComment])).mockResolvedValueOnce(feedPage([feedChannel]));
        vi.mocked(api.post).mockResolvedValueOnce(feedPage([feedComment]));
        expect((await loadFeedArticle(api, 41, signal)).id).toBe(41);
        expect((await loadFeedChannel(api, 7, signal)).id).toBe(7);
        await loadFeedComments(api, 41, 0, signal);
        await loadFeedReplies(api, 81, 0, signal);
        await loadFeedRecommendations(api, signal);
        expect(vi.mocked(api.get).mock.calls.map(call => call[0])).toEqual(['/article/41', '/channel/7', '/article/comment/all/41/0', '/channel/recommendations/0']);
        expect(api.post).toHaveBeenCalledWith('/article/comment/replies/81/0?sort=2', undefined, undefined, { signal });
    });
    it('rejects malformed IDs and responses instead of displaying a successful empty feed', async () => {
        const api = apiMock();
        expect(feedId('1/../../profile')).toBeNull();
        expect(feedId('Infinity')).toBeNull();
        await expect(loadFeedChannel(api, NaN, signal)).rejects.toThrow();
        expect(api.get).not.toHaveBeenCalled();
        vi.mocked(api.get).mockResolvedValue({ code: 0, content: [{}] });
        await expect(loadFeed(api, { kind: 'latest' }, 0, signal)).rejects.toThrow('Invalid feed response');
        vi.mocked(api.get).mockResolvedValue({ code: 0, article: { ...feedArticle, id: 99 } });
        await expect(loadFeedArticle(api, 41, signal)).rejects.toThrow();
        vi.mocked(api.get).mockResolvedValue({ code: 401, article: feedArticle });
        await expect(loadFeedArticle(api, 41, signal)).rejects.toThrow();
        vi.mocked(api.get).mockResolvedValue({ code: 401, channel: feedChannel });
        await expect(loadFeedChannel(api, 7, signal)).rejects.toThrow();
    });
    it('permits only HTTP(S) links without embedded credentials', () => {
        for (const url of ['javascript:alert(1)', 'data:text/html,test', 'file:///secret', 'https://name:password@example.com', '/relative']) expect(feedUrl(url)).toBeUndefined();
        expect(feedUrl('https://example.com/post')).toBe('https://example.com/post');
    });
});
