import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import PageState from '../components/PageState';
import { PageHeader, PageLayout } from '../components/PageLayout';
import AnimeCard from '../components/AnimeCard';
import AnimeCardHorizontal from '../components/AnimeCardHorizontal';
import FilterModal from '../modals/FilterModal';
import { useApi } from '../shared/apiClient';
import { useSettings } from '../shared/contexts/settingsContext';
import { useUser } from '../shared/contexts/userContext';
import type { TranslationKey } from '../shared/i18n';
import type { Anime, Filter, PagedResponse } from '../shared/types/api';
import { useAsyncLoad } from '../shared/useAsyncLoad';
import styles from './FilterSearchScreen.module.css';
import { useTranslation } from '../shared/useTranslation';

const FILTER_STORAGE_KEY = 'release_search_filters';

type FilterRouteState = {
    filter?: Filter;
    autoSearch?: boolean;
};

const EMPTY_FILTER: Required<Filter> = {
    country: null,
    category_id: null,
    status_id: null,
    genres: [],
    is_genres_exclude_mode_enabled: false,
    profile_list_exclusions: [],
    types: [],
    studio: null,
    source: null,
    start_year: null,
    end_year: null,
    episode_duration_from: null,
    episode_duration_to: null,
    episodes_from: null,
    episodes_to: null,
    season: null,
    age_ratings: [],
    sort: 0,
};

function readSavedFilter(): Filter {
    try {
        const saved = localStorage.getItem(FILTER_STORAGE_KEY);
        return saved ? JSON.parse(saved) as Filter : {};
    } catch {
        return {};
    }
}

export default function FilterSearchScreen() {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const location = useLocation();
    const { userToken } = useUser();
    const routeState = location.state as FilterRouteState | null;
    const [filter, setFilter] = useState<Filter>(() => routeState?.filter ?? readSavedFilter());
    const [isFilterModalOpen, setIsFilterModalOpen] = useState(() => !routeState?.autoSearch);
    const [hasSearched, setHasSearched] = useState(() => routeState?.autoSearch ?? false);
    const isApplyingFilterRef = useRef(false);

    const applyFilter = (nextFilter: Filter) => {
        isApplyingFilterRef.current = true;
        localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(nextFilter));
        setFilter(nextFilter);
        setHasSearched(true);
    };

    return <PageLayout className={styles.page} size="wide">
        <PageHeader
            title={t('filterSearch.title')}
            description={t('filterSearch.description')}
            actions={<button type="button" className={styles.changeButton} onClick={() => setIsFilterModalOpen(true)}>{t('filterSearch.change')}</button>}
        />

        {!hasSearched && <PageState status="empty" message={t('filterSearch.setup')} />}
        {hasSearched && <>
            <div className={styles.chips} aria-label={t('filter.title')}>
                {(Object.entries(filter) as [keyof Filter, Filter[keyof Filter]][]).flatMap(([key, value]) => {
                    if (value == null || value === '' || value === false || (key === 'sort' && value === 0)) return [];
                    const values = Array.isArray(value) ? value : [value];
                    return values.map(item => {
                        const label = t(FILTER_LABELS[key] ?? 'filter.title');
                        const option = typeof item === 'number' ? FILTER_OPTIONS[key]?.[item] : undefined;
                        const country = key === 'country' ? ({ '\u042f\u043f\u043e\u043d\u0438\u044f': 'country.japan', '\u041a\u0438\u0442\u0430\u0439': 'country.china', '\u042e\u0436\u043d\u0430\u044f \u041a\u043e\u0440\u0435\u044f': 'country.southKorea' } as Record<string, TranslationKey>)[String(item)] : undefined;
                        const valueLabel = option ? t(option) : country ? t(country) : key === 'age_ratings' ? ['0+', '6+', '12+', '16+', '18+'][Number(item) - 1] : String(item);
                        const name = typeof item === 'boolean' ? label : `${label}: ${valueLabel}`;
                        return <button type="button" key={`${key}:${item}`} aria-label={t('ux.removeFilter', { name })} onClick={() => {
                            const next = { ...filter };
                            if (Array.isArray(value)) Object.assign(next, { [key]: value.filter(entry => entry !== item) });
                            else delete next[key];
                            applyFilter(next);
                            isApplyingFilterRef.current = false;
                        }}>{name}<span aria-hidden="true"> {'\u00d7'}</span></button>;
                    });
                })}
            </div>
            <FilterResults key={`${JSON.stringify(filter)}:${userToken}`} filter={filter} />
        </>}

        <FilterModal
            isOpen={isFilterModalOpen}
            onClose={() => {
                if (isApplyingFilterRef.current) {
                    isApplyingFilterRef.current = false;
                    setIsFilterModalOpen(false);
                    return;
                }

                if (hasSearched) setIsFilterModalOpen(false);
                else navigate('/overview');
            }}
            filter={filter}
            setFilter={applyFilter}
        />
    </PageLayout>;
}

