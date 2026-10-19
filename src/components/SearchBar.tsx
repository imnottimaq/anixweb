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
    const searchRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
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
        setIsSearchOpen(false);
        window.requestAnimationFrame(() => inputRef.current?.focus());
    }, []);

    const collapseSearch = useCallback(() => {
        setQuery('');
        setResult(undefined);
        setIsSearchOpen(false);
        setIsExpanded(false);
    }, []);

    useEffect(() => {
        if (!isExpanded) return;

        const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
        return () => window.cancelAnimationFrame(frame);
    }, [isExpanded]);

    useEffect(() => {
        if (!isExpanded) return;

        const handlePointerDown = (event: MouseEvent) => {
            if (!searchRef.current?.contains(event.target as Node)) collapseSearch();
        };
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') collapseSearch();
        };

        document.addEventListener('mousedown', handlePointerDown);
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('mousedown', handlePointerDown);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [collapseSearch, isExpanded]);

    useEffect(() => {
        if (previousPathname.current !== pathname) collapseSearch();
        previousPathname.current = pathname;
    }, [collapseSearch, pathname]);

    const setHistory = (query: string) => {
        const value = query.trim();
        if (!value) return;

        try {
            const stored: unknown = JSON.parse(localStorage.getItem('search_history') ?? '[]');
            const oldHistory = Array.isArray(stored) ? stored.filter((item): item is string => typeof item === 'string') : [];
            const nextHistory = [value, ...oldHistory.filter(i => i.toLowerCase() !== value.toLowerCase())].slice(0, 10);
            localStorage.setItem('search_history', JSON.stringify(nextHistory));
        } catch { /* Unavailable or malformed history must not turn a successful search into an error. */ }
    }

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
    }, [api, isExpanded, isFeed, query, searchKey, searchScope, settings.content.proxySearchThroughShikimori, retryIndex])

    const isProfileSearch = searchScope.type === 'profiles';
    const isCollectionSearch = searchScope.type === 'collections';
    const searchLabel = isFeed ? t('feed.search') : isProfileSearch ? t('search.users') : isCollectionSearch ? t('nav.collections') : t('search.anime');
    const profileResults = searchResults && 'profiles' in searchResults ? searchResults.profiles : [];
    const collectionResults = searchResults && 'collections' in searchResults ? searchResults.collections : [];
    const releaseResults = searchResults && 'releases' in searchResults ? searchResults : undefined;

    return (
        <div ref={searchRef} className={`${styles.search} ${isExpanded ? styles.expanded : ''}`}>
            {!isExpanded || isFeed ? <button
                type="button"
                className={styles['search-trigger']}
                onClick={() => {
                    if (!isFeed) { setIsExpanded(true); return; }
                    const field = document.getElementById('feed-search-input');
                    if (field instanceof HTMLInputElement) { field.scrollIntoView({ block: 'center' }); field.focus(); }
                    else navigate('/feed?search=1', { state: feedChildState(location) });
                }}
                aria-label={searchLabel}
                title={searchLabel}
                aria-expanded="false"
            >
                <img className={styles['search-icon']} src={SearchIcon} alt="" />
            </button> : <label className={styles['search-field']}>
                <img className={styles['search-icon']} src={SearchIcon} alt="" />
                <input
                    ref={inputRef}
                    value={query}
                    onChange={e => {
                        const value = e.target.value;
                        setQuery(value);
                        setIsSearchOpen(Boolean(value.trim()));
                        if (!value.trim()) {
                            setResult(undefined);
                        }
                    }}
                    placeholder={searchLabel}
                    aria-label={searchLabel}
                />
                {query && <button
                    type="button"
                    className={styles['clear-button']}
                    onClick={clearSearch}
                    aria-label={t('search.clear')}
                >×</button>}
            </label>}
            {!isFeed && isSearchOpen && <div className={styles['search-overlay']} onMouseDown={event => {
                if (event.target === event.currentTarget) collapseSearch();
            }}>
                <div className={styles['search-content']}>
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
