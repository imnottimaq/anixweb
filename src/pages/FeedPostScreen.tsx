import { FeedLink as Link } from '../shared/feedNavigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { PageHeader, PageLayout } from '../components/PageLayout';
import PageState from '../components/PageState';
import { FeedArticleCard } from '../components/FeedContent';
import { useApi } from '../shared/apiClient';
import { useUser } from '../shared/contexts/userContext';
import { feedId, feedMutation, saveFeedComment, loadFeedArticle, loadFeedComments, loadFeedReplies, type FeedComment } from '../shared/feed';
import { FeedActionError, FeedReport, FeedVote } from '../components/FeedActions';
import { Modal } from '../modals/ModalTemplate';
import { useFeedPages } from '../shared/useFeedPages';
import { useAsyncLoad } from '../shared/useAsyncLoad';
import { useTranslation } from '../shared/useTranslation';
import styles from '../components/FeedContent.module.css';
import { useFeedAction } from '../shared/useFeedAction';
import FeedActivity from '../components/FeedActivity';
import shell from './FeedShell.module.css';
import { FeedBack } from '../shared/feedNavigation';
import { useFeedPosition } from '../shared/useFeedNavigation';

function CommentForm({ articleId, target, onSaved, onCancel }: { articleId: number; target?: { editId?: number; parentId?: number; profileId?: number; message?: string; spoiler?: boolean }; onSaved: () => void; onCancel?: () => void }) {
    const api = useApi();
    const { t } = useTranslation();
    const [message, setMessage] = useState(target?.message ?? '');
    const [spoiler, setSpoiler] = useState(target?.spoiler ?? false);
    const action = useFeedAction();
    return <form className={`${styles.form} ${shell.commentForm}`} onSubmit={event => { event.preventDefault(); void action.run(() => saveFeedComment(api, articleId, message, spoiler, target), () => { setMessage(''); setSpoiler(false); onSaved(); }); }}>
        <label>{t(target?.editId ? 'feed.editComment' : target?.parentId ? 'feed.reply' : 'feed.writeComment')}<textarea required maxLength={10000} value={message} onChange={event => setMessage(event.target.value)} disabled={action.pending} /></label>
        <label><input type="checkbox" checked={spoiler} onChange={event => setSpoiler(event.target.checked)} disabled={action.pending} />{t('feed.containsSpoiler')}</label>
        <div className={styles.actions}><button type="submit" disabled={action.pending || !message.trim()}>{t(target?.editId ? 'feed.save' : 'feed.send')}</button>{onCancel && <button type="button" disabled={action.pending} onClick={onCancel}>{t('feed.cancel')}</button>}</div>
        <FeedActionError error={action.error} />
    </form>;
}

function Replies({ id, articleId, onChanged, canComment }: { id: number; articleId: number; onChanged: () => void; canComment: boolean }) {
    const api = useApi();
    const { t } = useTranslation();
    const request = useCallback((index: number, signal: AbortSignal) => loadFeedReplies(api, id, index, signal), [api, id]);
    const state = useFeedPages(request);
    return <div className={styles.replies}>
        {state.loading && <PageState status="loading" />}
        {state.error && <PageState status="error" message={t('feed.commentsError')} onRetry={state.retryError} />}
        {state.items.map(comment => <CommentView key={comment.id} comment={comment} articleId={articleId} parentId={id} canComment={canComment} onChanged={() => { state.retry(); onChanged(); }} />)}
        {state.hasMore && <button className={styles.more} type="button" disabled={state.moreLoading} onClick={() => void state.more()}>{t(state.moreLoading ? 'feed.loading' : 'feed.more')}</button>}
    </div>;
}

