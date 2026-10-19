import { PageHeader, PageLayout } from '../components/PageLayout';
import PageState from '../components/PageState';
import { useReleaseChanges } from '../shared/contexts/releaseActionsContext';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
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
import TabContextMenu, { type TabContextMenuItem } from '../components/TabContextMenu';
import { FAVORITES_TAB_ORDER } from '../shared/types/settings';
import { normalizeTabOrder } from '../shared/tabOrder';
import { useReorderableTabs } from '../shared/useReorderableTabs';
import TabDragHandle from '../components/TabDragHandle';

type ProfilePage = 'collections' | 'favorites' | 'history' | 'watching' | 'planned' | 'completed' | 'onHold' | 'dropped';
type ReleasePage = Exclude<ProfilePage, 'collections'>;

const PAGE_ITEMS: { page: ProfilePage; buttonText: 'nav.collections' | 'nav.favorites' | 'home.history' | 'status.watching' | 'status.planned' | 'status.watched' | 'status.hold_on' | 'status.dropped'; label?: string }[] = [
    { page: 'collections', buttonText: 'nav.collections' }, { page: 'favorites', buttonText: 'nav.favorites' }, { page: 'history', buttonText: 'home.history' }, { page: 'watching', buttonText: 'status.watching' }, { page: 'planned', buttonText: 'status.planned' }, { page: 'completed', buttonText: 'status.watched' }, { page: 'onHold', buttonText: 'status.hold_on' }, { page: 'dropped', buttonText: 'status.dropped' },
];

const SETTING_BY_FAVORITES_TAB: Record<ProfilePage, 'collections' | 'favorites' | 'history' | 'watching' | 'planned' | 'completed' | 'hold_on' | 'dropped'> = {
    collections: 'collections',
    favorites: 'favorites',
    history: 'history',
    watching: 'watching',
    planned: 'planned',
    completed: 'completed',
    onHold: 'hold_on',
    dropped: 'dropped',
};

const FAVORITES_TAB_BY_SETTING: Record<'collections' | 'favorites' | 'history' | 'watching' | 'planned' | 'completed' | 'hold_on' | 'dropped', ProfilePage> = {
    collections: 'collections',
    favorites: 'favorites',
    history: 'history',
    watching: 'watching',
    planned: 'planned',
    completed: 'completed',
    hold_on: 'onHold',
    dropped: 'dropped',
};

const PROFILE_LIST_IDS: Record<Exclude<ProfilePage, 'collections' | 'history'>, number> = {
    favorites: 0,
    watching: 1,
    planned: 2,
    completed: 3,
    onHold: 4,
    dropped: 5,
};

const EXTERNAL_PROFILE_PAGE_ITEMS = PAGE_ITEMS.filter(({ page }) => page !== 'collections' && page !== 'history');

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
    const { userToken } = useUser();
    const { t } = useTranslation();
    if (!userToken && !profileId) return <PageLayout><PageHeader title={t('nav.favorites')} /><PageState status="empty" message={t('auth.loginTitle')} /><Link className={styles.loginAction} to="/account/login">{t('auth.login')}</Link></PageLayout>;
    return <FavoritesScreenContent key={profileId ?? 'own'} profileId={profileId} />;
}

