import { useCallback, useEffect, useRef, useState } from 'react';
import type { FeedPage } from './feed';
import { readFeedSnapshot, writeFeedSnapshot } from './feedPageMemory';

/** Owners remount this hook when the account, source or search query changes. */
export function useFeedPages<T extends { id: number }>(request: (page: number, signal: AbortSignal) => Promise<FeedPage<T>>, memoryKey?: string) {
    const [cached] = useState(() => readFeedSnapshot<T>(memoryKey));
    const [items, setItems] = useState<T[]>(cached?.items ?? []);
    const [loading, setLoading] = useState(!cached);
    const [moreLoading, setMoreLoading] = useState(false);
    const [error, setError] = useState(false);
    const [failedPage, setFailedPage] = useState(0);
    const [hasMore, setHasMore] = useState(cached?.hasMore ?? false);
    const [attempt, setAttempt] = useState(0);
    const controller = useRef<AbortController | null>(null);
    const currentPage = useRef(cached?.page ?? 0);
    const pending = useRef(false);
    useEffect(() => {
        const abort = new AbortController();
        controller.current = abort;
        pending.current = false;
        if (cached && attempt === 0) return () => abort.abort();
        Promise.resolve().then(() => request(0, abort.signal)).then(result => {
            if (abort.signal.aborted) return;
            const unique = [...new Map(result.content.map(item => [item.id, item])).values()];
            setItems(unique);
            setMoreLoading(false);
            currentPage.current = 0;
            setError(false);
            // The real latest-feed response reports total_page_count=0 even with more pages.
            setHasMore(result.content.length > 0 && (result.total_count === undefined || result.content.length < result.total_count));
            writeFeedSnapshot(memoryKey, { items: unique, page: 0, hasMore: result.content.length > 0 && (result.total_count === undefined || result.content.length < result.total_count) });
        }).catch(() => { if (!abort.signal.aborted) { setFailedPage(0); setError(true); setMoreLoading(false); } })
            .finally(() => { if (!abort.signal.aborted) setLoading(false); });
        return () => abort.abort();
    }, [request, attempt, cached, memoryKey]);
    const more = useCallback(async () => {
        const abort = controller.current;
        if (!abort || abort.signal.aborted || pending.current || !hasMore) return;
        pending.current = true;
        setMoreLoading(true); setError(false);
        try {
            const result = await request(currentPage.current + 1, abort.signal);
            if (abort.signal.aborted) return;
            const fresh = result.content.filter(item => !items.some(existing => existing.id === item.id));
            const combined = [...new Map([...items, ...fresh].map(item => [item.id, item])).values()];
            setItems(combined);
            currentPage.current += 1;
            setHasMore(fresh.length > 0 && (result.total_count === undefined || combined.length < result.total_count));
            writeFeedSnapshot(memoryKey, { items: combined, page: currentPage.current, hasMore: fresh.length > 0 && (result.total_count === undefined || combined.length < result.total_count) });
        } catch { if (!abort.signal.aborted) { setFailedPage(currentPage.current + 1); setError(true); } }
        finally { if (!abort.signal.aborted) { pending.current = false; setMoreLoading(false); } }
    }, [request, items, hasMore, memoryKey]);
    const retry = () => { setLoading(true); setError(false); setAttempt(value => value + 1); };
    return { items, loading, moreLoading, error, hasMore, more, retry,
        retryError: () => { if (failedPage === 0) retry(); else void more(); } };
}