function CommentView({ comment, articleId, parentId, onChanged, canComment, allowReplies = false }: { comment: FeedComment; articleId: number; parentId?: number; onChanged: () => void; canComment: boolean; allowReplies?: boolean }) {
    const { t, formatDate } = useTranslation();
    const [expanded, setExpanded] = useState(false);
    const [mode, setMode] = useState<'reply' | 'edit' | null>(null);
    const [confirm, setConfirm] = useState(false);
    const { userId } = useUser();
    const api = useApi();
    const action = useFeedAction();
    return <article className={styles.comment}>
        <header><Link to={`/account/${comment.profile.id}`}>{comment.profile.login}</Link>{typeof comment.timestamp === 'number' && Number.isFinite(comment.timestamp) && Math.abs(comment.timestamp) < 8640000000000 && <span className={styles.meta}>{formatDate(comment.timestamp * 1000, { dateStyle: 'medium' })}</span>}</header>
        {comment.is_deleted ? <p>{t('feed.deleted')}</p> : comment.is_spoiler ? <details><summary>{t('feed.spoiler')}</summary><p>{comment.message}</p></details> : <p>{comment.message}</p>}
        {!comment.is_deleted && <>
            <FeedVote type="comment" id={comment.id} vote={comment.vote} count={comment.vote_count} />
            <div className={styles.actions}>{canComment && <button type="button" onClick={() => setMode('reply')}>{t('feed.reply')}</button>}
                {userId > 0 && comment.profile.id === userId && <><button type="button" onClick={() => setMode('edit')}>{t('feed.edit')}</button><button type="button" onClick={() => setConfirm(true)}>{t('feed.delete')}</button></>}
                <FeedReport type="comment/article" id={comment.id} />
                <FeedActivity id={comment.id} type="comment" />
            </div>
            {mode && <CommentForm key={mode} articleId={articleId} target={mode === 'edit' ? { editId: comment.id, message: comment.message, spoiler: comment.is_spoiler } : { parentId: parentId ?? comment.id, profileId: comment.profile.id }} onCancel={() => setMode(null)} onSaved={() => { setMode(null); setExpanded(true); onChanged(); }} />}
            <Modal isOpen={confirm} onClose={() => { if (!action.pending) setConfirm(false); }} title={t('feed.deleteComment')} size="small"><p>{t('feed.deleteWarning')}</p><button type="button" disabled={action.pending} onClick={() => void action.run(() => feedMutation(api, 'get', `/article/comment/delete/${comment.id}`), () => { setConfirm(false); onChanged(); })}>{t('feed.delete')}</button><FeedActionError error={action.error} /></Modal>
        </>}
        {allowReplies && Number(comment.reply_count) > 0 && <button type="button" className={styles.replyButton} aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{t('feed.replies', { count: comment.reply_count ?? 0 })}</button>}
        {expanded && allowReplies && <Replies id={comment.id} articleId={articleId} onChanged={onChanged} canComment={canComment} />}
    </article>;
}

function FeedComments({ articleId, ready, canComment }: { articleId: number; ready: boolean; canComment: boolean }) {
    const api = useApi();
    const { t } = useTranslation();
    const { hash } = useLocation();
    const section = useRef<HTMLElement>(null);
    const request = useCallback((index: number, signal: AbortSignal) => loadFeedComments(api, articleId, index, signal), [api, articleId]);
    const state = useFeedPages(request);
    useEffect(() => { if (ready && hash === '#comments') section.current?.scrollIntoView({ block: 'start' }); }, [hash, ready]);
    return <section id="comments" ref={section} className={styles.section} aria-label={t('feed.comments', { count: state.items.length })}>
        <h2>{t('feed.comments', { count: state.items.length })}</h2>
        {canComment ? <CommentForm articleId={articleId} onSaved={state.retry} /> : ready && <p>{t('feed.commentsDisabled')}</p>}
        {state.loading && <PageState status="loading" />}
        {state.error && <PageState status="error" message={t('feed.commentsError')} onRetry={state.retryError} />}
        {!state.loading && !state.error && !state.items.length && <PageState status="empty" message={t('feed.noComments')} />}
        {state.items.map(comment => <CommentView key={comment.id} comment={comment} articleId={articleId} canComment={canComment} onChanged={state.retry} allowReplies />)}
        {state.hasMore && <button type="button" className={styles.more} onClick={() => void state.more()} disabled={state.moreLoading}>{t(state.moreLoading ? 'feed.loading' : 'feed.more')}</button>}
    </section>;
}

function PostPage({ id }: { id: number }) {
    const api = useApi();
    const { t } = useTranslation();
    const { data, isLoading, error, reload } = useAsyncLoad(signal => loadFeedArticle(api, id, signal), [api, id]);
    useFeedPosition(!isLoading);
    return <>
        {isLoading && <PageState status="loading" />}
        {error && <PageState status="error" message={t('feed.invalid')} onRetry={reload} />}
        {data && !error && <FeedArticleCard article={data} detail />}
        {!error && <FeedComments articleId={id} ready={!isLoading} canComment={Boolean(data && data.channel.is_commenting_enabled !== false && !data.channel.is_blocked && !data.is_deleted)} />}
    </>;
}

export default function FeedPostScreen() {
    const { postId } = useParams();
    const id = feedId(postId);
    const { userToken } = useUser();
    const { t } = useTranslation();
    return <PageLayout className={styles.page}><FeedBack /><PageHeader title={t('feed.post')} />
        {id === null ? <PageState status="error" message={t('feed.invalid')} /> : !userToken ? <><PageState status="empty" message={t('feed.signIn')} /><Link to="/account/login">{t('feed.login')}</Link></> : <PostPage key={`${userToken}:${id}`} id={id} />}
    </PageLayout>;
}
