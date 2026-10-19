import { useCallback, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { PageHeader, PageLayout } from '../components/PageLayout';
import PageState from '../components/PageState';
import FeedNavigation from '../components/FeedNavigation';
import { useFeedSavedNavigation } from '../shared/useFeedNavigation';
import { FeedArticleBody, FeedChannelCard } from '../components/FeedContent';
import { FeedActionError, FeedChannelActions } from '../components/FeedActions';
import { useApi } from '../shared/apiClient';
import { useUser } from '../shared/contexts/userContext';
import { feedId, feedMutation, loadEditorChannels, loadFeedChannel, loadFeedDirectory, loadFeedSearch, loadFeedSuggestions, saveFeedChannel, type FeedChannel, type FeedDirectory } from '../shared/feed';
import { Modal } from '../modals/ModalTemplate';
import { useAsyncLoad } from '../shared/useAsyncLoad';
import { useFeedPages } from '../shared/useFeedPages';
import { useTranslation } from '../shared/useTranslation';
import styles from '../components/FeedContent.module.css';
import { useFeedAction } from '../shared/useFeedAction';
import FeedArtwork from '../components/FeedArtwork';
import FeedMembers from '../components/FeedMembers';
import editorStyles from './FeedEditor.module.css';
import { FeedBack, FeedLink as Link } from '../shared/feedNavigation';
import { useFeedMemoryKey, useFeedPosition } from '../shared/useFeedNavigation';
import { useFeedDraftState } from '../shared/useFeedDraftState';

function ChannelForm({ channel }: { channel?: FeedChannel }) {
    const api = useApi();
    const navigate = useFeedSavedNavigation();
    const { t } = useTranslation();
    const [title, setTitle] = useFeedDraftState('channel:title', channel?.title ?? '');
    const [description, setDescription] = useFeedDraftState('channel:description', channel?.description ?? '');
    const [commenting, setCommenting] = useFeedDraftState('channel:commenting', channel?.is_commenting_enabled ?? true);
    const [suggestions, setSuggestions] = useFeedDraftState('channel:suggestions', channel?.is_article_suggestion_enabled ?? false);
    const [widgetEnabled, setWidgetEnabled] = useFeedDraftState('channel:widgetEnabled', channel?.is_episode_channel_widget_enabled ?? false);
    const [widgetSort, setWidgetSort] = useFeedDraftState('channel:widgetSort', channel?.episode_channel_widget_sort ?? 0);
    const [widgetPeriod, setWidgetPeriod] = useFeedDraftState('channel:widgetPeriod', channel?.episode_channel_widget_popularity_period ?? 0);
    const [widgetCount, setWidgetCount] = useFeedDraftState('channel:widgetCount', channel?.episode_channel_widget_article_count ?? 2);
    const action = useFeedAction();
    return <form className={`${styles.form} ${editorStyles.channelForm}`} onSubmit={event => { event.preventDefault(); void action.run(() => saveFeedChannel(api, title, description, commenting, suggestions, channel?.id, { enabled: widgetEnabled, sort: widgetSort, period: widgetPeriod, count: widgetCount }), saved => navigate(`/feed/channel/${saved.id}`)); }}>
        <section className={editorStyles.channelIdentity}>
        <label>{t('feed.channelTitle')}<input required maxLength={200} value={title} onChange={event => setTitle(event.target.value)} disabled={action.pending} /></label>
        <label>{t('feed.description')}<textarea maxLength={10000} value={description} onChange={event => setDescription(event.target.value)} disabled={action.pending} /></label>
        </section>
        <div className={editorStyles.channelPermissions}>
        <label><input type="checkbox" checked={commenting} onChange={event => setCommenting(event.target.checked)} disabled={action.pending} />{t('feed.allowComments')}</label>
        <label><input type="checkbox" checked={suggestions} onChange={event => setSuggestions(event.target.checked)} disabled={action.pending} />{t('feed.allowSuggestions')}</label>
        </div>
        <fieldset className={editorStyles.widgetSettings} disabled={action.pending}><legend>{t('feed.episodeWidget')}</legend><div className={`${styles.form} ${editorStyles.widgetForm}`}>
            <label><input type="checkbox" checked={widgetEnabled} onChange={event => setWidgetEnabled(event.target.checked)} />{t('feed.enableWidget')}</label>
            <label>{t('feed.widgetSort')}<select value={widgetSort} onChange={event => setWidgetSort(Number(event.target.value))}><option value={0}>{t('feed.chronology')}</option><option value={1}>{t('feed.popularity')}</option></select></label>
            {widgetSort === 1 && <label>{t('feed.period')}<select value={widgetPeriod} onChange={event => setWidgetPeriod(Number(event.target.value))}><option value={0}>{t('feed.widgetDay')}</option><option value={1}>{t('feed.widgetThreeDays')}</option><option value={2}>{t('feed.widgetWeek')}</option></select></label>}
            <label>{t('feed.widgetCount')}<select value={widgetCount} onChange={event => setWidgetCount(Number(event.target.value))}>{[2, 3, 4].map(count => <option key={count} value={count}>{count}</option>)}</select></label>
        </div></fieldset>
        <button className={`${styles.primaryBtn} ${editorStyles.channelSubmit}`} disabled={action.pending || !title.trim()}>{t(channel ? 'feed.save' : 'feed.createChannel')}</button>
        <FeedActionError error={action.error} />
    </form>;
}

function EditChannel({ id }: { id: number }) {
    const api = useApi();
    const { t } = useTranslation();
    const state = useAsyncLoad(signal => loadFeedChannel(api, id, signal), [api, id]);
    if (state.isLoading) return <PageState status="loading" />;
    if (state.error || !state.data) return <PageState status="error" onRetry={state.reload} />;
    if (!state.data.is_creator && !state.data.is_administrator_or_higher) return <PageState status="error" message={t('feed.noPermission')} />;
    return <><ChannelForm channel={state.data} /><FeedArtwork channel={state.data} /><FeedMembers channel={state.data} /></>;
}

function Directory({ kind }: { kind: FeedDirectory }) {
    const api = useApi();
    const { t } = useTranslation();
    const request = useCallback((index: number, signal: AbortSignal) => loadFeedDirectory(api, kind, index, signal), [api, kind]);
    const state = useFeedPages(request, useFeedMemoryKey(`directory:${kind}`));
    return <>
        {state.loading && <PageState status="loading" />}
        {state.error && <PageState status="error" onRetry={state.retryError} />}
        {!state.loading && !state.error && !state.items.length && <PageState status="empty" />}
        {state.items.map(channel => <section key={channel.id} className={styles.directoryItem}><FeedChannelCard channel={channel} /><FeedChannelActions channel={channel} /></section>)}
        {state.hasMore && <button type="button" className={styles.more} onClick={() => void state.more()} disabled={state.moreLoading}>{t('feed.more')}</button>}
    </>;
}

function TrendingTags() {
    const api = useApi();
    const { t } = useTranslation();
    const state = useAsyncLoad(signal => loadFeedSearch(api, '', 0, signal), [api]);
    return <section aria-label={t('feed.tags')}>{state.error ? <PageState status="error" onRetry={state.reload} /> : state.data && <nav className={styles.actions} aria-label={t('feed.tags')}>{state.data.tags.content.map(tag => <Link key={tag} to={`/feed?q=${encodeURIComponent(`#${tag}`)}`}>#{tag}</Link>)}</nav>}</section>;
}

function SuggestionList({ channelId }: { channelId: number }) {
    const api = useApi();
    const { t } = useTranslation();
    const request = useCallback((index: number, signal: AbortSignal) => loadFeedSuggestions(api, channelId, index, signal), [api, channelId]);
    const state = useFeedPages(request);
    const action = useFeedAction();
    const [deleteId, setDeleteId] = useState<number | null>(null);
    return <>
        {state.loading && <PageState status="loading" />}
        {state.error && <PageState status="error" onRetry={state.retryError} />}
        {!state.loading && !state.error && !state.items.length && <PageState status="empty" />}
        <FeedActionError error={action.error} />
        <div className={styles.stream}>{state.items.map(article => <article key={article.id} className={styles.post}><FeedArticleBody article={article} /><div className={styles.actions}>
            <Link to={`/feed/compose?channel=${channelId}&suggestion=1&edit=${article.id}`}>{t('feed.edit')}</Link>
            <button type="button" disabled={action.pending} onClick={() => void action.run(() => feedMutation(api, 'post', `/article/suggestion/publish/${article.id}`), state.retry)}>{t('feed.publish')}</button>
            <button type="button" disabled={action.pending} onClick={() => setDeleteId(article.id)}>{t('feed.delete')}</button>
        </div></article>)}</div>
        {state.hasMore && <button type="button" className={styles.more} disabled={state.moreLoading} onClick={() => void state.more()}>{t('feed.more')}</button>}
        <Modal isOpen={deleteId !== null} onClose={() => { if (!action.pending) setDeleteId(null); }} title={t('feed.deletePost')} size="small"><p>{t('feed.deleteWarning')}</p><button type="button" disabled={action.pending} onClick={() => { if (deleteId) void action.run(() => feedMutation(api, 'post', `/article/suggestion/delete/${deleteId}`), () => { setDeleteId(null); state.retry(); }); }}>{t('feed.delete')}</button><FeedActionError error={action.error} /></Modal>
    </>;
}

function Suggestions({ channels }: { channels: FeedChannel[] }) {
    const [selected, setSelected] = useState(channels[0]?.id ?? 0);
    const { t } = useTranslation();
    return <><div className={styles.form}><label>{t('feed.channel')}<select value={selected} onChange={event => setSelected(Number(event.target.value))}>{channels.map(channel => <option key={channel.id} value={channel.id}>{channel.title}</option>)}</select></label></div>{selected ? <SuggestionList key={selected} channelId={selected} /> : <PageState status="empty" message={t('feed.noEditorChannels')} />}</>;
}

function SuggestionChannels() {
    const api = useApi();
    const state = useAsyncLoad(signal => loadEditorChannels(api, signal), [api]);
    return state.isLoading ? <PageState status="loading" /> : state.error || !state.data ? <PageState status="error" onRetry={state.reload} /> : <Suggestions channels={state.data} />;
}

function Studio() {
    const [params] = useSearchParams();
    const location = useLocation();
    const { t } = useTranslation();
    const api = useApi();
    const navigate = useNavigate();
    const action = useFeedAction();
    const requestedTab = params.get('tab');
    const kind = (requestedTab === 'suggestions' ? 'discover' : ['discover', 'subscriptions', 'managed', 'muted'].includes(requestedTab ?? '') ? requestedTab : 'managed') as FeedDirectory;
    const edit = params.has('edit') ? feedId(params.get('edit')) : undefined;
    const detail = params.has('create') || params.has('edit');
    const showBrowseActions = !detail && kind === 'managed' && requestedTab !== 'suggestions';
    return <>
        {!detail && <nav className={`${styles.tabs} ${editorStyles.studioTabs}`} aria-label={t('feed.manage')}>{(['discover', 'subscriptions', 'managed', 'muted', 'suggestions'] as const).map(tab => <Link key={tab} to={`/feed/studio?tab=${tab}`} aria-current={requestedTab === tab || (requestedTab === null && tab === 'managed') ? 'page' : undefined}>{t(`feed.${tab}`)}</Link>)}</nav>}
        {showBrowseActions && <div className={`${styles.actions} ${editorStyles.studioActions}`}><Link className={`${styles.primaryBtn} ${editorStyles.studioCreate}`} to="/feed/studio?create=1">{t('feed.createChannel')}</Link><button className={styles.secondaryBtn} type="button" disabled={action.pending} onClick={() => void action.run(() => feedMutation(api, 'post', '/channel/blog/create'), result => { const channel = result.channel as FeedChannel | undefined; if (feedId(channel?.id)) navigate(`/feed/channel/${channel!.id}`); else navigate('/feed/studio?tab=managed'); })}>{t('feed.createBlog')}</button><Link className={styles.secondaryBtn} to="/feed/compose">{t('feed.compose')}</Link></div>}
        {showBrowseActions && <FeedActionError error={action.error} />}
        {kind === 'discover' && requestedTab === 'discover' && !detail && <TrendingTags />}
        {edit === null ? <PageState status="error" message={t('feed.invalid')} /> : edit ? <EditChannel key={edit} id={edit} /> : params.has('create') ? <ChannelForm /> : requestedTab === 'suggestions' ? <SuggestionChannels /> : <Directory key={`${kind}:${location.key}`} kind={kind} />}
    </>;
}

export default function FeedStudioScreen() {
    const { userToken } = useUser();
    const { t } = useTranslation();
    const [params] = useSearchParams();
    const isCreate = params.has('create');
    const isEdit = params.has('edit');
    useFeedPosition();
    return <PageLayout className={styles.page}>
        {(isCreate || isEdit) && <FeedBack fallbackTo="/feed/studio?tab=managed" fallbackLabel="feed.backToChannels" />}
        <PageHeader title={isCreate ? t('feed.createChannel') : isEdit ? t('feed.editChannel') : t('feed.title')} />
        {!(isCreate || isEdit) && <FeedNavigation active="channels" />}
        {userToken ? <Studio key={userToken} /> : <><PageState status="empty" message={t('feed.signIn')} /><Link to="/account/login">{t('feed.login')}</Link></>}
    </PageLayout>;
}
