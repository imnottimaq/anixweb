import { FeedLink as Link } from '../shared/feedNavigation';
import { useState } from 'react';
import { useHref } from 'react-router-dom';
import { Modal } from '../modals/ModalTemplate';
import { useApi } from '../shared/apiClient';
import { useUser } from '../shared/contexts/userContext';
import { feedMutation, setChannelSubscription, setFeedMute, voteOnFeed, type FeedArticle, type FeedChannel } from '../shared/feed';
import { useTranslation } from '../shared/useTranslation';
import styles from './FeedContent.module.css';
import controls from './FeedControls.module.css';
import { useFeedSavedNavigation } from '../shared/useFeedNavigation';
import { updateFeedArticleMemory } from '../shared/feedPageMemory';
import { FeedIcon } from './FeedIcons';
import { useFeedAction } from '../shared/useFeedAction';
import FeedActivity from './FeedActivity';

export function FeedActionError({ error }: { error: boolean }) {
    const { t } = useTranslation();
    return error ? <p role="alert">{t('feed.actionError')}</p> : null;
}

export function FeedVote({ id, type, vote = 0, count = 0 }: { id: number; type: 'article' | 'comment'; vote?: number; count?: number }) {
    const api = useApi();
    const { userToken } = useUser();
    const { t, formatNumber } = useTranslation();
    const [current, setCurrent] = useState(vote);
    const [score, setScore] = useState(count);
    const action = useFeedAction();
    const value = (v: number) => v === 1 ? 1 : v === 2 ? -1 : 0;
    const cast = (selected: 1 | 2) => void action.run(() => voteOnFeed(api, type, id, selected), () => {
        const next = current === selected ? 0 : selected;
        setScore(score + value(next) - value(current)); setCurrent(next);
    });
    return <div className={`${styles.vote} ${controls.voteRail}`}>
        <button type="button" aria-label={t('feed.upvote')} aria-pressed={current === 1} disabled={!userToken || action.pending} onClick={() => cast(1)}><FeedIcon name="upvote" size={17} /></button>
        <span role="status" aria-label={t('feed.votes', { count: score })} title={t('feed.votes', { count: score })}>{formatNumber(score)}</span>
        <button type="button" aria-label={t('feed.downvote')} aria-pressed={current === 2} disabled={!userToken || action.pending} onClick={() => cast(2)}><FeedIcon name="downvote" size={17} /></button>
        <FeedActionError error={action.error} />
    </div>;
}

export function FeedChannelActions({ channel, onChanged }: { channel: FeedChannel; onChanged?: () => void }) {
    const api = useApi();
    const { t } = useTranslation();
    const { userToken } = useUser();
    const [subscribed, setSubscribed] = useState(Boolean(channel.is_subscribed));
    const [muted, setMuted] = useState(Boolean(channel.is_muted));
    const action = useFeedAction();
    const canPublish = Boolean(channel.is_creator || channel.is_administrator_or_higher || (channel.permission ?? 0) > 0);
    if (!userToken) return null;
    return <div className={`${styles.actions} ${controls.actionRail} ${controls.channelRail}`}>
        <div className={controls.group}>
            {!channel.is_creator && <button className={subscribed ? controls.secondary : controls.primary} type="button" disabled={action.pending} onClick={() => void action.run(() => setChannelSubscription(api, channel.id, !subscribed), () => { setSubscribed(!subscribed); onChanged?.(); })}>{t(subscribed ? 'feed.unsubscribe' : 'feed.subscribe')}</button>}
            {(canPublish || channel.is_article_suggestion_enabled) && <Link className={controls.primary} to={`/feed/compose?channel=${channel.id}${!canPublish ? '&suggestion=1' : ''}`}><FeedIcon name="plus" />{t(!canPublish ? 'feed.suggest' : 'feed.compose')}</Link>}
        </div>
        <div className={controls.group}>
            <button className={controls.secondary} type="button" disabled={action.pending} onClick={() => void action.run(() => setFeedMute(api, 'channel', channel.id, !muted), () => { setMuted(!muted); onChanged?.(); })}><FeedIcon name={muted ? 'unmute' : 'mute'} />{t(muted ? 'feed.unmute' : 'feed.mute')}</button>
            {(channel.is_creator || channel.is_administrator_or_higher) && <Link className={controls.secondary} to={`/feed/studio?edit=${channel.id}`}><FeedIcon name="edit" />{t('feed.editChannel')}</Link>}
        </div>
        <FeedReport type="channel" id={channel.id} />
        <FeedActionError error={action.error} />
    </div>;
}

