import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import AnimeCard from '../components/AnimeCard';
import AnimeCardHorizontal from '../components/AnimeCardHorizontal';
import CollectionCard from '../components/CollectionCard';
import SortSelect, { type ReleaseSort } from '../components/SortSelect';
import { type Anime, type Collection, type PagedResponse } from '../shared/types/api';
import { emptyTab, type TabData } from '../shared/types/internal';
import { useUser } from '../shared/contexts/userContext';
import { useSettings } from '../shared/contexts/settingsContext';
import { useSearchScope, type SearchScope } from '../shared/contexts/searchContext';
import styles from './FavoritesScreen.module.css';
import { useTranslation } from '../shared/useTranslation';
import { useApi } from '../shared/apiClient';

type ProfilePage = 'collections' | 'favorites' | 'history' | 'watching' | 'planned' | 'completed' | 'onHold' | 'dropped';
type ReleasePage = Exclude<ProfilePage, 'collections'>;

const PAGE_ITEMS: { page: ProfilePage; buttonText: 'nav.favorites' | 'home.history' | 'status.watching' | 'status.planned' | 'status.watched' | 'status.hold_on' | 'status.dropped'; label?: string }[] = [
    { page: 'collections', buttonText: 'nav.favorites', label: 'Коллекции' }, { page: 'favorites', buttonText: 'nav.favorites' }, { page: 'history', buttonText: 'home.history' }, { page: 'watching', buttonText: 'status.watching' }, { page: 'planned', buttonText: 'status.planned' }, { page: 'completed', buttonText: 'status.watched' }, { page: 'onHold', buttonText: 'status.hold_on' }, { page: 'dropped', buttonText: 'status.dropped' },
];

const PROFILE_LIST_IDS: Record<Exclude<ProfilePage, 'collections' | 'favorites' | 'history'>, number> = {
    watching: 1,
    planned: 2,
    completed: 3,
    onHold: 4,
    dropped: 5,
};

const API_SORT_VALUES: Record<ReleaseSort, number> = {
    addedDesc: 1,
    addedAsc: 2,
    yearDesc: 3,
    yearAsc: 4,
    titleAsc: 5,
    titleDesc: 6,
};

const SEARCH_SCOPES: Record<ProfilePage, SearchScope> = {
    collections: { type: 'collections' },
    favorites: { type: 'favorites' },
    history: { type: 'history' },
    watching: { type: 'profileList', list: 1 },
    planned: { type: 'profileList', list: 2 },
    completed: { type: 'profileList', list: 3 },
    onHold: { type: 'profileList', list: 4 },
    dropped: { type: 'profileList', list: 5 },
};

type CollectionTabData = TabData & { collections: Collection[] };
type FavoritesTabs = Record<Exclude<ProfilePage, 'collections'>, TabData> & { collections: CollectionTabData };

function createTabs(): FavoritesTabs {
    return {
        collections: { ...emptyTab(), collections: [] },
        favorites: emptyTab(),
        history: emptyTab(),
        watching: emptyTab(),
        planned: emptyTab(),
        completed: emptyTab(),
        onHold: emptyTab(),
        dropped: emptyTab(),
    };
}

export default function FavoritesScreen() {
    const { profileId } = useParams<{ profileId?: string }>();
    return <FavoritesScreenContent key={profileId ?? 'own'} profileId={profileId} />;
}

