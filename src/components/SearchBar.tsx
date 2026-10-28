import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./SearchBar.module.css"
import { type Anime, type Collection, type PagedResponse } from "../shared/types/api";
import { useLocation, useNavigate } from "react-router-dom";
import { useSettings } from "../shared/contexts/settingsContext";
import { useSearchScope, type SearchScope } from "../shared/contexts/searchContext";
import AnimeCard from "./AnimeCard";
import AnimeCardHorizontal from "./AnimeCardHorizontal";
import SearchIcon from "../assets/icons/search.svg";
import RemoteImage from './RemoteImage';
import { useTranslation } from '../shared/useTranslation';
import { useApi } from '../shared/apiClient';
import { feedChildState } from '../shared/feedNavigationState';

interface ReleaseSearchResponse{
  code: number;
  related? : {
    id: number,
    name: string,
    name_ru: string,
    description: string,
    image?: string,
    images: string[],
    release_count: number,
  }
  releases: Anime[];
}

interface SearchProfile {
    id: number;
    login: string;
    avatar: string | null;
    status: string | null;
    rating_score: number | null;
}

type ProfileSearchResponse = PagedResponse<SearchProfile> & { profiles: SearchProfile[] };
type CollectionSearchResponse = PagedResponse<Collection> & { collections: Collection[] };

type SearchResults = ReleaseSearchResponse | ProfileSearchResponse | CollectionSearchResponse;

