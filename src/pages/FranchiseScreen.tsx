import { useCallback, useEffect, useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import AnimeCardHorizontal from '../components/AnimeCardHorizontal';
import { PageHeader, PageLayout } from '../components/PageLayout';
import PageState from '../components/PageState';
import RemoteImage from '../components/RemoteImage';
import { useApi } from '../shared/apiClient';
import type { Anime } from '../shared/types/api';
import styles from './FranchiseScreen.module.css';
import { useTranslation } from '../shared/useTranslation';

type FranchiseInfo = {
    id: number;
    name?: string;
    name_ru?: string;
    description?: string;
    image?: string;
    images?: string[];
    release_count?: number;
};

type RelatedResponse = {
    code: number;
    content: Anime[];
    current_page?: number;
    total_page_count?: number;
    total_pages?: number;
    related?: FranchiseInfo;
};

export default function FranchiseScreen() {
    const { id } = useParams<{ id: string }>();
    const location = useLocation();
    const api = useApi();
    const { t, language } = useTranslation();
    const franchiseFromState = location.state?.franchise as FranchiseInfo | undefined;
    const franchiseId = Number(id);
    const [franchise, setFranchise] = useState<FranchiseInfo | null>(franchiseFromState ?? null);
    const [releases, setReleases] = useState<Anime[]>([]);
    const [currentPage, setCurrentPage] = useState(0);
    const [totalPageCount, setTotalPageCount] = useState(0);
    const [isLoading, setIsLoading] = useState(true);
    const [isLoadingMore, setIsLoadingMore] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [retryIndex, setRetryIndex] = useState(0);
    const hasValidFranchiseId = Number.isFinite(franchiseId) && franchiseId > 0;

    const loadPage = useCallback((async (page: number) => {
        const path = `/related/${franchiseId}/${page}`;
        return api.get<RelatedResponse>(path);
    }), [api, franchiseId])

    useEffect(() => {
        if (!hasValidFranchiseId) return;

        let cancelled = false;
        // Reset pagination when the route changes before starting the new request.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setIsLoading(true);
        setError(null);
        setReleases([]);
        setCurrentPage(0);
        setTotalPageCount(0);
        setFranchise(franchiseFromState ?? null);

        void loadPage(0)
            .then(data => {
                if (cancelled) return;
                setReleases(data.content ?? []);
                setCurrentPage(data.current_page ?? 0);
                setTotalPageCount(data.total_page_count ?? data.total_pages ?? 0);
                setFranchise(current => data.related ?? current);
            })
            .catch(() => {
                if (!cancelled) setError(t('franchise.loadError'));
            })
            .finally(() => {
                if (!cancelled) setIsLoading(false);
            });

        return () => { cancelled = true; };
    }, [franchiseFromState, franchiseId, hasValidFranchiseId, loadPage, retryIndex, t]);

    const loadMore = async () => {
        if (isLoadingMore || currentPage >= totalPageCount) return;
        setIsLoadingMore(true);
        try {
            const data = await loadPage(currentPage + 1);
            setReleases(current => {
                const knownIds = new Set(current.map(release => release.id));
                return [...current, ...(data.content ?? []).filter(release => !knownIds.has(release.id))];
            });
            setCurrentPage(data.current_page ?? currentPage + 1);
            setTotalPageCount(data.total_page_count ?? data.total_pages ?? totalPageCount);
        } catch {
            setError(t('franchise.moreError'));
        } finally {
            setIsLoadingMore(false);
        }
    };

    const title = language === 'english' ? franchise?.name || franchise?.name_ru || t('franchise.title') : franchise?.name_ru || franchise?.name || t('franchise.title');
    const poster = franchise?.image || franchise?.images?.[0];

    return <PageLayout size="wide" className={styles.page}>
        <PageHeader title={title} description={franchise?.description} back />

        {poster && <section className={styles.hero}>
            <RemoteImage className={styles.cover} src={poster} alt={t('franchise.coverAlt', { title })} />
        </section>}

        <section className={styles.releases}>
            <div className={styles.sectionHeader}>
                <h2>{t('search.franchiseReleases')}</h2>
            </div>
            {!hasValidFranchiseId && <PageState status="error" message={t('franchise.openError')} />}
            {hasValidFranchiseId && isLoading && <PageState status="loading" message={t('franchise.loading')} />}
            {hasValidFranchiseId && !isLoading && error && <PageState
                status="error"
                message={error}
                onRetry={hasValidFranchiseId
                    ? () => releases.length > 0 ? void loadMore() : setRetryIndex(index => index + 1)
                    : undefined}
            />}
            {hasValidFranchiseId && !isLoading && !error && releases.length === 0 && <PageState status="empty" message={t('franchise.empty')} />}
            <div className={styles.timeline}>
                {releases.map(release => <div key={release.id} className={styles.timelineItem}>
                    <AnimeCardHorizontal anime={release} />
                </div>)}
            </div>
            {currentPage < totalPageCount && <button type="button" className={styles.moreButton} disabled={isLoadingMore} onClick={() => void loadMore()}>{isLoadingMore ? t('franchise.loadingMore') : t('franchise.showMore')}</button>}
        </section>
    </PageLayout>;
}
