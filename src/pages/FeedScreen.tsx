import { FeedBack, FeedLink as Link } from '../shared/feedNavigation';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { PageHeader, PageLayout } from '../components/PageLayout';
import PageState from '../components/PageState';
import { FeedArticleCard, FeedChannelCard } from '../components/FeedContent';
import { useApi } from '../shared/apiClient';
import { useUser } from '../shared/contexts/userContext';
import { loadFeed, loadFeedChannelSearch, loadFeedRecommendations, loadFeedSearch, type FeedChannel, type FeedPage, type FeedSource } from '../shared/feed';
import { useFeedPages } from '../shared/useFeedPages';
import { useAsyncLoad } from '../shared/useAsyncLoad';
import { useTranslation } from '../shared/useTranslation';
import styles from '../components/FeedContent.module.css';
import shell from './FeedShell.module.css';
import { FeedIcon } from '../components/FeedIcons';
import FeedNavigation from '../components/FeedNavigation';
import { useFeedMemoryKey, useFeedPosition } from '../shared/useFeedNavigation';

type SearchGroups = { channels?: FeedPage<FeedChannel>; blogs?: FeedPage<FeedChannel> };
const searchMemory = new Map<string, { groups: SearchGroups; tags: string[] }>();

function FeedSearchForm({ query, personal, date }: { query: string; personal: boolean; date: number }) {
    const [value, setValue] = useState(query);
    const [params, setParams] = useSearchParams();
    const location = useLocation();
    const { t } = useTranslation();
    const clearParams = new URLSearchParams(params);
    clearParams.delete('q');
    const submit = (event: FormEvent) => {
        event.preventDefault();
        const params: Record<string, string> = personal ? { tab: 'my' } : {};
        if (personal && date) params.date = String(date);
        if (value.trim()) params.q = value.trim();
        const searching = new URLSearchParams(location.search).has('search');
        if (searching) params.search = '1';
        setParams(params, { state: location.state, replace: searching });
    };
    return <form role="search" className={shell.searchForm} onSubmit={submit}>
        <div className={shell.searchInput}><FeedIcon name="search" size={19} /><input id="feed-search-input" autoFocus={params.has('search')} type="search" value={value} maxLength={200} onChange={event => setValue(event.target.value)} placeholder={t('feed.search')} aria-label={t('feed.search')} /></div>
        <button type="submit">{t('feed.find')}</button>
        {query && <Link to={`/feed${clearParams.toString() ? `?${clearParams}` : ''}`}>{t('feed.clear')}</Link>}
    </form>;
}

export function FeedRecommendations() {
    const api = useApi();
    const { t } = useTranslation();
    const { data, isLoading, error, reload } = useAsyncLoad(signal => loadFeedRecommendations(api, signal), [api]);
    return <section className={styles.section} aria-label={t('feed.recommended')}>
        <h2>{t('feed.recommended')}</h2>
        {isLoading ? <PageState status="loading" /> : error ? <PageState status="error" onRetry={reload} /> : <div className={styles.channels}>{data?.content.map(channel => <FeedChannelCard key={channel.id} channel={channel} />)}</div>}
    </section>;
}

export function FeedList({ source }: { source: FeedSource }) {
    const api = useApi();
    const { t } = useTranslation();
    const kind = source.kind, id = source.kind === 'channel' ? source.id : undefined, date = source.kind === 'personal' ? source.date : undefined;
    const request = useCallback((page: number, signal: AbortSignal) => loadFeed(api, kind === 'channel' ? { kind, id: id! } : kind === 'personal' ? { kind, date } : { kind }, page, signal), [api, kind, id, date]);
    const state = useFeedPages(request, useFeedMemoryKey(`stream:${kind}:${id ?? ''}:${date ?? ''}`));
    useFeedPosition(!state.loading);
    const [newPosts, setNewPosts] = useState(false);
    const firstId = state.items[0]?.id;
    useEffect(() => {
        if (kind !== 'latest' || !firstId) return;
        const controller = new AbortController();
        let polling = false;
        const timer = window.setInterval(() => {
            if (document.visibilityState === 'hidden' || polling) return;
            polling = true;
            void api.get<{ code: number; articleId?: number }>('/feed/latest', { signal: controller.signal, cache: 'no-store' }).then(result => {
                if (!controller.signal.aborted && result.code === 0 && Number.isSafeInteger(result.articleId) && result.articleId! > firstId) setNewPosts(true);
            }).catch(() => {}).finally(() => { polling = false; });
        }, 60000);
        return () => { window.clearInterval(timer); controller.abort(); };
    }, [api, kind, firstId]);
    return <>
        <div className={shell.refreshBar}><button className={`${shell.refresh} ${newPosts ? shell.newPosts : ''}`} type="button" disabled={state.loading || state.moreLoading} onClick={() => { setNewPosts(false); state.retry(); }}><FeedIcon name="refresh" size={15} />{t(newPosts ? 'feed.newPosts' : 'feed.refresh')}</button></div>
        {state.loading && <PageState status="loading" message={t('feed.loading')} />}
        {!state.loading && state.error && state.items.length === 0 && <PageState status="error" message={t('feed.error')} onRetry={state.retry} />}
        {!state.loading && !state.error && state.items.length === 0 && <>
            <PageState status="empty" message={t(kind === 'personal' ? 'feed.noSubscriptions' : 'feed.empty')} />
            {kind === 'personal' && <FeedRecommendations />}
        </>}
        <div className={styles.stream}>{state.items.map(article => <FeedArticleCard key={article.id} article={article} />)}</div>
        {state.items.length > 0 && state.error && <PageState status="error" message={t('feed.error')} onRetry={state.retryError} />}
        {state.hasMore && <button type="button" className={styles.more} onClick={() => void state.more()} disabled={state.moreLoading}>{t(state.moreLoading ? 'feed.loading' : 'feed.more')}</button>}
    </>;
}

