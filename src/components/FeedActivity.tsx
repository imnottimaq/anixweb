import { useCallback, useState } from 'react';
import { FeedLink as Link } from '../shared/feedNavigation';
import { Modal } from '../modals/ModalTemplate';
import { useApi } from '../shared/apiClient';
import { loadFeedReposts, loadFeedVoters } from '../shared/feed';
import { useFeedPages } from '../shared/useFeedPages';
import { useTranslation } from '../shared/useTranslation';
import { FeedArticleCard } from './FeedContent';
import PageState from './PageState';
import styles from './FeedContent.module.css';
import controls from './FeedControls.module.css';
import { FeedIcon } from './FeedIcons';

function Voters({ id, type }: { id: number; type: 'article' | 'comment' }) {
    const api = useApi(), { t } = useTranslation();
    const [sort, setSort] = useState(0);
    const request = useCallback((index: number, signal: AbortSignal) => loadFeedVoters(api, type, id, sort, index, signal), [api, type, id, sort]);
    const state = useFeedPages(request);
    return <><div className={styles.form}><label>{t('feed.reactionFilter')}<select value={sort} onChange={event => setSort(Number(event.target.value))}><option value={0}>{t('feed.allReactions')}</option><option value={1}>{t('feed.upvote')}</option><option value={2}>{t('feed.downvote')}</option></select></label></div>
        {state.loading && <PageState status="loading" />}{state.error && <PageState status="error" onRetry={state.retryError} />}
        {!state.loading && !state.error && !state.items.length && <PageState status="empty" />}
        {state.items.map(profile => <div key={profile.id} className={styles.member}><Link to={`/account/${profile.id}`}>{profile.login}</Link></div>)}
        {state.hasMore && <button type="button" className={styles.more} disabled={state.moreLoading} onClick={() => void state.more()}>{t('feed.more')}</button>}
    </>;
}
function Reposts({ id }: { id: number }) {
    const api = useApi(), { t } = useTranslation();
    const request = useCallback((index: number, signal: AbortSignal) => loadFeedReposts(api, id, index, signal), [api, id]);
    const state = useFeedPages(request);
    return <>{state.loading && <PageState status="loading" />}{state.error && <PageState status="error" onRetry={state.retryError} />}
        {!state.loading && !state.error && !state.items.length && <PageState status="empty" />}
        <div className={styles.stream}>{state.items.map(article => <FeedArticleCard key={article.id} article={article} />)}</div>
        {state.hasMore && <button type="button" className={styles.more} disabled={state.moreLoading} onClick={() => void state.more()}>{t('feed.more')}</button>}
    </>;
}
export default function FeedActivity({ id, type = 'article', reposts = false }: { id: number; type?: 'article' | 'comment'; reposts?: boolean }) {
    const [open, setOpen] = useState(false);
    const { t } = useTranslation();
    const title = t(reposts ? 'feed.viewReposts' : 'feed.viewReactions');
    return <><button className={controls.secondary} type="button" onClick={() => setOpen(true)}><FeedIcon name={reposts ? 'repost' : 'users'} />{title}</button><Modal isOpen={open} onClose={() => setOpen(false)} title={title} size={reposts ? 'large' : 'small'}>{open && (reposts ? <Reposts id={id} /> : <Voters id={id} type={type} />)}</Modal></>;
}
