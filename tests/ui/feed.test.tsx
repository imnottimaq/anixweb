import { act, fireEvent, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { FeedArticleCard, FeedRichText } from '../../src/components/FeedContent';
import type { FeedArticle } from '../../src/shared/feed';
import FeedScreen from '../../src/pages/FeedScreen';
import { useFeedPages } from '../../src/shared/useFeedPages';
import { defaultAppSettings } from '../../src/shared/types/settings';
import { renderWithProviders } from './helpers/testUtils';
import { feedArticle } from '../fixtures/feed';

const settings = { ...defaultAppSettings, appearance: { ...defaultAppSettings.appearance, language: 'english' as const } };
afterEach(() => vi.unstubAllGlobals());

it('renders repost-only articles and stops cyclic source references', () => {
    const repost: FeedArticle = { id: 42, channel: { id: 8, title: 'My journal' }, payload: null, repost_article: { ...feedArticle } };
    repost.repost_article!.repost_article = repost;
    renderWithProviders(<FeedArticleCard article={repost} />, { settings });
    expect(screen.getByRole('heading', { name: 'A new season begins' })).toBeVisible();
    expect(screen.getByRole('region', { name: 'Original post' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Original post' })).toHaveAttribute('href', '/feed/post/41');
});

it('shows deleted originals without leaking their old text or images', () => {
    const repost: FeedArticle = { id: 42, channel: { id: 8, title: 'My journal' }, repost_article: { ...feedArticle, is_deleted: true } };
    renderWithProviders(<FeedArticleCard article={repost} />, { settings });
    expect(screen.getByText('This post was deleted.')).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'A new season begins' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open image' })).not.toBeInTheDocument();
});

it('renders inline editor formatting while dropping executable markup and unsafe links', () => {
    const { container } = renderWithProviders(<FeedRichText html={'<b>Safe title</b><script>alert(1)</script><img src=x onerror="alert(1)"><a href="javascript:alert(1)">bad link</a><a href="https://example.com" onclick="alert(1)">source</a><iframe src="https://example.com"></iframe>'} />, { settings });
    expect(screen.getByText('Safe title').tagName).toBe('STRONG');
    expect(screen.getByText('bad link').closest('a')).toBeNull();
    expect(screen.getByRole('link', { name: 'source' })).not.toHaveAttribute('onclick');
    expect(container.querySelector('script,img,iframe,[onerror]')).toBeNull();
});

it('keeps inline spoilers hidden until explicitly expanded', () => {
    renderWithProviders(<FeedRichText html={'Before <span class="spoiler">Hidden ending</span> after'} />, { settings });
    expect(screen.getByText('Hidden ending')).not.toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Show spoiler' }));
    expect(screen.getByText('Hidden ending')).toBeVisible();
});

it('shows an image failure and retry rather than an endless blank placeholder', () => {
    renderWithProviders(<FeedArticleCard article={feedArticle} />, { settings });
    fireEvent.error(screen.getByRole('img', { name: 'Post image' }));
    expect(screen.getByText('Could not load the image.')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Retry image' }));
    expect(screen.getByRole('img', { name: 'Post image' })).toBeInTheDocument();
});

it('requires sign-in before making any feed requests', () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    renderWithProviders(<FeedScreen />, { initialRoute: '/feed', settings, userToken: '' });
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/account/login');
    expect(fetch).not.toHaveBeenCalled();
});

it('continues when total_page_count is zero, deduplicates overlap and stops on repeated pages', async () => {
    const request = vi.fn().mockResolvedValueOnce({ content: [{ id: 1 }], total_count: 99, total_page_count: 0 })
        .mockResolvedValueOnce({ content: [{ id: 1 }, { id: 2 }], total_count: 99 }).mockResolvedValueOnce({ content: [{ id: 2 }], total_count: 99 });
    const { result } = renderHook(() => useFeedPages(request));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.hasMore).toBe(true);
    await act(() => result.current.more());
    expect(result.current.items).toEqual([{ id: 1 }, { id: 2 }]);
    await act(() => result.current.more());
    expect(result.current.hasMore).toBe(false);
});

it('preserves existing posts after a page failure and retries the same page', async () => {
    const request = vi.fn().mockResolvedValueOnce({ content: [{ id: 1 }], total_count: 5 }).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ content: [{ id: 2 }], total_count: 2 });
    const { result } = renderHook(() => useFeedPages(request));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(() => result.current.more());
    expect(result.current.error).toBe(true);
    expect(result.current.items).toEqual([{ id: 1 }]);
    await act(() => result.current.more());
    expect(request.mock.calls.map(call => call[0])).toEqual([0, 1, 1]);
    expect(result.current.items).toEqual([{ id: 1 }, { id: 2 }]);
});

it('aborts an outstanding page when the feed unmounts', async () => {
    let signal: AbortSignal | undefined;
    const request = vi.fn((_page: number, current: AbortSignal) => { signal = current; return new Promise<{ content: { id: number }[] }>(() => {}); });
    const { unmount } = renderHook(() => useFeedPages(request));
    await waitFor(() => expect(request).toHaveBeenCalledOnce());
    unmount();
    expect(signal?.aborted).toBe(true);
});

it('refreshes during an outstanding next page without stale posts or a stuck load-more lock', async () => {
    let release: (value: { content: { id: number }[] }) => void = () => {};
    const deferred = new Promise<{ content: { id: number }[] }>(resolve => { release = resolve; });
    const request = vi.fn().mockResolvedValueOnce({ content: [{ id: 1 }], total_count: 9 }).mockReturnValueOnce(deferred)
        .mockResolvedValueOnce({ content: [{ id: 2 }], total_count: 9 }).mockResolvedValueOnce({ content: [{ id: 3 }], total_count: 2 });
    const { result } = renderHook(() => useFeedPages(request));
    await waitFor(() => expect(result.current.loading).toBe(false));
    let pending: Promise<void> | undefined;
    act(() => { pending = result.current.more(); });
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.items).toEqual([{ id: 2 }]));
    await act(async () => { release({ content: [{ id: 99 }] }); await pending; });
    expect(result.current.items).toEqual([{ id: 2 }]);
    await act(() => result.current.more());
    expect(result.current.items).toEqual([{ id: 2 }, { id: 3 }]);
});