export function FeedPostActions({ article }: { article: FeedArticle }) {
    const api = useApi();
    const navigate = useFeedSavedNavigation();
    const { userToken, userId } = useUser();
    const { t } = useTranslation();
    const [deleted, setDeleted] = useState(false);
    const [confirm, setConfirm] = useState(false);
    const [pinned, setPinned] = useState(Boolean(article.is_pinned));
    const [muted, setMuted] = useState(Boolean(article.is_muted));
    const [copied, setCopied] = useState(false);
    const href = useHref(`/feed/post/${article.id}`);
    const action = useFeedAction();
    const canEdit = article.channel.is_creator || article.channel.is_administrator_or_higher || (article.author?.id === userId && userId > 0);
    if (!userToken || article.is_deleted) return null;
    if (deleted) return <p role="status">{t('feed.deleted')}</p>;
    return <div className={`${styles.actions} ${controls.actionRail}`}>
        <div className={controls.group}>
            <Link className={controls.primary} to={`/feed/compose?repost=${article.id}`}><FeedIcon name="repost" />{t('feed.repost')}</Link>
            <FeedActivity id={article.id} /><FeedActivity id={article.id} reposts />
        </div>
        <div className={controls.group}>
            <button className={controls.secondary} type="button" disabled={action.pending} onClick={() => void action.run(() => navigator.clipboard.writeText(new URL(href, window.location.href).href), () => setCopied(true))}><FeedIcon name="share" />{t(copied ? 'feed.copied' : 'feed.share')}</button>
            <button className={controls.secondary} type="button" disabled={action.pending} onClick={() => void action.run(() => setFeedMute(api, 'article', article.id, !muted), () => setMuted(!muted))}><FeedIcon name={muted ? 'unmute' : 'mute'} />{t(muted ? 'feed.unmute' : 'feed.mute')}</button>
        </div>
        {canEdit && <div className={controls.group}>
            <Link className={controls.secondary} to={`/feed/compose?edit=${article.id}`}><FeedIcon name="edit" />{t('feed.edit')}</Link>
            <button className={controls.secondary} type="button" disabled={action.pending} onClick={() => void action.run(() => feedMutation(api, 'get', `/article/edit/pinned/${article.id}?is_pinned=${!pinned}`), () => setPinned(!pinned))}><FeedIcon name="pin" />{t(pinned ? 'feed.unpin' : 'feed.pin')}</button>
            <button className={controls.danger} type="button" disabled={action.pending} onClick={() => setConfirm(true)}><FeedIcon name="trash" />{t('feed.delete')}</button>
        </div>}
        <div className={controls.group}><FeedReport type="article" id={article.id} /></div>
        <FeedActionError error={action.error} />
        <Modal isOpen={confirm} onClose={() => { if (!action.pending) setConfirm(false); }} title={t('feed.deletePost')} size="small">
            <p>{t('feed.deleteWarning')}</p>
            <div className={controls.formActions}><button className={controls.danger} type="button" disabled={action.pending} onClick={() => void action.run(() => feedMutation(api, 'post', `/article/delete/${article.id}`), () => { updateFeedArticleMemory(article.id); setDeleted(true); setConfirm(false); navigate(`/feed/channel/${article.channel.id}`); })}>{t('feed.delete')}</button></div>
            <FeedActionError error={action.error} />
        </Modal>
    </div>;
}

export function FeedReport({ type, id }: { type: 'article' | 'channel' | 'comment/article'; id: number }) {
    const api = useApi();
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    const [reasons, setReasons] = useState<{ id: number; name: string }[]>([]);
    const [reason, setReason] = useState('');
    const [message, setMessage] = useState('');
    const [sent, setSent] = useState(false);
    const action = useFeedAction();
    const show = () => { setOpen(true); void action.run(async () => {
        const data = await api.get<unknown>(`/report/${type}/reasons`);
        if (!Array.isArray(data) || !data.every(item => item && Number.isSafeInteger(item.id) && typeof item.name === 'string')) throw new Error('Invalid report reasons');
        return data as { id: number; name: string }[];
    }, setReasons); };
    return <>
        <button className={controls.danger} type="button" onClick={show}><FeedIcon name="flag" />{t('feed.report')}</button>
        <Modal isOpen={open} onClose={() => { if (!action.pending) setOpen(false); }} title={t('feed.report')} size="small">
            {sent ? <p role="status">{t('feed.reportSent')}</p> : <form className={styles.form} onSubmit={event => { event.preventDefault(); if (reason) void action.run(() => feedMutation(api, 'post', `/report/${type}`, { entity_id: id, reason: Number(reason), message }), () => setSent(true)); }}>
                <label>{t('feed.reason')}<select required value={reason} onChange={event => setReason(event.target.value)}><option value="">{t('feed.choose')}</option>{reasons.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
                <label>{t('feed.message')}<textarea value={message} maxLength={10000} onChange={event => setMessage(event.target.value)} /></label>
                <div className={controls.formActions}><button className={controls.primary} disabled={action.pending || !reason}>{t('feed.send')}</button></div>
            </form>}
            <FeedActionError error={action.error} />
            {action.error && !reasons.length && <div className={controls.formActions}><button className={controls.secondary} type="button" onClick={show}>{t('feed.retryImage')}</button></div>}
        </Modal>
    </>;
}