function SearchChannels({ query, blog, initial }: { query: string; blog: boolean; initial: FeedPage<FeedChannel> }) {
    const api = useApi();
    const { t } = useTranslation();
    const request = useCallback((index: number, signal: AbortSignal) => index === 0 ? Promise.resolve(initial) : loadFeedChannelSearch(api, query, blog, index, signal), [api, query, blog, initial]);
    const state = useFeedPages(request, useFeedMemoryKey(`searchChannels:${blog}:${query}`));
    return <section className={styles.section} aria-label={t(blog ? 'feed.blogs' : 'feed.channels')}>
        <h2>{t(blog ? 'feed.blogs' : 'feed.channels')}</h2>
        <div className={styles.channels}>{state.items.map(channel => <FeedChannelCard key={channel.id} channel={channel} />)}</div>
        {state.error && <PageState status="error" onRetry={state.retryError} />}
        {state.hasMore && <button type="button" className={styles.more} disabled={state.moreLoading} onClick={() => void state.more()}>{t('feed.more')}</button>}
    </section>;
}

function SearchResults({ query }: { query: string }) {
    const api = useApi();
    const { t } = useTranslation();
    const memoryKey = useFeedMemoryKey(`search:${query}`);
    const [groups, setGroups] = useState<SearchGroups>(() => searchMemory.get(memoryKey)?.groups ?? {});
    const [tags, setTags] = useState<string[]>(() => searchMemory.get(memoryKey)?.tags ?? []);
    const request = useCallback(async (index: number, signal: AbortSignal) => {
        const result = await loadFeedSearch(api, query, index, signal);
        if (!signal.aborted && index === 0) {
            const nextGroups = { channels: result.channels, blogs: result.blogs };
            setGroups(nextGroups); setTags(result.tags.content);
            searchMemory.set(memoryKey, { groups: nextGroups, tags: result.tags.content });
            if (searchMemory.size > 30) searchMemory.delete(searchMemory.keys().next().value!);
        }
        return result.articles;
    }, [api, query, memoryKey]);
    const state = useFeedPages(request, memoryKey);
    useFeedPosition(!state.loading);
    return <section aria-label={t('feed.searchResults', { query })}>
        <h2>{t('feed.searchResults', { query })}</h2>
        {state.loading && <PageState status="loading" />}
        {tags.length > 0 && <nav className={styles.actions} aria-label={t('feed.tags')}>{tags.map(tag => <Link key={tag} to={`/feed?q=${encodeURIComponent(`#${tag}`)}`}>#{tag}</Link>)}</nav>}
        {state.error && <PageState status="error" message={t('feed.error')} onRetry={state.retryError} />}
        {!state.loading && !state.error && !state.items.length && !groups.channels?.content.length && !groups.blogs?.content.length && !tags.length && <PageState status="empty" />}
        {(['channels', 'blogs'] as const).map(group => groups[group] && groups[group].content.length > 0 && <SearchChannels key={group} query={query} blog={group === 'blogs'} initial={groups[group]} />)}
        {state.items.length > 0 && <h2>{t('feed.posts')}</h2>}
        <div className={styles.stream}>{state.items.map(article => <FeedArticleCard key={article.id} article={article} />)}</div>
        {state.hasMore && <button type="button" className={styles.more} onClick={() => void state.more()} disabled={state.moreLoading}>{t(state.moreLoading ? 'feed.loading' : 'feed.more')}</button>}
    </section>;
}

export default function FeedScreen() {
    const location = useLocation();
    const [params, setParams] = useSearchParams();
    const { userToken } = useUser();
    const { t } = useTranslation();
    const personal = params.get('tab') === 'my';
    const query = (params.get('q') ?? '').trim().slice(0, 200);
    const date = /^[0-5]$/.test(params.get('date') ?? '') ? Number(params.get('date')) : 0;
    const key = `${userToken}:${location.key}:${personal}:${query}:${date}`;
    return <PageLayout className={`${styles.page} ${shell.feedHome}`}>
        {params.has('search') && <FeedBack />}
        <PageHeader title={t('feed.title')} actions={userToken && <div className={shell.headerActions}><Link className={shell.compose} to="/feed/compose"><FeedIcon name="edit" />{t('feed.compose')}</Link></div>} />
        <FeedNavigation active={personal ? 'personal' : 'latest'} />
        {userToken && personal && !query && <div className={`${styles.form} ${shell.period}`}><label>{t('feed.period')}<select value={date} onChange={event => setParams({ tab: 'my', date: event.target.value })}>{(['any', 'day', 'week', 'month', 'year', 'allTime'] as const).map((period, index) => <option key={period} value={index}>{t(`feed.period.${period}`)}</option>)}</select></label></div>}
        {userToken && <FeedSearchForm key={`${personal}:${query}`} query={query} personal={personal} date={date} />}
        {!userToken ? <div className={styles.signIn}><PageState status="empty" message={t('feed.signIn')} /><Link to="/account/login">{t('feed.login')}</Link></div> : query ? <SearchResults key={key} query={query} />
            : <FeedList key={key} source={personal ? { kind: 'personal', date } : { kind: 'latest' }} />}
    </PageLayout>;
}
