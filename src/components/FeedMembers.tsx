import { useCallback, useState } from 'react';
import { FeedLink as Link } from '../shared/feedNavigation';
import { Modal } from '../modals/ModalTemplate';
import { useApi } from '../shared/apiClient';
import { useUser } from '../shared/contexts/userContext';
import { type FeedChannel } from '../shared/feed';
import { loadFeedMembers, setFeedBlock, setFeedPermission, type FeedMember, type MemberList } from '../shared/feedAdmin';
import { useFeedAction } from '../shared/useFeedAction';
import { useFeedPages } from '../shared/useFeedPages';
import { useTranslation } from '../shared/useTranslation';
import PageState from './PageState';
import { FeedActionError } from './FeedActions';
import styles from './FeedContent.module.css';
import controls from './FeedControls.module.css';

function BlockForm({ channelId, member, onDone }: { channelId: number; member: FeedMember; onDone: () => void }) {
    const api = useApi(), action = useFeedAction();
    const { t } = useTranslation();
    const [reason, setReason] = useState(member.block_reason ?? '');
    const [showReason, setShowReason] = useState(false);
    const [permanent, setPermanent] = useState(true), [until, setUntil] = useState('');
    return <form className={styles.form} onSubmit={event => { event.preventDefault(); void action.run(() => setFeedBlock(api, channelId, member.id, true, { reason, showReason, expires: permanent ? null : Math.floor(new Date(until).getTime() / 1000) }), onDone); }}>
        <p>{member.login}</p>
        <label>{t('feed.reason')}<textarea value={reason} maxLength={1000} onChange={event => setReason(event.target.value)} disabled={action.pending} /></label>
        <label><input type="checkbox" checked={showReason} onChange={event => setShowReason(event.target.checked)} disabled={action.pending} />{t('feed.showBlockReason')}</label>
        <label><input type="checkbox" checked={permanent} onChange={event => setPermanent(event.target.checked)} disabled={action.pending} />{t('feed.permanentBlock')}</label>
        {!permanent && <label>{t('feed.blockUntil')}<input type="datetime-local" value={until} required onChange={event => setUntil(event.target.value)} disabled={action.pending} /></label>}
        <div className={controls.formActions}><button className={controls.danger} disabled={action.pending}>{t('feed.blockMember')}</button></div><FeedActionError error={action.error} />
    </form>;
}

function MemberListView({ channel, kind, query }: { channel: FeedChannel; kind: MemberList; query: string }) {
    const api = useApi(), action = useFeedAction();
    const { userId } = useUser(), { t } = useTranslation();
    const request = useCallback((index: number, signal: AbortSignal) => loadFeedMembers(api, channel.id, kind, query, index, signal), [api, channel.id, kind, query]);
    const state = useFeedPages(request);
    const [target, setTarget] = useState<{ member: FeedMember; kind: 'role' | 'block' | 'unblock' } | null>(null);
    const close = () => setTarget(null);
    const done = () => { close(); state.retry(); };
    return <>
        {state.loading && <PageState status="loading" />}
        {state.error && <PageState status="error" onRetry={state.retryError} />}
        {!state.loading && !state.error && !state.items.length && <PageState status="empty" />}
        {state.items.map(member => <article key={member.id} className={styles.member}>
            <Link to={`/account/${member.id}`}>{member.login}</Link>
            <span className={styles.meta}>{member.permission === 2 ? t('feed.owner') : member.permission === 1 ? t('feed.administrator') : t('feed.member')}</span>
            {member.block_reason && <p className={styles.description}>{member.block_reason}</p>}
            {member.block_expire_date && <time dateTime={new Date(member.block_expire_date * 1000).toISOString()}>{new Date(member.block_expire_date * 1000).toLocaleString()}</time>}
            {member.id !== userId && member.permission !== 2 && <div className={`${styles.actions} ${controls.memberActions}`}>
                {channel.is_creator && kind !== 'blocked' && <button className={controls.secondary} type="button" onClick={() => setTarget({ member, kind: 'role' })}>{t(member.permission === 1 ? 'feed.removeAdministrator' : 'feed.makeAdministrator')}</button>}
                <button className={kind === 'blocked' || member.is_blocked ? controls.secondary : controls.danger} type="button" onClick={() => setTarget({ member, kind: kind === 'blocked' || member.is_blocked ? 'unblock' : 'block' })}>{t(kind === 'blocked' || member.is_blocked ? 'feed.unblockMember' : 'feed.blockMember')}</button>
            </div>}
        </article>)}
        {state.hasMore && <button type="button" className={styles.more} disabled={state.moreLoading} onClick={() => void state.more()}>{t('feed.more')}</button>}
        <Modal isOpen={target !== null} onClose={() => { if (!action.pending) close(); }} title={t(target?.kind === 'role' ? target.member.permission === 1 ? 'feed.removeAdministrator' : 'feed.makeAdministrator' : target?.kind === 'unblock' ? 'feed.unblockMember' : 'feed.blockMember')} size="small">
            {target?.kind === 'block' ? <BlockForm key={target.member.id} member={target.member} channelId={channel.id} onDone={done} /> : target && <div className={styles.form}>
                <p>{target.member.login}</p><p>{t('feed.confirmMemberChange')}</p>
                <div className={controls.formActions}><button className={target.kind === 'role' ? controls.primary : controls.secondary} type="button" disabled={action.pending} onClick={() => void action.run(() => target.kind === 'role' ? setFeedPermission(api, channel.id, target.member.id, target.member.permission !== 1) : setFeedBlock(api, channel.id, target.member.id, false, { reason: '', showReason: false, expires: null }), done)}>{t('feed.confirm')}</button></div>
                <FeedActionError error={action.error} />
            </div>}
        </Modal>
    </>;
}

export default function FeedMembers({ channel }: { channel: FeedChannel }) {
    const { t } = useTranslation();
    const [kind, setKind] = useState<MemberList>('subscribers');
    const [draft, setDraft] = useState(''), [query, setQuery] = useState('');
    return <section aria-label={t('feed.members')}><h2>{t('feed.members')}</h2>
        <div className={controls.tabs} role="group" aria-label={t('feed.members')}>{(['subscribers', 'administrators', 'blocked'] as const).map(tab => <button type="button" key={tab} aria-pressed={kind === tab} onClick={() => setKind(tab)}>{t(`feed.memberList.${tab}`)}</button>)}</div>
        {kind === 'subscribers' && <form className={styles.search} onSubmit={event => { event.preventDefault(); setQuery(draft.trim()); }}><input type="search" aria-label={t('feed.searchMembers')} placeholder={t('feed.searchMembers')} value={draft} onChange={event => setDraft(event.target.value)} /><button>{t('feed.find')}</button></form>}
        <MemberListView key={`${kind}:${query}`} channel={channel} kind={kind} query={query} />
    </section>;
}
