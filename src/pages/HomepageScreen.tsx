import { useEffect, useRef, useState } from 'react';
import AnimeCard from '../components/AnimeCard';
import AnimeCardHorizontal from '../components/AnimeCardHorizontal';
import { type Anime, type Filter } from '../shared/types/api';
import { emptyTab, type Page, type TabData } from '../shared/types/internal';
import { useUser } from '../shared/contexts/userContext';
import { useSettings } from '../shared/contexts/settingsContext';
import styles from './HomepageScreen.module.css';
import FilterModal from '../modals/FilterModal';
import { useTranslation } from '../shared/useTranslation';

const PAGE_ITEMS: { page: Page; buttonText: 'home.my' | 'home.latest' | 'home.ongoing' | 'home.announced' | 'home.completed' | 'home.films' }[] = [
    { page: 'my', buttonText: 'home.my' }, { page: 'latest', buttonText: 'home.latest' }, { page: 'ongoing', buttonText: 'home.ongoing' }, { page: 'announced', buttonText: 'home.announced' }, { page: 'ended', buttonText: 'home.completed' }, { page: 'films', buttonText: 'home.films' },
];

const DEFAULT_FILTERS: Record<Exclude<Page, 'my'>, Filter> = {
    latest: {},
    ongoing: { status_id: 2 },
    announced: { status_id: 3 },
    ended: { status_id: 1 },
    films: { category_id: 2 },
};

