import { useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import PageState from '../components/PageState';
import { PageHeader, PageLayout } from '../components/PageLayout';
import AnimeCard from '../components/AnimeCard';
import AnimeCardHorizontal from '../components/AnimeCardHorizontal';
import FilterModal from '../modals/FilterModal';
import { useApi } from '../shared/apiClient';
import { useSettings } from '../shared/contexts/settingsContext';
import type { Anime, Filter } from '../shared/types/api';
import { useAsyncLoad } from '../shared/useAsyncLoad';
import styles from './FilterSearchScreen.module.css';

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
    const api = useApi();
    const navigate = useNavigate();
    const location = useLocation();
    const { settings } = useSettings();
    const routeState = location.state as FilterRouteState | null;
    const [filter, setFilter] = useState<Filter>(() => routeState?.filter ?? readSavedFilter());
    const [isFilterModalOpen, setIsFilterModalOpen] = useState(() => !routeState?.autoSearch);
    const [hasSearched, setHasSearched] = useState(() => routeState?.autoSearch ?? false);
    const isApplyingFilterRef = useRef(false);
    const { data: results = [], isLoading, error, reload } = useAsyncLoad(
        () => api.post<{ content?: Anime[] }>('/filter/0?extended_mode=true', { ...EMPTY_FILTER, ...filter })
            .then(data => data.content ?? []),
        [api, filter],
        { enabled: hasSearched, initialData: [] },
    );

    const applyFilter = (nextFilter: Filter) => {
        isApplyingFilterRef.current = true;
        localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(nextFilter));
        setFilter(nextFilter);
        setHasSearched(true);
    };

    return <PageLayout className={styles.page} size="wide">
        <PageHeader
            title="Поиск по фильтрам"
            description="Подберите релизы по жанру, году, статусу и другим параметрам."
            actions={<button type="button" className={styles.changeButton} onClick={() => setIsFilterModalOpen(true)}>Изменить фильтры</button>}
        />

        {!hasSearched && <PageState status="empty" message="Настройте фильтры, чтобы начать поиск." />}
        {isLoading && <PageState status="loading" message="Ищем релизы…" />}
        {!isLoading && Boolean(error) && <PageState status="error" message={`Не удалось загрузить релизы: ${error instanceof Error ? error.message : 'неизвестная ошибка'}`} onRetry={reload} />}
        {hasSearched && !isLoading && !error && results.length === 0 && <PageState status="empty" message="По выбранным фильтрам ничего не найдено." />}
        {!isLoading && results.length > 0 && <div className={`${styles.grid} ${settings.appearance.defaultCardType === 'horizontal' ? styles.horizontal : ''}`}>
            {results.map(anime => settings.appearance.defaultCardType === 'horizontal'
                ? <AnimeCardHorizontal key={anime.id} anime={anime} />
                : <AnimeCard key={anime.id} anime={anime} />)}
        </div>}

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