function FavoritesScreenContent({ profileId }: { profileId?: string }) {
    const { userToken } = useUser();
    const api = useApi();
    const navigate = useNavigate();
    const { settings } = useSettings();
    const { t } = useTranslation();
    const { setSearchScope } = useSearchScope();
    const triggerRef = useRef<HTMLDivElement | null>(null);
    const loadingRequestsRef = useRef(new Set<string>());
    const sortVersionRef = useRef(0);
    const [activePage, setActivePage] = useState<ProfilePage>('favorites');
    const [sort, setSort] = useState<ReleaseSort>('addedDesc');
    const [tabs, setTabs] = useState<FavoritesTabs>(createTabs);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [retryVersion, setRetryVersion] = useState(0);
    const selectedProfileId = Number(profileId);
    const isProfileFavorites = profileId !== undefined;
    const hasValidProfileId = Number.isInteger(selectedProfileId) && selectedProfileId > 0;

    const isCollectionsPage = activePage === 'collections';
    const activeTab = isCollectionsPage ? tabs.collections : tabs[activePage];
    const currentPageIsLoaded = activeTab.loadedPages.includes(activeTab.page);
    const activeItemsCount = isCollectionsPage ? tabs.collections.collections.length : activeTab.releases.length;
    const isInitialLoading = activeTab.isLoading && activeItemsCount === 0;
    const isLoadingMore = activeTab.isLoading && activeItemsCount > 0;

    useEffect(() => {
        setSearchScope(isProfileFavorites ? { type: 'releases' } : SEARCH_SCOPES[activePage]);
        return () => setSearchScope({ type: 'releases' });
    }, [activePage, isProfileFavorites, setSearchScope]);

    const handleSortChange = (nextSort: ReleaseSort) => {
        if (nextSort === sort) return;

        sortVersionRef.current += 1;
        setSort(nextSort);
        setTabs(createTabs());
    };

    useEffect(() => {
        if ((!userToken && !isProfileFavorites) || (isProfileFavorites && !hasValidProfileId)) return;
        if (isCollectionsPage) return;
        if (!activeTab.hasMore || currentPageIsLoaded) return;

        const requestedPage = activeTab.page;
        const sortVersion = sortVersionRef.current;
        const requestKey = `${selectedProfileId || 'own'}:${activePage}:${requestedPage}:${sortVersion}`;
        if (loadingRequestsRef.current.has(requestKey)) return;

        loadingRequestsRef.current.add(requestKey);
        setLoadError(null);
        setTabs(previousTabs => ({
            ...previousTabs,
            [activePage]: {
                ...previousTabs[activePage],
                isLoading: true,
            },
        }));

        getReleasesForTab(activePage as ReleasePage, requestedPage, sort, api, isProfileFavorites ? selectedProfileId : undefined)
            .then(newReleases => {
                if (sortVersion !== sortVersionRef.current) return;

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
                if (sortVersion !== sortVersionRef.current) return;
                console.error('Не удалось загрузить список:', error);
                setLoadError('Не удалось загрузить список. Проверьте соединение и попробуйте снова.');
                setTabs(previousTabs => ({
                    ...previousTabs,
                    [activePage]: {
                        ...previousTabs[activePage],
                        isLoading: false,
                    },
                }));
            })
            .finally(() => loadingRequestsRef.current.delete(requestKey));
    }, [activePage, activeTab.hasMore, activeTab.page, currentPageIsLoaded, sort, userToken, api, hasValidProfileId, isCollectionsPage, isProfileFavorites, selectedProfileId, retryVersion]);

    useEffect(() => {
        if (!userToken || !isCollectionsPage || !activeTab.hasMore || currentPageIsLoaded) return;

        const requestedPage = activeTab.page;
        const requestKey = `collections:${requestedPage}`;
        if (loadingRequestsRef.current.has(requestKey)) return;

        loadingRequestsRef.current.add(requestKey);
        setLoadError(null);
        setTabs(previousTabs => ({
            ...previousTabs,
            collections: { ...previousTabs.collections, isLoading: true },
        }));

        api.get<PagedResponse<Collection>>(`/collectionFavorite/all/${requestedPage}`)
            .then(data => {
                setTabs(previousTabs => {
                    const existingIds = new Set(previousTabs.collections.collections.map(collection => collection.id));
                    const collections = (data.content ?? []).filter(collection => !existingIds.has(collection.id));
                    return {
                        ...previousTabs,
                        collections: {
                            ...previousTabs.collections,
                            collections: [...previousTabs.collections.collections, ...collections],
                            loadedPages: [...previousTabs.collections.loadedPages, requestedPage],
                            isLoading: false,
                            hasMore: collections.length > 0,
                        },
                    };
                });
            })
            .catch(error => {
                console.error('Не удалось загрузить сохранённые коллекции:', error);
                setLoadError('Не удалось загрузить коллекции. Проверьте соединение и попробуйте снова.');
                setTabs(previousTabs => ({
                    ...previousTabs,
                    collections: { ...previousTabs.collections, isLoading: false },
                }));
            })
            .finally(() => loadingRequestsRef.current.delete(requestKey));
    }, [activeTab.hasMore, activeTab.page, api, currentPageIsLoaded, isCollectionsPage, userToken, retryVersion]);

    useEffect(() => {
        if (!currentPageIsLoaded || activeTab.isLoading || !activeTab.hasMore) return;

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
    }, [activePage, activeTab.hasMore, activeTab.isLoading, activeTab.page, currentPageIsLoaded]);

    return (
        <div className={styles.body}>
            {!isProfileFavorites && <div className={styles['side-panel']} role="tablist" aria-label="Разделы профиля">
                {PAGE_ITEMS.map(({ page, buttonText, label }) => (
                    <button
                        key={page}
                        role="tab"
                        aria-selected={activePage === page}
                        className={activePage === page ? styles.active : ''}
                        onClick={() => setActivePage(page)}
                    >
                        {label ?? t(buttonText)}
                    </button>
                ))}
            </div>}

            <div className={styles.content}>
                {isProfileFavorites && <h1>Избранное</h1>}
                {!isCollectionsPage && <div className={styles['sort-toolbar']}>
                    <SortSelect value={sort} onChange={handleSortChange} />
                </div>}
                {loadError && <div className={styles.error} role="alert"><span>{loadError}</span><button type="button" onClick={() => { setLoadError(null); setRetryVersion(version => version + 1); }}>Попробовать снова</button></div>}
                {!loadError && !isInitialLoading && activeItemsCount === 0 && <p className={styles.empty}>Здесь пока ничего нет.</p>}
                {isCollectionsPage ? <div className={styles.collectionsGrid}>
                    {tabs.collections.collections.map(collection => <CollectionCard key={collection.id} collection={collection} />)}
                    <div ref={triggerRef} style={{ height: '20px', background: 'transparent' }} />
                    {isLoadingMore && <div className={styles['loading-more']} role="status">{t('misc.loading')}</div>}
                </div> : <div className={`${styles['releases-grid']} ${settings.appearance.defaultCardType === 'horizontal' ? styles['horizontal-grid'] : ''}`}>
                    {activeTab.releases.map(anime => (
                        settings.appearance.defaultCardType === 'vertical'
                            ? <AnimeCard key={anime.id} anime={anime} />
                            : <AnimeCardHorizontal key={anime.id} anime={anime} />
                    ))}
                    <div ref={triggerRef} style={{ height: '20px', background: 'transparent' }} />
                    {isLoadingMore && <div className={styles['loading-more']} role="status">{t('misc.loading')}</div>}
                </div>
                }
            </div>

            {isInitialLoading && <div className={styles['loading-overlay']} role="status" aria-label={t('misc.loading')} />}
            {!userToken && !isProfileFavorites && <div className={styles['auth-overlay']} role="dialog" aria-modal="true" aria-label={t('auth.login')}>
                <div className={styles['auth-card']}>
                    <h2>{t('auth.loginTitle')}</h2>
                    <p>{t('release.loginToChangeStatus')}</p>
                    <button type="button" onClick={() => navigate('/account/login')}>{t('auth.login')}</button>
                </div>
            </div>}
        </div>
    );
}

async function getReleasesForTab(page: ReleasePage, currentPage: number, sort: ReleaseSort, api: ReturnType<typeof useApi>, profileId?: number): Promise<Anime[]> {
    const query = `extended_mode=true&sort=${API_SORT_VALUES[sort]}`;
    const path = profileId
        ? `/profile/list/all/${profileId}/0/${currentPage}?${query}`
        : page === 'favorites'
        ? `/favorite/all/${currentPage}?${query}`
        : page === 'history'
            ? `/history/${currentPage}?${query}`
            : `/profile/list/all/${PROFILE_LIST_IDS[page]}/${currentPage}?${query}`;

    const data = await api.get<{ code: number; content?: Array<Anime | { release: Anime }>; history?: Array<Anime | { release: Anime }> }>(path);
    const content = data.content ?? data.history ?? [];
    return content.map((item: Anime | { release: Anime }) => 'release' in item ? item.release : item);
}