const HOME_TAB_BY_SETTING: Record<'latest' | 'my' | 'ongoing' | 'announced' | 'finished' | 'films', Page> = {
    latest: 'latest',
    my: 'my',
    ongoing: 'ongoing',
    announced: 'announced',
    finished: 'ended',
    films: 'films',
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

function createTabs(): Record<Page, TabData> {
    return {
        my: emptyTab(),
        latest: emptyTab(),
        ongoing: emptyTab(),
        announced: emptyTab(),
        ended: emptyTab(),
        films: emptyTab(),
    };
}

function getMyFilters(): Filter {
    try {
        const saved = localStorage.getItem('my_filters');
        if (!saved) return {};

        const parsed = JSON.parse(saved) as Omit<Filter, 'age_ratings'> & { age_ratings?: number | Filter['age_ratings'] };
        return typeof parsed.age_ratings === 'number'
            ? { ...parsed, age_ratings: [parsed.age_ratings] as Filter['age_ratings'] }
            : parsed as Filter;
    } catch {
        return {};
    }
}

export default function HomepageScreen() {
    const { userToken } = useUser();
    const { settings } = useSettings();
    const { t } = useTranslation();
    const triggerRef = useRef<HTMLDivElement | null>(null);
    const loadingRequestsRef = useRef(new Set<string>());
    const latestRequestKeysRef = useRef(new Map<Page, string>());
    const [activePage, setActivePage] = useState<Page>(() => HOME_TAB_BY_SETTING[settings.content.defaultTabOnHome]);
    const [myFilters, setMyFilters] = useState<Filter>(getMyFilters);
    const [isFilterModalOpen, setIsFilterModalOpen] = useState(false);
    const [filterError, setFilterError] = useState<string | null>(null);
    const [retryVersion, setRetryVersion] = useState(0);
    const [myFilterVersion, setMyFilterVersion] = useState(0);
    const [tabs, setTabs] = useState<Record<Page, TabData>>(createTabs);

    const activeTab = tabs[activePage];
    const activeFilter = activePage === 'my' ? myFilters : DEFAULT_FILTERS[activePage];
    const currentPageIsLoaded = activeTab.loadedPages.includes(activeTab.page);
    const isMyTabUnconfigured = activePage === 'my' && Object.keys(myFilters).length === 0;
    const isInitialLoading = activeTab.isLoading && activeTab.releases.length === 0;
    const isLoadingMore = activeTab.isLoading && activeTab.releases.length > 0;

    useEffect(() => {
        if (isMyTabUnconfigured || !activeTab.hasMore || currentPageIsLoaded) return;

        const requestedPage = activeTab.page;
        const requestKey = `${activePage}:${requestedPage}:${JSON.stringify(activeFilter)}:${retryVersion}:${activePage === 'my' ? myFilterVersion : 0}`;
        if (loadingRequestsRef.current.has(requestKey)) return;

        loadingRequestsRef.current.add(requestKey);
        latestRequestKeysRef.current.set(activePage, requestKey);
        setFilterError(null);

        setTabs(previousTabs => ({
            ...previousTabs,
            [activePage]: {
                ...previousTabs[activePage],
                isLoading: true,
            },
        }));

        GetReleasesByPage(requestedPage, userToken, activeFilter)
            .then(data => {
                if (latestRequestKeysRef.current.get(activePage) !== requestKey) return;
                if (data.code !== 0 || !Array.isArray(data.content)) {
                    throw new Error(`API вернул код ${data.code ?? 'неизвестный'}`);
                }
                const newReleases = data.content as Anime[];
                setTabs(previousTabs => {
                    const previousTab = previousTabs[activePage];
                    const existingIds = new Set(previousTab.releases.map(anime => anime.id));
                    const uniqueReleases = newReleases.filter(anime => !existingIds.has(anime.id));

                    return {
                        ...previousTabs,
                        [activePage]: {
                            ...previousTab,
                            releases: [...previousTab.releases, ...uniqueReleases],
                            loadedPages: [...previousTab.loadedPages, requestedPage],
                            isLoading: false,
                            hasMore: newReleases.length > 0,
                        },
                    };
                });
            })
            .catch(error => {
                if (latestRequestKeysRef.current.get(activePage) !== requestKey) return;
                console.error('Не удалось загрузить релизы:', error);
                setFilterError(t('home.loadError'));
                setTabs(previousTabs => ({
                    ...previousTabs,
                    [activePage]: {
                        ...previousTabs[activePage],
                        isLoading: false,
                    },
                }));
            })
            .finally(() => {
                loadingRequestsRef.current.delete(requestKey);
            });
    }, [activeFilter, activePage, activeTab.hasMore, activeTab.page, currentPageIsLoaded, isMyTabUnconfigured, myFilterVersion, userToken, retryVersion, t]);

    useEffect(() => {
        if (isMyTabUnconfigured || !currentPageIsLoaded || activeTab.isLoading || !activeTab.hasMore) return;

        const observer = new IntersectionObserver(entries => {
            if (!entries[0]?.isIntersecting) return;

            setTabs(previousTabs => {
                const tab = previousTabs[activePage];
                if (tab.isLoading || !tab.hasMore || !tab.loadedPages.includes(tab.page)) return previousTabs;

                return {
                    ...previousTabs,
                    [activePage]: {
                        ...tab,
                        page: tab.page + 1,
                    },
                };
            });
        }, { rootMargin: '200px' });

        const trigger = triggerRef.current;
        if (trigger) observer.observe(trigger);

        return () => observer.disconnect();
    }, [activePage, activeTab.hasMore, activeTab.isLoading, activeTab.page, currentPageIsLoaded, isMyTabUnconfigured]);

    return (
        <div className={styles.body}>
            <div className={styles['side-panel']} role="tablist" aria-label={t('home.catalogAria')}>
                {PAGE_ITEMS.map(({ page, buttonText }) => (
                    <button
                        key={page}
                        role="tab"
                        aria-selected={activePage === page}
                        className={activePage === page ? styles.active : ''}
                        onClick={() => setActivePage(page)}
                    >
                        {t(buttonText)}
                    </button>
                ))}
            </div>

            <div className={styles.content}>
                {isMyTabUnconfigured ? (
                    <div className={styles['empty-my-tab']}>
                        <button type="button" className={styles['configure-button']} onClick={() => setIsFilterModalOpen(true)}>{t('misc.configure')}</button>
                    </div>
                ) : (
                    <>
                        {activePage === 'my' && <button type="button" className={styles['configure-button']} onClick={() => setIsFilterModalOpen(true)}>{t('misc.changeFilters')}</button>}
                        {filterError && <div className={styles['filter-error']} role="alert"><span>{filterError}</span><button type="button" onClick={() => { setFilterError(null); setRetryVersion(version => version + 1); }}>{t('page.retry')}</button></div>}
                        {!filterError && !activeTab.isLoading && activeTab.releases.length === 0 && <p className={styles['filter-empty']}>{t('search.empty')}</p>}
                        <div className={`${styles['releases-grid']} ${settings.appearance.defaultCardType === 'horizontal' ? styles['horizontal-grid'] : ''}`}>
                            {activeTab.releases.map(anime => (
                                settings.appearance.defaultCardType === 'vertical'
                                    ? <AnimeCard key={anime.id} anime={anime} />
                                    : <AnimeCardHorizontal key={anime.id} anime={anime} />
                            ))}
                            <div ref={triggerRef} style={{ height: '20px', background: 'transparent' }} />
                            {isLoadingMore && <div className={styles['loading-more']} role="status">{t('misc.loading')}</div>}
                        </div>
                    </>
                )}
            </div>

            {isInitialLoading && <div className={styles['loading-overlay']} role="status"><span>{t('misc.loading')}</span></div>}
            <FilterModal
                isOpen={isFilterModalOpen}
                onClose={() => setIsFilterModalOpen(false)}
                filter={myFilters}
                setFilter={filter => {
                    latestRequestKeysRef.current.delete('my');
                    setMyFilters(filter);
                    setMyFilterVersion(version => version + 1);
                    localStorage.setItem('my_filters', JSON.stringify(filter));
                    setTabs(previousTabs => ({ ...previousTabs, my: emptyTab() }));
                    setFilterError(null);
                }}
            />
        </div>
    );
}

async function GetReleasesByPage(page: number, token: string, filter: Filter) {
    const url = `https://api-s.anixsekai.com/filter/${page}?extended_mode=true&token=${token}`;
    let body = '';

    for (let attempt = 0; attempt < 2; attempt += 1) {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...EMPTY_FILTER, ...filter }),
        });

        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        body = await response.text();
        if (body.trim()) break;
    }

    if (!body.trim()) throw new Error('сервер вернул пустой ответ');

    let data: { code?: number; content?: Anime[] };
    try {
        data = JSON.parse(body) as { code?: number; content?: Anime[] };
    } catch {
        throw new Error('сервер вернул некорректный ответ');
    }

    if (data.code !== 0) throw new Error(`код API ${data.code ?? 'неизвестен'}`);
    if (!Array.isArray(data.content)) throw new Error('API не вернул список релизов');

    return data;
}
