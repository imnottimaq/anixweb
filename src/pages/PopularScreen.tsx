import { useEffect, useRef, useState } from 'react';
import AnimeCard from '../components/AnimeCard';
import AnimeCardHorizontal from '../components/AnimeCardHorizontal';
import { PageHeader, PageLayout } from '../components/PageLayout';
import PageState from '../components/PageState';
import { useApi } from '../shared/apiClient';
import { useSettings } from '../shared/contexts/settingsContext';
import { useTranslation } from '../shared/useTranslation';
import { useUser } from '../shared/contexts/userContext';
import { useAsyncLoad } from '../shared/useAsyncLoad';
import { POPULAR_TABS, EMPTY_FILTER_BASE, type PopularTabId } from '../shared/discover/popular';
import { moveTab } from '../shared/discover/tabs';
import type { Anime, PagedResponse } from '../shared/types/api';
import styles from './PopularScreen.module.css';

type ReleasePage = Partial<PagedResponse<Anime>>;
function hasNextPage(data: ReleasePage, page: number) {
    return typeof data.total_page_count === 'number'
        ? (data.current_page ?? page) + 1 < data.total_page_count
        : (data.content?.length ?? 0) > 0;
}

export default function PopularScreen() {
    const { t } = useTranslation();
    const { userToken } = useUser();
    const [activeTab, setActiveTab] = useState<PopularTabId>('all');
    return <PageLayout className={styles.page} size="wide">
        <PageHeader title={t('roadmap.discover.popular.title')} description={t('roadmap.discover.popular.description')} />
        <nav className={styles.tabNav} role="tablist" aria-label={t('roadmap.discover.popular.title')}>
            {POPULAR_TABS.map(tab => <button key={tab.id} type="button" role="tab" id={`popular-tab-${tab.id}`}
                aria-selected={activeTab === tab.id} aria-controls="popular-panel" tabIndex={activeTab === tab.id ? 0 : -1}
                className={`${styles.tabButton} ${activeTab === tab.id ? styles.activeTab : ''}`}
                onClick={() => setActiveTab(tab.id)} onKeyDown={event => moveTab(event, POPULAR_TABS.map(item => item.id), tab.id, setActiveTab)}>
                {t(tab.labelKey)}
            </button>)}
        </nav>
        <PopularResults key={`${activeTab}:${userToken}`} activeTab={activeTab} />
    </PageLayout>;
}

function PopularResults({ activeTab }: { activeTab: PopularTabId }) {
    const api = useApi();
    const { t } = useTranslation();
    const { settings } = useSettings();
    const requestBody = { ...EMPTY_FILTER_BASE, ...POPULAR_TABS.find(tab => tab.id === activeTab)?.filter };
    const { data, error, isLoading, reload } = useAsyncLoad(signal => api.post<ReleasePage>(
        '/filter/0?extended_mode=true', requestBody, undefined, { signal }), [api, activeTab]);
    const [extra, setExtra] = useState<{ items: Anime[]; page: number; hasMore: boolean } | null>(null);
    const [isLoadingMore, setIsLoadingMore] = useState(false);
    const [failedPage, setFailedPage] = useState<number | null>(null);
    const pendingRequest = useRef<AbortController | null>(null);
    useEffect(() => () => pendingRequest.current?.abort(), []);
    const releases = [...(data?.content ?? []), ...(extra?.items ?? [])];
    const hasMore = extra?.hasMore ?? (data ? hasNextPage(data, 0) : false);
    const page = extra?.page ?? data?.current_page ?? 0;
    const loadPage = async (nextPage: number) => {
        if (pendingRequest.current) return;
        const controller = new AbortController();
        pendingRequest.current = controller;
        setIsLoadingMore(true);
        setFailedPage(null);
        try {
            const result = await api.post<ReleasePage>(`/filter/${nextPage}?extended_mode=true`, requestBody, undefined, { signal: controller.signal });
            if (controller.signal.aborted) return;
            setExtra(previous => {
                const items = previous?.items ?? [];
                const known = new Set([...(data?.content ?? []), ...items].map(anime => anime.id));
                const unique = (result.content ?? []).filter(anime => { if (known.has(anime.id)) return false; known.add(anime.id); return true; });
                return { items: [...items, ...unique], page: result.current_page ?? nextPage, hasMore: hasNextPage(result, nextPage) };
            });
        } catch {
            if (!controller.signal.aborted) setFailedPage(nextPage);
        } finally {
            if (!controller.signal.aborted) { pendingRequest.current = null; setIsLoadingMore(false); }
        }
    };
    const isHorizontal = settings.appearance.defaultCardType === 'horizontal';
    return <div id="popular-panel" role="tabpanel" tabIndex={0} aria-labelledby={`popular-tab-${activeTab}`} className={styles.tabPanel} aria-busy={isLoading || isLoadingMore}>
        {isLoading && <PageState status="loading" message={t('roadmap.discover.popular.loading')} />}
        {!isLoading && Boolean(error) && <PageState status="error" message={t('roadmap.discover.popular.error')} onRetry={reload} />}
        {!isLoading && !error && releases.length === 0 && <PageState status="empty" message={t('roadmap.discover.popular.empty')} />}
        {!isLoading && releases.length > 0 && <div className={`${styles.grid} ${isHorizontal ? styles.horizontalGrid : ''}`}>
            {releases.map(anime => isHorizontal ? <AnimeCardHorizontal key={anime.id} anime={anime} /> : <AnimeCard key={anime.id} anime={anime} />)}
        </div>}
        {failedPage !== null && <PageState status="error" message={t('roadmap.discover.popular.error')} onRetry={() => void loadPage(failedPage)} />}
        {!isLoading && !error && failedPage === null && hasMore && <div className={styles.loadMoreWrapper}>
            <button type="button" className={styles.loadMoreButton} disabled={isLoadingMore} onClick={() => void loadPage(page + 1)}>
                {t(isLoadingMore ? 'page.loading' : 'roadmap.discover.popular.loadMore')}
            </button>
        </div>}
    </div>;
}
