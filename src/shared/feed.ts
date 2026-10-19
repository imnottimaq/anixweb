import type { useApi } from './apiClient';
import { updateFeedArticleMemory } from './feedPageMemory';

type Api = ReturnType<typeof useApi>;
export interface FeedChannel {
    id: number;
    title: string;
    description?: string;
    avatar?: string | null;
    cover?: string | null;
    subscriber_count?: number;
    is_blog?: boolean;
    is_verified?: boolean;
    is_subscribed?: boolean;
    is_muted?: boolean;
    is_creator?: boolean;
    is_administrator_or_higher?: boolean;
    is_commenting_enabled?: boolean;
    is_article_suggestion_enabled?: boolean;
    is_blocked?: boolean;
    permission?: number;
    is_episode_channel_widget_enabled?: boolean;
    episode_channel_widget_sort?: number;
    episode_channel_widget_popularity_period?: number;
    episode_channel_widget_article_count?: number;
}
export interface FeedBlock { id?: string; type?: string; name?: string; data?: Record<string, unknown> }
export interface FeedArticle {
    id: number;
    channel: FeedChannel;
    author?: { id: number; login: string } | null;
    payload?: { blocks?: FeedBlock[] } | null;
    creation_date?: number;
    comment_count?: number;
    repost_count?: number;
    vote_count?: number;
    is_pinned?: boolean;
    is_signed?: boolean;
    is_deleted?: boolean;
    vote?: number;
    is_muted?: boolean;
    repost_article?: FeedArticle | null;
}
export interface FeedComment {
    id: number;
    profile: { id: number; login: string; avatar?: string | null };
    message: string;
    timestamp?: number;
    type?: number;
    vote_count?: number;
    reply_count?: number;
    is_spoiler?: boolean;
    is_deleted?: boolean;
    vote?: number;
}
export interface FeedPage<T> { content: T[]; total_count?: number; current_page?: number }
export interface FeedSearch { articles: FeedPage<FeedArticle>; channels: FeedPage<FeedChannel>; blogs: FeedPage<FeedChannel>; tags: FeedPage<string> }
export type FeedSource = { kind: 'latest' } | { kind: 'personal'; date?: number } | { kind: 'channel'; id: number };

function record(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === 'object' && !Array.isArray(value)); }
export function feedId(value: unknown): number | null {
    if (typeof value === 'string' && !/^[1-9]\d*$/.test(value)) return null;
    const id = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
    return Number.isSafeInteger(id) && id > 0 ? id : null;
}
function channel(value: unknown): value is FeedChannel { return record(value) && feedId(value.id) !== null && typeof value.title === 'string'; }
function article(value: unknown): value is FeedArticle { return record(value) && feedId(value.id) !== null && channel(value.channel); }
function comment(value: unknown): value is FeedComment {
    return record(value) && feedId(value.id) !== null && record(value.profile) && feedId(value.profile.id) !== null && typeof value.profile.login === 'string' && typeof value.message === 'string';
}
function page<T>(value: unknown, valid: (item: unknown) => item is T): FeedPage<T> {
    if (!record(value) || value.code !== 0 || !Array.isArray(value.content) || !value.content.every(valid)) throw new Error('Invalid feed response');
    return { content: value.content, current_page: typeof value.current_page === 'number' ? value.current_page : undefined,
        total_count: typeof value.total_count === 'number' ? value.total_count : undefined };
}
function checkedId(id: number) { if (feedId(id) === null) throw new Error('Invalid feed ID'); return id; }
function checkedPage(index: number) { if (!Number.isSafeInteger(index) || index < 0) throw new Error('Invalid feed page'); return index; }

