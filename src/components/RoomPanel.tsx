import { useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useRoomPresence } from '../shared/contexts/roomContext';
import { useUser } from '../shared/contexts/userContext';
import { useTranslation } from '../shared/useTranslation';
import { roomErrorKey } from '../shared/roomError';
import type { RoomParticipant, RoomCommandPayload } from '../shared/roomProtocol';
import RemoteImage from './RemoteImage';
import RoomChat from './RoomChat';
import ReactionOverlay from './ReactionOverlay';
import { REACTION_KEYS } from './roomSocialConstants';
import { ReactionIcon } from './ReactionIcon';
import ActionIcon from './ActionIcon';
import Toggle from './Toggle';
import styles from './RoomSidebar.module.css';

const REACTION_ITEMS = REACTION_KEYS;

type Confirmation = { type: 'leave' } | { type: 'close_room' } | { type: 'transfer_host' | 'kick'; participant: RoomParticipant };

export default function RoomPanel({ compact = false }: { compact?: boolean }) {
    const { room, status, error, send, leave, closeRoom, join, activeRoomId, self, serverNow, sendReaction } = useRoomPresence();
    const { userId } = useUser();
    const { t } = useTranslation();
    const navigate = useNavigate();
    const id = useId();
    const panel = useRef<HTMLElement>(null);
    const dialog = useRef<HTMLDialogElement>(null);
    const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
    const [pending, setPending] = useState(false);
    const [notice, setNotice] = useState('');
    const [actionError, setActionError] = useState('');
    const [now, setNow] = useState(serverNow);
    const [activeTab, setActiveTab] = useState<'chat' | 'room'>('chat');
    const profileId = self?.profileId ?? userId;
    const me = room?.participants.find(p => p.profileId === profileId);
    const isHost = room?.hostId === profileId;
    const role = isHost ? 'host' : me?.canControl ? 'controller' : 'viewer';
    const deadline = room?.barrier?.deadline;
    const seconds = deadline ? Math.max(0, Math.min(7, Math.ceil((deadline - now) / 1000))) : 0;
    const blocked = room?.participants.filter(p => p.viewing && p.excludedEpoch !== room.syncEpoch && p.status !== 'ready') ?? [];

    useEffect(() => {
        if (!deadline) return;
        const timer = window.setInterval(() => setNow(serverNow()), 250);
        return () => window.clearInterval(timer);
    }, [deadline, serverNow]);
    useEffect(() => {
        if (!notice) return;
        const timer = window.setTimeout(() => setNotice(''), 3000);
        return () => window.clearTimeout(timer);
    }, [notice]);
    useEffect(() => {
        if (confirmation && !dialog.current?.open) dialog.current?.showModal();
        else if (!confirmation && dialog.current?.open) dialog.current.close();
    }, [confirmation]);
    useEffect(() => {
        const dismiss = (event: PointerEvent | KeyboardEvent) => {
            for (const details of panel.current?.querySelectorAll('details[open]') ?? []) {
                if (event instanceof KeyboardEvent ? event.key === 'Escape' : !details.contains(event.target as Node)) {
                    details.removeAttribute('open');
                    if (event instanceof KeyboardEvent) (details.querySelector('summary') as HTMLElement)?.focus();
                }
            }
        };
        document.addEventListener('pointerdown', dismiss);
        document.addEventListener('keydown', dismiss);
        return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', dismiss); };
    }, []);

    const closeMenus = (restoreFocus = false) => panel.current?.querySelectorAll('details[open]').forEach(details => {
        details.removeAttribute('open');
        if (restoreFocus) (details.querySelector('summary') as HTMLElement | null)?.focus();
    });
    const act = async (command: RoomCommandPayload) => {
        if (pending) return;
        setPending(true); setActionError(''); closeMenus();
        try { await send(command); setNotice(t('roomUX.actionDone')); }
        catch (cause) { setActionError(t(roomErrorKey(cause instanceof Error ? cause.message : ''))); }
        finally { setPending(false); }
    };
    const copy = async (target: 'link' | 'code') => {
        if (!room) return;
        const invite = `${window.location.origin}${import.meta.env.BASE_URL}together/${room.roomId}${room.visibility === 'private' ? `?code=${encodeURIComponent(room.joinCode)}` : ''}`;
        try { await navigator.clipboard.writeText(target === 'link' ? invite : room.joinCode); setActionError(''); setNotice(t(target === 'link' ? 'roomUX.linkCopied' : 'roomUX.codeCopied')); }
        catch { setActionError(t('roomV2.copyFailed')); }
    };
    const exit = async () => { await leave(); navigate('/together'); };
    const confirm = async () => {
        if (!confirmation || pending) return;
        setPending(true); setActionError('');
        try {
            if (confirmation.type === 'leave') await exit();
            else if (confirmation.type === 'close_room') {
                if (closeRoom) {
                    await closeRoom();
                } else {
                    await send({ type: 'close_room' });
                }
                setConfirmation(null);
                navigate('/together');
                return;
            }
            else { await send({ type: confirmation.type, profileId: confirmation.participant.profileId }); setNotice(t('roomUX.actionDone')); }
            setConfirmation(null);
        } catch (cause) {
            const msg = cause instanceof Error ? cause.message : '';
            if (msg === 'ROOM_CLOSED') {
                setConfirmation(null);
                navigate('/together');
                return;
            }
            setActionError(t(roomErrorKey(msg)));
        }
        finally { setPending(false); }
    };
    const confirmTitle = confirmation?.type === 'leave' ? t('roomUX.leaveTitle')
        : confirmation?.type === 'close_room' ? t('watchRoom.closeRoomTitle')
        : confirmation ? t(confirmation.type === 'kick' ? 'roomUX.kickTitle' : 'roomUX.transferTitle', { login: confirmation.participant.login }) : '';

    return <aside ref={panel} className={`${styles.card} ${styles.panel} ${compact ? styles.compact : ''}`} aria-label={t('watchRoom.room')}
        onKeyDown={event => { event.stopPropagation(); if (event.key === 'Escape') closeMenus(true); }}>
        <header className={styles.panelHeader}>
            <h2>{compact ? room?.title ?? t('watchRoom.room') : t('watchRoom.room')}</h2>
            <span className={styles.connection}><i className={`${styles.dot} ${status === 'connected' ? styles.online : ''}`} aria-hidden="true" />{t(`roomV2.status.${status}`)}</span>
        </header>
        {status === 'replaced' && activeRoomId && <div className={styles.notice}>
            <p>{t('roomV2.status.replaced')}</p>
            <button type="button" disabled={pending} onClick={() => { void join(activeRoomId, room?.joinCode, true).catch(() => setActionError(t('watchRoom.connectionError'))); }}>{t('roomV2.continueHere')}</button>
        </div>}
        {room && <>
            {room.barrier && <div className={styles.waiting} role="status">
                <strong>{seconds > 0 ? t('roomUX.waitCountdown', { seconds }) : t('roomUX.waitContinue')}</strong>
                <p>{t('roomUX.waitHint')}</p>
                {blocked.length > 0 && <small>{t('roomUX.waitFor', { names: blocked.map(p => p.login).join(', ') })}</small>}
                <div className={styles.waitProgress} aria-hidden="true"><span style={{ width: `${seconds / 7 * 100}%` }} /></div>
            </div>}
            <div className={styles.tabs} role="tablist" aria-label={t('watchRoom.room')} onKeyDown={event => {
                if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                event.preventDefault();
                const next = event.key === 'Home' ? 'chat' : event.key === 'End' ? 'room' : activeTab === 'chat' ? 'room' : 'chat';
                closeMenus(); setActiveTab(next);
                document.getElementById(`${id}-tab-${next}`)?.focus();
            }}>
                <button type="button" role="tab" id={`${id}-tab-chat`} aria-controls={`${id}-chat`} aria-selected={activeTab === 'chat'} tabIndex={activeTab === 'chat' ? 0 : -1} onClick={() => { closeMenus(); setActiveTab('chat'); }}>{t('roomSocial.chat')}</button>
                <button type="button" role="tab" id={`${id}-tab-room`} aria-controls={`${id}-room`} aria-selected={activeTab === 'room'} tabIndex={activeTab === 'room' ? 0 : -1} onClick={() => setActiveTab('room')}>{t('roomUX.roomTab')} <span className={styles.tabCount}>{room.participants.length}</span></button>
            </div>
            <div id={`${id}-room`} role="tabpanel" aria-labelledby={`${id}-tab-room`} hidden={activeTab !== 'room'} className={styles.roomDetails}>
            <div className={styles.roleInfo}><span className={styles.badge}>{t(`roomUX.${role}`)}</span><p>{t(`roomUX.${role}Hint`)}</p></div>
            {isHost && <div className={styles.pausePermission}>
                <div><strong>{t('roomUX.pauseForEveryone')}</strong><p>{t('roomUX.pauseForEveryoneHint')}</p></div>
                <Toggle checked={room.allowParticipantPause !== false} disabled={pending || status !== 'connected'} label={t('roomUX.pauseForEveryone')} onChange={allow => { void act({ type: 'set_pause_permission', allow }); }} />
            </div>}
            <section className={styles.invitation} aria-label={t('roomUX.invite')}>
                <div className={styles.sectionHeading}><h3>{t('roomUX.invite')}</h3><span className={styles.muted}>{t(room.visibility === 'private' ? 'watchRoom.privateRoom' : 'watchRoom.publicRoom')}</span></div>
                <button type="button" className={styles.inviteButton} onClick={() => void copy('link')}>{t('watchRoom.copyLink')}</button>
                <button type="button" className={styles.codeButton} onClick={() => void copy('code')} aria-label={`${t('watchRoom.copyCode')}: ${room.joinCode}`}>
                    <span>{t('watchRoom.code')}</span><strong>{room.joinCode}</strong>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M7 17L17 7M7 7h10v10" />
                    </svg>
                </button>
                {!compact && <small className={styles.muted}>{t('roomUX.codeHint')}</small>}
            </section>
            <section aria-labelledby={`${id}-participants`}>
                <h3 id={`${id}-participants`} className={styles.sectionTitle}>{t('watchRoom.participantsTitle', { count: room.participants.length })}</h3>
                <div className={styles.participants}>{room.participants.map(p => <div key={p.profileId} className={styles.participantRow}>
                    <span className={styles.avatar}>{p.avatar ? <RemoteImage src={p.avatar} alt="" /> : p.login[0]?.toUpperCase()}</span>
                    <div className={styles.participantText}>
                        <strong>{p.login}{p.profileId === profileId && <span className={styles.muted}> · {t('roomUX.you')}</span>}</strong>
                        <span className={styles.participantStatus}>{!p.connected ? t('roomV2.offline') : !p.viewing ? t('roomV2.outsidePlayer') : p.status === 'loading' && p.excludedEpoch === room.syncEpoch ? t('roomV2.catchingUp') : t(`roomV2.media.${p.status}`)}</span>
                        {p.error && <small className={styles.inlineError}>{p.error}</small>}
                    </div>
                    {p.profileId === room.hostId ? <span className={styles.roleBadge}>{t('roomUX.host')}</span> : p.canControl && <span className={styles.roleBadge}>{t('roomUX.controller')}</span>}
                    {isHost && p.profileId !== profileId && <details className={styles.participantMenu}>
                        <summary aria-label={t('watchRoom.actionsFor', { login: p.login })}><ActionIcon name="more" /></summary>
                        <div className={styles.menuActions}>
                            <button type="button" disabled={pending || status !== 'connected'} onClick={() => void act({ type: p.canControl ? 'revoke_control' : 'grant_control', profileId: p.profileId })}>{t(p.canControl ? 'watchRoom.revokeControl' : 'watchRoom.grantControl')}</button>
                            <button type="button" disabled={pending || !p.connected || status !== 'connected'} onClick={() => { closeMenus(); setActionError(''); setConfirmation({ type: 'transfer_host', participant: p }); }}>{t('roomV2.transferHost')}</button>
                            <button type="button" className={styles.dangerText} disabled={pending || status !== 'connected'} onClick={() => { closeMenus(); setActionError(''); setConfirmation({ type: 'kick', participant: p }); }}>{t('watchRoom.kick')}</button>
                        </div>
                    </details>}
                </div>)}</div>
            </section>
            </div>
            <div id={`${id}-chat`} role="tabpanel" aria-labelledby={`${id}-tab-chat`} hidden={activeTab !== 'chat'} className={styles.chatPanel}>
            <section className={styles.reactionsSection} aria-label={t('roomSocial.reactions')}>
                <div className={styles.reactionsBar} role="toolbar" aria-label={t('roomSocial.reactions')} onKeyDown={event => {
                    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                    const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
                    const index = buttons.indexOf(event.target as HTMLButtonElement);
                    if (index < 0) return;
                    event.preventDefault();
                    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
                        : (index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
                    buttons[next]?.focus();
                }}>
                    {REACTION_ITEMS.map(emoji => (
                        <button
                            key={emoji}
                            type="button"
                            className={styles.reactionBtn}
                            title={t(`roomSocial.reaction.${emoji}`)}
                            aria-label={t(`roomSocial.reaction.${emoji}`)}
                            disabled={pending || status !== 'connected'}
                            onClick={() => void sendReaction(emoji).catch(() => {})}
                        >
                            <ReactionIcon emoji={emoji} size={20} />
                        </button>
                    ))}
                </div>
            </section>
            <section className={styles.chatSection} aria-label={t('roomSocial.chat')}>
                {!compact && <ReactionOverlay compact />}
                <RoomChat compact={compact} fill key={room?.roomId ?? 'room-chat'} />
            </section>
            </div>
        </>}
        {notice && <p className={styles.success} role="status">{notice}</p>}
        {(actionError || (error && status !== 'replaced')) && <p role="alert" className={styles.inlineError}>{actionError || t(roomErrorKey(error!))}</p>}
        <footer className={styles.panelFooter}>
            {isHost && (
                <button
                    type="button"
                    className={styles.closeRoomButton}
                    disabled={pending || status !== 'connected'}
                    onClick={() => { closeMenus(); setActionError(''); setConfirmation({ type: 'close_room' }); }}
                >
                    {t('watchRoom.closeRoom')}
                </button>
            )}
            <button type="button" className={styles.leaveButton} disabled={pending} onClick={() => { if (isHost) setConfirmation({ type: 'leave' }); else void exit(); }}>{t('watchRoom.leave')}</button>
        </footer>
        <dialog ref={dialog} className={styles.confirmDialog} aria-labelledby={`${id}-confirm-title`} onClose={() => setConfirmation(null)} onCancel={event => { if (pending) event.preventDefault(); }}>
            <h2 id={`${id}-confirm-title`}>{confirmTitle}</h2>
            <p>{confirmation && t(
                confirmation.type === 'leave' ? 'roomUX.leaveHostHint'
                : confirmation.type === 'close_room' ? 'watchRoom.closeRoomHint'
                : confirmation.type === 'kick' ? 'roomUX.kickHint' : 'roomUX.transferHint'
            )}</p>
            {actionError && <p className={styles.inlineError} role="alert">{actionError}</p>}
            <div className={styles.dialogActions}>
                <button type="button" className={styles.secondary} disabled={pending} onClick={() => setConfirmation(null)} autoFocus>{t('misc.cancel')}</button>
                <button type="button" className={confirmation?.type === 'kick' || confirmation?.type === 'leave' || confirmation?.type === 'close_room' ? styles.dangerButton : ''} disabled={pending} onClick={() => void confirm()}>{pending ? t('roomUX.working') : t(
                    confirmation?.type === 'leave' ? 'roomUX.confirmLeave'
                    : confirmation?.type === 'close_room' ? 'watchRoom.confirmClose'
                    : confirmation?.type === 'kick' ? 'roomUX.confirmKick' : 'roomUX.confirmTransfer'
                )}</button>
            </div>
        </dialog>
    </aside>;
}