export default function SearchButton(){
    const [query, setQuery] = useState('');
    const [result, setResult] = useState<{
        key: string;
        api: ReturnType<typeof useApi>;
        data?: SearchResults;
        error?: boolean;
        loading: boolean;
    }>();
    const [retryIndex, setRetryIndex] = useState(0);
    const {settings} = useSettings()
    const { t } = useTranslation();
    const { searchScope } = useSearchScope();
    const api = useApi();
    const [isSearchOpen, setIsSearchOpen] = useState(false);
    const [isExpanded, setIsExpanded] = useState(false);
    const [recentSearches, setRecentSearches] = useState<string[]>(() => {
        try {
            const stored: unknown = JSON.parse(localStorage.getItem('search_history') ?? '[]');
            return Array.isArray(stored) ? stored.filter((item): item is string => typeof item === 'string') : [];
        } catch {
            return [];
        }
    });
    const searchRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const restoreTriggerFocus = useRef(false);
    const searchKey = JSON.stringify([query.trim(), searchScope, settings.content.proxySearchThroughShikimori]);
    const currentResult = result?.key === searchKey && result.api === api ? result : undefined;
    const searchResults = currentResult?.data;
    const isLoading = isExpanded && Boolean(query.trim()) && (!currentResult || currentResult.loading);

    const navigate = useNavigate()
    const location = useLocation();
    const { pathname } = location;
    const isFeed = /^\/feed(?:\/|$)/.test(pathname);
    const previousPathname = useRef(pathname);

    const clearSearch = useCallback(() => {
        setQuery('');
        setResult(undefined);
        setIsSearchOpen(true);
        window.requestAnimationFrame(() => inputRef.current?.focus());
    }, []);

    const collapseSearch = useCallback(() => {
        restoreTriggerFocus.current = false;
        setQuery('');
        setResult(undefined);
        setIsSearchOpen(false);
        setIsExpanded(false);
    }, []);

    const dismissSearch = useCallback(() => {
        collapseSearch();
        restoreTriggerFocus.current = true;
    }, [collapseSearch]);

    useEffect(() => {
        const handleGlobalKeyDown = (event: KeyboardEvent) => {
            const isCmdK = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k';
            const activeEl = document.activeElement;
            const isEditable = activeEl instanceof HTMLInputElement ||
                activeEl instanceof HTMLTextAreaElement ||
                activeEl instanceof HTMLSelectElement ||
                (activeEl instanceof HTMLElement && activeEl.isContentEditable);
            const isSlash = event.key === '/' && !isEditable && !event.ctrlKey && !event.metaKey && !event.altKey;

            if (isCmdK || isSlash) {
                event.preventDefault();
                if (isFeed) {
                    const field = document.getElementById('feed-search-input');
                    if (field instanceof HTMLInputElement) {
                        field.scrollIntoView({ block: 'center' });
                        field.focus();
                    } else {
                        navigate('/feed?search=1', { state: feedChildState(location) });
                    }
                    return;
                }
                setIsExpanded(true);
                setIsSearchOpen(true);
                window.requestAnimationFrame(() => {
                    inputRef.current?.focus();
                    inputRef.current?.select();
                });
            }
        };

        window.addEventListener('keydown', handleGlobalKeyDown);
        return () => window.removeEventListener('keydown', handleGlobalKeyDown);
    }, [isFeed, location, navigate]);

    useEffect(() => {
        if (!isExpanded && !restoreTriggerFocus.current) return;
        const frame = window.requestAnimationFrame(() => {
            if (isExpanded) inputRef.current?.focus();
            else if (restoreTriggerFocus.current) triggerRef.current?.focus();
            restoreTriggerFocus.current = false;
        });
        return () => window.cancelAnimationFrame(frame);
    }, [isExpanded]);

    useEffect(() => {
        if (!isExpanded) return;

        const handlePointerDown = (event: MouseEvent) => {
            if (!searchRef.current?.contains(event.target as Node)) collapseSearch();
        };
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                dismissSearch();
            }
        };

        document.addEventListener('mousedown', handlePointerDown);
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('mousedown', handlePointerDown);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [collapseSearch, dismissSearch, isExpanded]);

    useEffect(() => {
        if (previousPathname.current !== pathname) collapseSearch();
        previousPathname.current = pathname;
    }, [collapseSearch, pathname]);

    const setHistory = useCallback((newQuery: string) => {
        const value = newQuery.trim();
        if (!value) return;

        try {
            const stored: unknown = JSON.parse(localStorage.getItem('search_history') ?? '[]');
            const oldHistory = Array.isArray(stored) ? stored.filter((item): item is string => typeof item === 'string') : [];
            const nextHistory = [value, ...oldHistory.filter(i => i.toLowerCase() !== value.toLowerCase())].slice(0, 10);
            localStorage.setItem('search_history', JSON.stringify(nextHistory));
            setRecentSearches(nextHistory);
        } catch { /* Unavailable or malformed history must not turn a successful search into an error. */ }
    }, []);

    const clearAllHistory = useCallback(() => {
        try {
            localStorage.removeItem('search_history');
        } catch { /* ignore */ }
        setRecentSearches([]);
    }, []);

    const removeHistoryItem = useCallback((itemToRemove: string) => {
        try {
            const stored: unknown = JSON.parse(localStorage.getItem('search_history') ?? '[]');
            const oldHistory = Array.isArray(stored) ? stored.filter((item): item is string => typeof item === 'string') : [];
            const nextHistory = oldHistory.filter(i => i !== itemToRemove);
            localStorage.setItem('search_history', JSON.stringify(nextHistory));
            setRecentSearches(nextHistory);
        } catch { /* ignore */ }
    }, []);

    useEffect(() => {
        const value = query.trim();
        if (!value || !isExpanded || isFeed) return;

        let isCurrent = true;
        const controller = new AbortController();
        const timer = window.setTimeout(() => {
            setResult({ key: searchKey, api, loading: true });
            GetSearchResults(value, searchScope, api, settings.content.proxySearchThroughShikimori, controller.signal)
                .then(data => {
                    if (!isCurrent) return;
                    setIsSearchOpen(true);
                    setResult({ key: searchKey, api, data, loading: false });
                    setHistory(value);
                })
                .catch(() => {
                    if (isCurrent) setResult({ key: searchKey, api, error: true, loading: false });
                });
        }, 500)

        return () => {
            isCurrent = false;
            controller.abort();
            window.clearTimeout(timer);
        };
    }, [api, isExpanded, isFeed, query, searchKey, searchScope, settings.content.proxySearchThroughShikimori, retryIndex, setHistory]);

    const isProfileSearch = searchScope.type === 'profiles';
    const isCollectionSearch = searchScope.type === 'collections';
    const searchLabel = isFeed ? t('feed.search') : isProfileSearch ? t('search.users') : isCollectionSearch ? t('search.collections') : t('search.anime');
    const profileResults = searchResults && 'profiles' in searchResults ? searchResults.profiles : [];
    const collectionResults = searchResults && 'collections' in searchResults ? searchResults.collections : [];
    const releaseResults = searchResults && 'releases' in searchResults ? searchResults : undefined;
    const resultCount = isProfileSearch ? profileResults.length : isCollectionSearch ? collectionResults.length : releaseResults?.releases.length ?? 0;
    const searchStatus = !isFeed && isExpanded && query.trim()
        ? currentResult?.loading ? t('search.waiting')
            : searchResults ? resultCount ? t('search.resultCount', { count: resultCount }) : t('search.empty') : ''
        : '';

    return (
        <div ref={searchRef} className={`${styles.search} ${isExpanded ? styles.expanded : ''}`}>
            {!isExpanded || isFeed ? <button
                ref={triggerRef}
                type="button"
                className={styles['search-trigger']}
                onClick={() => {
                    if (!isFeed) {
                        setIsExpanded(true);
                        setIsSearchOpen(true);
                        return;
                    }
                    const field = document.getElementById('feed-search-input');
                    if (field instanceof HTMLInputElement) { field.scrollIntoView({ block: 'center' }); field.focus(); }
                    else navigate('/feed?search=1', { state: feedChildState(location) });
                }}
                aria-label={searchLabel}
                title={searchLabel}
                aria-expanded="false"
            >
                <img className={styles['search-icon']} src={SearchIcon} alt="" />
                <span className={styles['trigger-label']}>{searchLabel}</span>
                <kbd className={styles['hotkey-badge']}>⌘K</kbd>
            </button> : <label className={styles['search-field']}>
                <img className={styles['search-icon']} src={SearchIcon} alt="" />
                <input
                    ref={inputRef}
                    value={query}
                    onFocus={() => setIsSearchOpen(true)}
                    onChange={e => {
                        const value = e.target.value;
                        setQuery(value);
                        setIsSearchOpen(true);
                        if (!value.trim()) {
                            setResult(undefined);
                        }
                    }}
                    placeholder={searchLabel}
                    aria-label={searchLabel}
                />
                {query ? (
                    <button
                        type="button"
                        className={styles['clear-button']}
                        onClick={clearSearch}
                        aria-label={t('search.clear')}
                    >×</button>
                ) : (
                    <button
                        type="button"
                        className={styles['clear-button']}
                        onClick={dismissSearch}
                        aria-label={t('misc.close')}
                    >×</button>
                )}
            </label>}
            <span className={styles['search-status']} role={isExpanded && query.trim() ? 'status' : undefined} aria-live="polite" aria-atomic="true">{searchStatus}</span>
            {!isFeed && isSearchOpen && <div className={styles['search-overlay']} onMouseDown={event => {
                if (event.target === event.currentTarget) dismissSearch();
            }}>
                <div className={styles['search-content']}>
                    {!isLoading && !query.trim() && (
                        <div className={styles['recent-searches']}>
                            <div className={styles['recent-header']}>
                                <span className={styles['recent-title']}>
                                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                                        <circle cx="12" cy="12" r="10" />
                                        <polyline points="12 6 12 12 16 14" />
                                    </svg>
                                    {t('search.recentSearches')}
                                </span>
                                {recentSearches.length > 0 && (
                                    <button
                                        type="button"
                                        className={styles['clear-history-btn']}
                                        onClick={clearAllHistory}
                                    >
                                        {t('search.clearHistory')}
                                    </button>
                                )}
                            </div>
                            {recentSearches.length > 0 ? (
                                <div className={styles['recent-tags']} role="list">
                                    {recentSearches.map(item => (
                                        <div key={item} className={styles['recent-tag']} role="listitem">
                                            <button
                                                type="button"
                                                className={styles['recent-tag-btn']}
                                                onClick={() => {
                                                    setQuery(item);
                                                    setIsSearchOpen(true);
                                                    inputRef.current?.focus();
                                                }}
                                            >
                                                {item}
                                            </button>
                                            <button
                                                type="button"
                                                className={styles['recent-tag-remove']}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    removeHistoryItem(item);
                                                }}
                                                aria-label={`Удалить ${item}`}
                                            >×</button>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <p className={styles.message}>{t('search.waiting')}</p>
                            )}
                        </div>
                    )}
                    {isLoading && <p className={styles.message}>{t('search.waiting')}</p>}
                    {currentResult?.error && <div className={styles.message} role="alert">
                        <p>{t('search.error')}</p>
                        <button type="button" onClick={() => { setResult(undefined); setRetryIndex(index => index + 1); }}>{t('page.retry')}</button>
                    </div>}
                    {!isLoading && releaseResults?.related && <button type="button" className={styles['related-release']} onClick={() => {
                        collapseSearch();
                        navigate(`/franchise/${releaseResults.related?.id || 0}`, { state: { franchise: releaseResults.related } });
                    }}>
                        <span className={styles['related-posters']} aria-hidden="true">
                            {[...releaseResults.related.images].slice(0, 3).reverse().map((image) => (
                                <RemoteImage key={image} src={image} alt="" />
                            ))}
                        </span>
                        <span className={styles['related-info']}>
                            <strong>{releaseResults.related.name_ru}</strong>
                            <small>{releaseResults.related.release_count} {t('search.franchiseReleases')}</small>
                            <small>{releaseResults.related.description}</small>
                        </span>
                    </button>}
                    {!isLoading && releaseResults && <div className={`${styles.results} ${settings.appearance.defaultCardType === 'horizontal' ? styles['horizontal-results'] : ''}`}>
                        {releaseResults.releases.map(item => (
                            <div key={item.id} onClick={collapseSearch}>
                                {settings.appearance.defaultCardType === 'vertical'
                                    ? <AnimeCard key={item.id} anime={item} />
                                    : <AnimeCardHorizontal key={item.id} anime={item} />}</div>
                        ))}
                    </div>}
                    {!isLoading && isProfileSearch && profileResults.length > 0 && <div className={styles['profile-results']}>
                        {profileResults.map(profile => (
                            <button key={profile.id} type="button" className={styles['profile-result']} onClick={() => {
                                collapseSearch();
                                navigate(`/account/${profile.id}`);
                            }}>
                                {profile.avatar
                                    ? <RemoteImage src={profile.avatar} alt="" />
                                    : <span className={styles['profile-avatar-placeholder']}>{profile.login[0]?.toUpperCase()}</span>}
                                <span className={styles['profile-info']}>
                                    <strong>{profile.login}</strong>
                                    {profile.status && <small>{profile.status}</small>}
                                </span>
                                {typeof profile.rating_score === 'number' && <span className={styles['profile-rating']}>{profile.rating_score}</span>}
                            </button>
                        ))}
                    </div>}
                    {!isLoading && isCollectionSearch && collectionResults.length > 0 && <div className={styles['collection-results']}>
                        {collectionResults.map(collection => <button key={collection.id} type="button" className={styles['collection-result']} onClick={() => {
                            collapseSearch();
                            navigate(`/collection/${collection.id}`);
                        }}>
                            <RemoteImage src={collection.image} alt="" />
                            <span className={styles['collection-info']}>
                                <strong>{collection.title}</strong>
                                <small>{collection.description?.trim() || t('release.noDescription')}</small>
                            </span>
                            <span className={styles['collection-footer']}>
                                <span className={styles['collection-creator']}>
                                    <RemoteImage src={collection.creator.avatar} alt="" />
                                    <span>{collection.creator.login}</span>
                                </span>
                                <span className={styles['collection-stats']}>{t('search.collectionStats', { comments: collection.comment_count, favorites: collection.favorites_count })}</span>
                            </span>
                        </button>)}
                    </div>}
                    {!isLoading && searchResults && (isProfileSearch ? profileResults.length === 0 : isCollectionSearch ? collectionResults.length === 0 : releaseResults?.releases.length === 0) && <p className={styles.message}>{t('search.empty')}</p>}
                </div>
            </div>}
        </div>
    )
}