export async function loadFeed(api: Api, source: FeedSource, index: number, signal: AbortSignal): Promise<FeedPage<FeedArticle>> {
    checkedPage(index);
    if (source.kind === 'channel') return page(await api.post(`/channel/${checkedId(source.id)}/article/all/${index}`, undefined, undefined, { signal }), article);
    if (source.kind === 'personal' && index === 0) {
        const count = await api.get<unknown>('/channel/subscription/count', { signal });
        if (!record(count) || count.code !== 0 || !Number.isSafeInteger(count.subscription_count) || Number(count.subscription_count) < 0) throw new Error('Invalid subscription response');
        if (count.subscription_count === 0) return { content: [], total_count: 0 };
    }
    const date = source.kind === 'personal' ? source.date ?? 0 : 0;
    if (!Number.isInteger(date) || date < 0 || date > 5) throw new Error('Invalid feed period');
    return page(await api.get(source.kind === 'latest' ? `/feed/latest/all/${index}` : `/feed/all/${index}?date=${date}`, { signal }), article);
}
export async function loadFeedSearch(api: Api, query: string, index: number, signal: AbortSignal): Promise<FeedSearch> {
    const result = await api.post<unknown>(`/search/feed/${checkedPage(index)}`, { query: query.trim(), searchBy: 0 }, undefined, { signal });
    if (!record(result) || result.code !== 0) throw new Error('Invalid search response');
    return { articles: page(result.articles, article), channels: page(result.channels, channel), blogs: page(result.blogs, channel), tags: result.tags === undefined ? { content: [] } : page(result.tags, (value): value is string => typeof value === 'string') };
}
export async function loadFeedChannelSearch(api: Api, query: string, blog: boolean, index: number, signal: AbortSignal) {
    return page(await api.post(`/search/channels/${checkedPage(index)}`, { query: query.trim(), searchBy: 0, is_blog: blog, is_subscribed: null }, undefined, { signal }), channel);
}
export async function loadFeedArticle(api: Api, id: number, signal: AbortSignal): Promise<FeedArticle> {
    const result = await api.get<unknown>(`/article/${checkedId(id)}`, { signal });
    if (!record(result) || result.code !== 0 || !article(result.article) || result.article.id !== id) throw new Error('Invalid article response');
    return result.article;
}
export async function loadFeedChannel(api: Api, id: number, signal: AbortSignal): Promise<FeedChannel> {
    const result = await api.get<unknown>(`/channel/${checkedId(id)}`, { signal });
    if (!record(result) || result.code !== 0 || !channel(result.channel) || result.channel.id !== id) throw new Error('Invalid channel response');
    return result.channel;
}
export interface FeedVoter { id: number; login: string; avatar?: string }
export async function loadFeedVoters(api: Api, type: 'article' | 'comment', id: number, sort: number, index: number, signal: AbortSignal) {
    if (![0, 1, 2].includes(sort)) throw new Error('Invalid vote filter');
    return page(await api.post(`/${type === 'comment' ? 'article/comment' : 'article'}/votes/${checkedId(id)}/${checkedPage(index)}?sort=${sort}`, undefined, undefined, { signal }), (value): value is FeedVoter => record(value) && feedId(value.id) !== null && typeof value.login === 'string');
}
export async function loadFeedReposts(api: Api, id: number, index: number, signal: AbortSignal) {
    return page(await api.get(`/article/reposts/${checkedId(id)}/${checkedPage(index)}?sort=1`, { signal }), article);
}
export async function loadFeedComments(api: Api, id: number, index: number, signal: AbortSignal) {
    return page(await api.get(`/article/comment/all/${checkedId(id)}/${checkedPage(index)}`, { signal }), comment);
}
export async function loadFeedReplies(api: Api, id: number, index: number, signal: AbortSignal) {
    return page(await api.post(`/article/comment/replies/${checkedId(id)}/${checkedPage(index)}?sort=2`, undefined, undefined, { signal }), comment);
}
export async function loadFeedRecommendations(api: Api, signal: AbortSignal) {
    return page(await api.get('/channel/recommendations/0', { signal }), channel);
}

/** Never pass API-provided link or media schemes straight into the DOM. */
export function feedUrl(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : undefined; }
    catch { return undefined; }
}