const FILTER_LABELS: Partial<Record<keyof Filter, TranslationKey>> = {
    country: 'filter.country', category_id: 'filter.category', status_id: 'filter.status', genres: 'filter.genres',
    types: 'filter.dubs', studio: 'filter.studio', source: 'filter.source', start_year: 'filter.yearFrom', end_year: 'filter.yearTo',
    episodes_from: 'filter.episodesFrom', episodes_to: 'filter.episodesTo', episode_duration_from: 'filter.durationFrom',
    episode_duration_to: 'filter.durationTo', season: 'filter.season', age_ratings: 'filter.ageRating', sort: 'filter.sort',
    profile_list_exclusions: 'filter.excludeLists', is_genres_exclude_mode_enabled: 'filter.excludeGenres',
};

const FILTER_OPTIONS: Partial<Record<keyof Filter, Record<number, TranslationKey>>> = {
    category_id: { 1: 'releaseType.series', 2: 'releaseType.film', 3: 'roadmap.discover.popular.tab.ova', 4: 'releaseType.dorama' },
    status_id: { 1: 'filter.statusReleased', 2: 'filter.statusOngoing', 3: 'filter.statusAnnounced' },
    season: { 1: 'seasons.winter', 2: 'seasons.spring', 3: 'seasons.summer', 4: 'seasons.autumn' },
    profile_list_exclusions: { 0: 'nav.favorites', 1: 'status.watching', 2: 'status.planned', 3: 'status.watched', 4: 'status.hold_on', 5: 'status.dropped' },
    sort: { 0: 'sort.dateAddedNewFirst', 1: 'filter.sortRating', 2: 'filter.sortYear', 3: 'filter.sortPopularity' },
};

type ReleasePage = Partial<PagedResponse<Anime>>;
function hasNextPage(data: ReleasePage, index: number) {
    return (data.content?.length ?? 0) > 0 && (typeof data.total_page_count !== 'number' || (data.current_page ?? index) + 1 < data.total_page_count);
}

function FilterResults({ filter }: { filter: Filter }) {
    const api = useApi();
    const { t } = useTranslation();
    const { settings } = useSettings();
    const { data, isLoading, error, reload } = useAsyncLoad(
        signal => api.post<ReleasePage>('/filter/0?extended_mode=true', { ...EMPTY_FILTER, ...filter }, undefined, { signal }), [api, filter]);
    const [extra, setExtra] = useState<{ items: Anime[]; page: number; hasMore: boolean } | null>(null);
    const [loadingMore, setLoadingMore] = useState(false);
    const [failedPage, setFailedPage] = useState<number | null>(null);
    const pending = useRef<AbortController | null>(null);
    useEffect(() => () => pending.current?.abort(), []);
    const results = [...(data?.content ?? []), ...(extra?.items ?? [])];
    const hasMore = extra?.hasMore ?? (data ? hasNextPage(data, 0) : false);
    const loadPage = async (index: number) => {
        if (pending.current) return;
        const controller = new AbortController();
        pending.current = controller;
        setLoadingMore(true);
        setFailedPage(null);
        try {
            const result = await api.post<ReleasePage>(`/filter/${index}?extended_mode=true`, { ...EMPTY_FILTER, ...filter }, undefined, { signal: controller.signal });
            if (controller.signal.aborted) return;
            setExtra(previous => {
                const items = previous?.items ?? [];
                const known = new Set([...(data?.content ?? []), ...items].map(item => item.id));
                const unique = (result.content ?? []).filter(item => { if (known.has(item.id)) return false; known.add(item.id); return true; });
                return { items: [...items, ...unique], page: result.current_page ?? index, hasMore: hasNextPage(result, index) };
            });
        } catch { if (!controller.signal.aborted) setFailedPage(index); }
        finally { if (!controller.signal.aborted) { pending.current = null; setLoadingMore(false); } }
    };
    return <section aria-busy={isLoading || loadingMore} aria-label={t('filterSearch.title')}>
        {isLoading && <PageState status="loading" message={t('filterSearch.loading')} />}
        {!isLoading && Boolean(error) && <PageState status="error" message={t('filterSearch.error')} onRetry={reload} />}
        {!isLoading && !error && <p role="status">{typeof data?.total_count === 'number' ? t('ux.resultsCount', { count: data.total_count }) : t('ux.loadedCount', { count: results.length })}</p>}
        {!isLoading && !error && results.length === 0 && <PageState status="empty" message={t('filterSearch.empty')} />}
        {!isLoading && results.length > 0 && <div className={`${styles.grid} ${settings.appearance.defaultCardType === 'horizontal' ? styles.horizontal : ''}`}>
            {results.map(anime => settings.appearance.defaultCardType === 'horizontal' ? <AnimeCardHorizontal key={anime.id} anime={anime} /> : <AnimeCard key={anime.id} anime={anime} />)}
        </div>}
        {failedPage !== null && <PageState status="error" message={t('filterSearch.error')} onRetry={() => void loadPage(failedPage)} />}
        {!isLoading && !error && hasMore && failedPage === null && <button type="button" className={styles.changeButton} disabled={loadingMore} onClick={() => void loadPage((extra?.page ?? data?.current_page ?? 0) + 1)}>{t(loadingMore ? 'page.loading' : 'ux.loadMore')}</button>}
    </section>;
}