async function GetSearchResults(
    query: string,
    searchScope: SearchScope,
    api: ReturnType<typeof useApi>,
    useShikimoriProxy: boolean,
    signal: AbortSignal,
): Promise<SearchResults> {
    const endpoint = searchScope.type === 'profiles'
        ? '/search/profiles/0'
        : searchScope.type === 'collections'
            ? '/search/collections/0'
        : searchScope.type === 'favorites'
            ? '/search/favorites/0'
            : searchScope.type === 'history'
                ? '/search/history/0'
                : searchScope.type === 'profileList'
                    ? `/search/profile/list/${searchScope.list}/0`
                    : '/search/releases/0';
    const searchQuery = useShikimoriProxy && searchScope.type === 'releases'
        ? await getShikimoriSearchQuery(query, signal)
        : query;

    const data = await api.post<{
        code: number;
        related?: ReleaseSearchResponse['related'];
        releases?: Anime[];
        profiles?: SearchProfile[];
        collections?: Collection[];
        content?: Anime[] | SearchProfile[] | Collection[];
        total_count?: number;
        total_page_count?: number;
        current_page?: number;
    }>(endpoint, { query: searchQuery, searchBy: 0 }, { 'Api-Version': 'v2' }, { signal });
    if (data.code === 0) {
        if (searchScope.type === 'profiles') {
            const profiles = (data.profiles ?? data.content ?? []) as SearchProfile[];
            return {
                code: data.code,
                content: profiles,
                profiles,
                total_count: data.total_count ?? 0,
                total_page_count: data.total_page_count ?? 0,
                current_page: data.current_page ?? 0,
            };
        }
        if (searchScope.type === 'collections') {
            const collections = (data.collections ?? data.content ?? []) as Collection[];
            return {
                code: data.code,
                content: collections,
                collections,
                total_count: data.total_count ?? 0,
                total_page_count: data.total_page_count ?? 0,
                current_page: data.current_page ?? 0,
            };
        }
        return {
            code: data.code,
            related: data.related,
            releases: (data.releases ?? data.content ?? []) as Anime[],
        };
    }
    throw new Error("Error while performing search: " + data.code)
}

type ShikimoriSearchResponse = {
    data?: {
        animes?: Array<{
            name?: string | null;
            russian?: string | null;
        }>;
    };
    errors?: Array<{ message?: string }>;
};

async function getShikimoriSearchQuery(query: string, signal: AbortSignal) {
    try {
        const response = await fetch('https://shikimori.one/api/graphql', {
            method: 'POST',
            signal,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                query: `query SearchAnime($search: String!) {
                    animes(search: $search, limit: 1) { name russian }
                }`,
                variables: { search: query },
            }),
        });

        if (!response.ok) return query;

        const data = await response.json() as ShikimoriSearchResponse;
        const anime = data.data?.animes?.[0];
        return anime?.russian?.trim() || anime?.name?.trim() || query;
    } catch {
        signal.throwIfAborted();
        return query;
    }
}