it('retries a failed refresh at page zero while preserving the visible posts', async () => {
    const request = vi.fn().mockResolvedValueOnce({ content: [{ id: 1 }], total_count: 2 }).mockRejectedValueOnce(new Error('offline'))
        .mockResolvedValueOnce({ content: [{ id: 2 }], total_count: 1 });
    const { result } = renderHook(() => useFeedPages(request));
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.error).toBe(true));
    expect(result.current.items).toEqual([{ id: 1 }]);
    act(() => result.current.retryError());
    await waitFor(() => expect(result.current.items).toEqual([{ id: 2 }]));
    expect(request.mock.calls.map(call => call[0])).toEqual([0, 0, 0]);
});

it('restores all visited pages and continues from the right page after returning', async () => {
    const key = crypto.randomUUID();
    const request = vi.fn().mockResolvedValueOnce({ content: [{ id: 1 }], total_count: 4 }).mockResolvedValueOnce({ content: [{ id: 2 }], total_count: 4 });
    const first = renderHook(() => useFeedPages(request, key));
    await waitFor(() => expect(first.result.current.loading).toBe(false));
    await act(() => first.result.current.more());
    first.unmount();
    const next = vi.fn().mockResolvedValue({ content: [{ id: 3 }], total_count: 4 });
    const restored = renderHook(() => useFeedPages(next, key));
    expect(restored.result.current.items).toEqual([{ id: 1 }, { id: 2 }]);
    expect(restored.result.current.loading).toBe(false);
    expect(next).not.toHaveBeenCalled();
    await act(() => restored.result.current.more());
    expect(next.mock.calls[0][0]).toBe(2);
    expect(restored.result.current.items).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
    act(() => restored.result.current.retry());
    await waitFor(() => expect(next.mock.calls).toHaveLength(2));
    expect(next.mock.calls[1][0]).toBe(0);
});