function FavoritesScreenContent({ profileId }: { profileId?: string }) {
    const { userToken } = useUser();
    const api = useApi();
    const navigate = useNavigate();
    const { settings, setSettings } = useSettings();
    const { t } = useTranslation();
    const { setSearchScope } = useSearchScope();
    const triggerRef = useRef<HTMLDivElement | null>(null);
    const loadingRequestsRef = useRef(new Set<string>());
    const sortVersionRef = useRef(0);
    const [activePage, setActivePage] = useState<ProfilePage>(() => {
        if (profileId) return 'favorites';
        return FAVORITES_TAB_BY_SETTING[settings.content.defaultTabOnFavorites] ?? 'favorites';
    });
    const [tabContextMenu, setTabContextMenu] = useState<{ page: ProfilePage; x: number; y: number; trigger: HTMLElement } | null>(null);
    const [sort, setSort] = useState<ReleaseSort>('addedDesc');
    const [tabs, setTabs] = useState<FavoritesTabs>(createTabs);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [retryVersion, setRetryVersion] = useState(0);
    const selectedProfileId = Number(profileId);
    const isProfileFavorites = profileId !== undefined;
    const orderedItems = isProfileFavorites ? EXTERNAL_PROFILE_PAGE_ITEMS : normalizeTabOrder(settings.content.favoritesTabOrder, FAVORITES_TAB_ORDER).map(key => PAGE_ITEMS.find(item => item.page === FAVORITES_TAB_BY_SETTING[key])!);
    const reorder = useReorderableTabs(orderedItems.map(item => item.page), order => setSettings(previous => ({ ...previous, content: { ...previous.content, favoritesTabOrder: order.map(page => SETTING_BY_FAVORITES_TAB[page]) } })), page => t(PAGE_ITEMS.find(item => item.page === page)!.buttonText));
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

    useReleaseChanges(useCallback(() => {
        if (isProfileFavorites) return;
        sortVersionRef.current += 1;
        setTabs(createTabs());
    }, [isProfileFavorites]));

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
                setLoadError(t('favorites.loadError'));
                setTabs(previousTabs => ({
                    ...previousTabs,
                    [activePage]: {
                        ...previousTabs[activePage],
                        isLoading: false,
                    },
                }));
            })
            .finally(() => loadingRequestsRef.current.delete(requestKey));
    }, [activePage, activeTab.hasMore, activeTab.page, currentPageIsLoaded, sort, userToken, api, hasValidProfileId, isCollectionsPage, isProfileFavorites, selectedProfileId, retryVersion, t]);

    useEffect(() => {
        if ((!userToken && !isProfileFavorites) || !isCollectionsPage || !activeTab.hasMore || currentPageIsLoaded) return;

        const requestedPage = activeTab.page;
        const requestKey = `${isProfileFavorites ? `profile-collections:${selectedProfileId}` : 'collections'}:${requestedPage}`;
        if (loadingRequestsRef.current.has(requestKey)) return;

        loadingRequestsRef.current.add(requestKey);
        setLoadError(null);
        setTabs(previousTabs => ({
            ...previousTabs,
            collections: { ...previousTabs.collections, isLoading: true },
        }));

        const path = isProfileFavorites
            ? `/collection/all/profile/${selectedProfileId}/${requestedPage}?previous_page=${requestedPage - 1}&sort=5`
            : `/collectionFavorite/all/${requestedPage}`;

        api.get<PagedResponse<Collection>>(path)
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
                console.error('Не удалось загрузить коллекции:', error);
                setLoadError(t('favorites.collectionsLoadError'));
                setTabs(previousTabs => ({
                    ...previousTabs,
                    collections: { ...previousTabs.collections, isLoading: false },
                }));
            })
            .finally(() => loadingRequestsRef.current.delete(requestKey));
    }, [activeTab.hasMore, activeTab.page, api, currentPageIsLoaded, isCollectionsPage, isProfileFavorites, selectedProfileId, userToken, retryVersion, t]);

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
            <div className={styles['side-panel']} role="tablist" aria-label={t('favorites.sectionsAria')}>
                {orderedItems.map(({ page, buttonText }) => (
                    <button
                        {...(!isProfileFavorites ? reorder.props(page) : {})}
                        key={page}
                        role="tab"
                        aria-selected={activePage === page}
                        aria-haspopup={!isProfileFavorites ? 'menu' : undefined}
                        className={`${!isProfileFavorites ? reorder.tabClass : ''} ${activePage === page ? styles.active : ''}`}
                        onClick={() => setActivePage(page)}
                        onContextMenu={!isProfileFavorites ? (e) => {
                            e.preventDefault();
                            setTabContextMenu({
                                page,
                                x: e.clientX,
                                y: e.clientY,
                                trigger: e.currentTarget,
                            });
                        } : undefined}
                        onKeyDown={!isProfileFavorites ? (e) => {
                            if (reorder.onKeyDown(e, page)) return;
                            if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
                                e.preventDefault();
                                const rect = e.currentTarget.getBoundingClientRect();
                                setTabContextMenu({
                                    page,
                                    x: rect.left + rect.width / 2,
                                    y: rect.bottom,
                                    trigger: e.currentTarget,
                                });
                            }
                        } : undefined}
                    >
                        {t(buttonText)}
                        {!isProfileFavorites && <TabDragHandle />}
                    </button>
                ))}
            </div>

            <span className={reorder.announcementClass} aria-live="polite" aria-atomic="true">{reorder.announcement}</span>

            <div className={styles.content}>
                {isProfileFavorites && <h1>{t('favorites.userLists')}</h1>}
                {!isCollectionsPage && <div className={styles['sort-toolbar']}>
                    <SortSelect value={sort} onChange={handleSortChange} />
                </div>}
                {loadError && <div className={styles.error} role="alert"><span>{loadError}</span><button type="button" onClick={() => { setLoadError(null); setRetryVersion(version => version + 1); }}>{t('page.retry')}</button></div>}
                {!loadError && !isInitialLoading && activeItemsCount === 0 && <p className={styles.empty}>{t('page.empty')}</p>}
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
            {tabContextMenu && (() => {
                const isDefault = settings.content.defaultTabOnFavorites === SETTING_BY_FAVORITES_TAB[tabContextMenu.page];
                const items: TabContextMenuItem[] = [
                    {
                        key: 'make-default',
                        label: isDefault ? t('tabMenu.isDefault') : t('tabMenu.makeDefault'),
                        disabled: isDefault,
                        onClick: () => {
                            const settingValue = SETTING_BY_FAVORITES_TAB[tabContextMenu.page];
                            setSettings(prev => ({
                                ...prev,
                                content: {
                                    ...prev.content,
                                    defaultTabOnFavorites: settingValue,
                                },
                            }));
                        },
                    },
                ];

                const currentTabItem = PAGE_ITEMS.find(item => item.page === tabContextMenu.page);

                return (
                    <TabContextMenu
                        x={tabContextMenu.x}
                        y={tabContextMenu.y}
                        trigger={tabContextMenu.trigger}
                        title={currentTabItem ? t(currentTabItem.buttonText) : undefined}
                        items={items}
                        onClose={() => setTabContextMenu(null)}
                    />
                );
            })()}
        </div>
    );
}

async function getReleasesForTab(page: ReleasePage, currentPage: number, sort: ReleaseSort, api: ReturnType<typeof useApi>, profileId?: number): Promise<Anime[]> {
    const query = `extended_mode=true&sort=${API_SORT_VALUES[sort]}`;
    const path = profileId
        ? `/profile/list/all/${profileId}/${PROFILE_LIST_IDS[page as Exclude<ReleasePage, 'history'>]}/${currentPage}?${query}`
        : page === 'favorites'
        ? `/favorite/all/${currentPage}?${query}`
        : page === 'history'
            ? `/history/${currentPage}?${query}`
            : `/profile/list/all/${PROFILE_LIST_IDS[page]}/${currentPage}?${query}`;

    const data = await api.get<{ code: number; content?: Array<Anime | { release: Anime }>; history?: Array<Anime | { release: Anime }> }>(path);
    const content = data.content ?? data.history ?? [];
    return content.map((item: Anime | { release: Anime }) => 'release' in item ? item.release : item);
}
