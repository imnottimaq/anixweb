import { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import AnimeCardHorizontal from '../components/AnimeCardHorizontal';
import RemoteImage from '../components/RemoteImage';
import { useApi } from '../shared/apiClient';
import type { Anime } from '../shared/types/api';
import styles from './FranchiseScreen.module.css';

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
    const navigate = useNavigate();
    const api = useApi();
    const franchiseFromState = location.state?.franchise as FranchiseInfo | undefined;
    const franchiseId = Number(id);
    const [franchise, setFranchise] = useState<FranchiseInfo | null>(franchiseFromState ?? null);
    const [releases, setReleases] = useState<Anime[]>([]);
    const [currentPage, setCurrentPage] = useState(0);
    const [totalPageCount, setTotalPageCount] = useState(0);
    const [isLoading, setIsLoading] = useState(true);
    const [isLoadingMore, setIsLoadingMore] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const loadPage = useCallback((async (page: number) => {
        const path = `/related/${franchiseId}/${page}`;
        return api.get<RelatedResponse>(path);
    }), [api, franchiseId])

    useEffect(() => {
        if (!Number.isFinite(franchiseId) || franchiseId <= 0) {
            setError('Не удалось открыть франшизу.');
            setIsLoading(false);
            return;
        }

        let cancelled = false;
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
                if (!cancelled) setError('Не удалось загрузить релизы франшизы.');
            })
            .finally(() => {
                if (!cancelled) setIsLoading(false);
            });

        return () => { cancelled = true; };
    }, [franchiseFromState, franchiseId, loadPage]);

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
            setError('Не удалось загрузить следующую страницу.');
        } finally {
            setIsLoadingMore(false);
        }
    };

    const title = franchise?.name_ru || franchise?.name || 'Франшиза';
    const poster = franchise?.image || franchise?.images?.[0];

    return <main className={styles.page}>
        <header className={styles.header}>
            <button type="button" className={styles.backButton} aria-label="Назад" onClick={() => navigate(-1)}><span className={styles.backIcon} aria-hidden="true" /></button>
            {poster && <RemoteImage className={styles.cover} src={poster} alt="" />}
        </header>

        {franchise && <section className={styles.hero}>
            <div className={styles.description}>
                <h2>{title}</h2>
                {franchise.description && <p>{franchise.description}</p>}
            </div>
        </section>}

        <section className={styles.releases}>
            <div className={styles.sectionHeader}>
                <h2>Релизы франшизы</h2>
            </div>
            {isLoading && <div className="route-loader" role="status">Загрузка…</div>}
            {error && <p className={styles.error}>{error}</p>}
            {!isLoading && !error && releases.length === 0 && <p className={styles.empty}>В этой франшизе пока нет релизов.</p>}
            <div className={styles.timeline}>
                {releases.map(release => <div key={release.id} className={styles.timelineItem}>
                    <AnimeCardHorizontal anime={release} />
                </div>)}
            </div>
            {currentPage < totalPageCount && <button type="button" className={styles.moreButton} disabled={isLoadingMore} onClick={() => void loadMore()}>{isLoadingMore ? 'Загружаем…' : 'Показать ещё'}</button>}
        </section>
    </main>;
}