export type FeedDirectory = 'discover' | 'subscriptions' | 'managed' | 'muted';
export async function loadFeedDirectory(api: Api, kind: FeedDirectory, index: number, signal: AbortSignal) {
    checkedPage(index);
    if (kind === 'subscriptions') return page(await api.get(`/channel/subscription/all/${index}?sort=0`, { signal }), channel);
    if (kind === 'muted') return page(await api.get(`/channel/mute/all/${index}`, { signal }), channel);
    return page(await api.post(`/channel/all/${index}`, { permission: kind === 'managed' ? 1 : null, is_blog: null, is_subscribed: null, sort: 1 }, undefined, { signal }), channel);
}
export async function feedMutation(api: Api, method: 'get' | 'post', path: string, body?: unknown, signal?: AbortSignal) {
    signal?.throwIfAborted();
    const result = method === 'get' ? await api.get<unknown>(path, { cache: 'no-store', ...(signal && { signal }) }) : signal ? await api.post<unknown>(path, body, undefined, { signal }) : await api.post<unknown>(path, body);
    if (!record(result) || result.code !== 0) throw new Error('Feed action failed');
    return result;
}
export async function setChannelSubscription(api: Api, id: number, subscribed: boolean) {
    return feedMutation(api, 'post', `/channel/${subscribed ? 'subscribe' : 'unsubscribe'}/${checkedId(id)}`);
}
export async function setFeedMute(api: Api, type: 'channel' | 'article', id: number, muted: boolean) {
    return feedMutation(api, type === 'channel' ? 'post' : 'get', `/${type}/${muted ? 'mute' : 'unmute'}/${checkedId(id)}`);
}
/** The native API toggles the selected 1/2 vote when it is sent again. */
export async function voteOnFeed(api: Api, type: 'article' | 'comment', id: number, vote: 1 | 2) {
    if (vote !== 1 && vote !== 2) throw new Error('Invalid vote');
    return feedMutation(api, 'get', `/article/${type === 'comment' ? 'comment/' : ''}vote/${checkedId(id)}/${vote}`);
}
export async function saveFeedComment(api: Api, articleId: number, message: string, spoiler: boolean, target?: { editId?: number; parentId?: number; profileId?: number }) {
    if (!message.trim() || message.length > 10000) throw new Error('Invalid comment');
    if (target?.editId) return feedMutation(api, 'post', `/article/comment/edit/${checkedId(target.editId)}`, { message: message.trim(), spoiler });
    return feedMutation(api, 'post', `/article/comment/add/${checkedId(articleId)}`, {
        message: message.trim(), spoiler, parentCommentId: target?.parentId ? checkedId(target.parentId) : null,
        replyToProfileId: target?.profileId ? checkedId(target.profileId) : null,
    });
}
export async function loadEditorChannels(api: Api, signal: AbortSignal): Promise<FeedChannel[]> {
    const result = await api.get<unknown>('/channel/editor/available/all?only_subscribed=false', { signal });
    if (!record(result) || result.code !== 0 || !Array.isArray(result.channels) || !result.channels.every(channel)) throw new Error('Invalid editor response');
    return result.channels;
}
export interface FeedPostingRestriction { level: number; required: number }
export async function loadFeedPostingRestriction(api: Api, signal: AbortSignal): Promise<FeedPostingRestriction | null> {
    const [profile, config] = await Promise.all([
        api.get<{ rating_score?: number }>('/profile/info', { signal }),
        // This app-only config can return HTTP 200 with an empty body to browsers.
        // It is optional: the verified native defaults must still show the notice.
        api.get<{ min_blog_create_rating_score?: number; minBlogCreateRatingScore?: number }>('/config/toggles', { signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]) }).catch(error => {
            if (signal.aborted) throw error;
            return { min_blog_create_rating_score: 3, minBlogCreateRatingScore: 3 };
        }),
    ]);
    const required = config.min_blog_create_rating_score ?? config.minBlogCreateRatingScore ?? 3;
    const level = profile.rating_score;
    if (typeof level !== 'number' || !Number.isFinite(level) || !Number.isSafeInteger(required) || required < 0 || level >= required) return null;
    return { level, required };
}
export async function loadFeedSuggestions(api: Api, channelId: number, index: number, signal: AbortSignal) {
    return page(await api.post(`/article/suggestion/all/${checkedPage(index)}`, { channel_id: checkedId(channelId) }, undefined, { signal }), article);
}
export async function loadFeedSuggestion(api: Api, id: number, signal: AbortSignal) {
    const result = await api.get<unknown>(`/article/suggestion/${checkedId(id)}`, { signal });
    if (!record(result) || result.code !== 0 || !article(result.article) || result.article.id !== id) throw new Error('Invalid suggestion response');
    return result.article;
}
export async function saveFeedArticle(api: Api, channelId: number, blocks: FeedBlock[], options: { editId?: number; repostId?: number; signed: boolean; suggestion?: boolean; signal?: AbortSignal }) {
    if ((!blocks.length && !options.repostId) || blocks.length > 50) throw new Error('Invalid article');
    if (options.repostId) checkedId(options.repostId);
    for (const block of blocks) {
        if (!block || !block.data) throw new Error('Invalid article block');
        if (block.type === 'media' && (!Array.isArray(block.data.items) || !block.data.items.length || block.data.items.length > 50 || block.data.items.some(item => !record(item) || !feedUrl(item.url)))) throw new Error('Invalid media URL');
        if (block.type === 'embed' && !feedUrl(block.data.url)) throw new Error('Invalid link');
    }
    const prefix = options.suggestion ? '/article/suggestion' : '/article';
    await feedMutation(api, 'get', `/channel/${checkedId(channelId)}/editor/available?is_suggestion=${Boolean(options.suggestion)}&is_edit_mode=${Boolean(options.editId)}`, undefined, options.signal);
    const result = await feedMutation(api, 'post', `${prefix}/${options.editId ? 'edit' : 'create'}/${checkedId(options.editId ?? channelId)}`, {
        payload: { time: Date.now(), blocks, version: '2.26.5', block_count: blocks.length },
        ...(!options.suggestion && { is_signed: options.signed, repost_article_id: options.repostId ?? null }),
    }, options.signal);
    if (!article(result.article)) throw new Error('Invalid article response');
    updateFeedArticleMemory(result.article.id, result.article);
    return result.article;
}
export async function saveFeedChannel(api: Api, title: string, description: string, commenting: boolean, suggestions: boolean, id?: number, widget?: { enabled: boolean; sort: number; period: number; count: number }) {
    if (!title.trim() || title.length > 200 || description.length > 10000) throw new Error('Invalid channel');
    if (widget && (![0, 1].includes(widget.sort) || ![0, 1, 2].includes(widget.period) || ![2, 3, 4].includes(widget.count))) throw new Error('Invalid widget settings');
    const result = await feedMutation(api, 'post', id ? `/channel/edit/${checkedId(id)}` : '/channel/create', {
        title: title.trim(), description, is_commenting_enabled: commenting, is_article_suggestion_enabled: suggestions,
        ...(widget && { is_episode_channel_widget_enabled: widget.enabled, episode_channel_widget_sort: widget.sort, episode_channel_widget_popularity_period: widget.period, episode_channel_widget_article_count: widget.count }),
    });
    if (!channel(result.channel)) throw new Error('Invalid channel response');
    return result.channel;
}
