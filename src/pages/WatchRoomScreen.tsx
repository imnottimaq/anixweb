import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useRoomPresence } from '../shared/contexts/roomContext';
import { useUser } from '../shared/contexts/userContext';
import { useTranslation } from '../shared/useTranslation';
import { getPublicWatchRooms } from '../shared/watchRoom';
import { roomErrorKey } from '../shared/roomError';
import type { PublicRoom, RoomMedia } from '../shared/roomProtocol';
import type { Anime } from '../shared/types/api';
import { useApi } from '../shared/apiClient';
import RoomPanel from '../components/RoomPanel';
import RoomMediaPicker from '../components/RoomMediaPicker';
import RemoteImage from '../components/RemoteImage';
import PlayIcon from '../assets/icons/play.svg';
import CreateRoomModal from '../modals/CreateRoomModal';
import JoinRoomModal from '../modals/JoinRoomModal';
import styles from './WatchRoomScreen.module.css';

export default function WatchRoomScreen() {
    const { roomId } = useParams();
    return roomId ? <ConnectedRoom key={roomId} roomId={roomId} /> : <Lobby />;
}

function Lobby() {
    const { activeRoomId, room } = useRoomPresence();
    const { userToken } = useUser();
    const { t, selectPlural } = useTranslation();
    const [isCreateOpen, setIsCreateOpen] = useState(false);
    const [isJoinOpen, setIsJoinOpen] = useState(false);
    const [rooms, setRooms] = useState<PublicRoom[]>([]);
    const [cursor, setCursor] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [listError, setListError] = useState('');
    const request = useRef(0);
    const load = useCallback(async (after?: string) => {
        const current = ++request.current;
        setLoading(true); setListError('');
        try {
            const result = await getPublicWatchRooms(after);
            if (current !== request.current) return;
            setRooms(previous => after ? [...previous, ...result.rooms.filter(r => !previous.some(p => p.roomId === r.roomId))] : result.rooms);
            setCursor(result.cursor);
        } catch { if (current === request.current) setListError(t('watchRoom.loadError')); }
        finally { if (current === request.current) setLoading(false); }
    }, [t]);
    useEffect(() => {
        let active = true;
        const timer = window.setTimeout(() => { if (active) void load(); }, 0);
        return () => { active = false; window.clearTimeout(timer); };
    }, [load]);

    return <section className={styles.page}>
        <header className={styles.hero}>
            <h1 className={styles.heroTitle}>{t('watchRoom.title')}</h1>
            <div className={styles.heroActions}>
                <button
                    type="button"
                    className={styles.secondaryButton}
                    onClick={() => setIsJoinOpen(true)}
                >
                    {t('watchRoom.joinCode')}
                </button>
                <button
                    type="button"
                    className={styles.primaryButton}
                    onClick={() => setIsCreateOpen(true)}
                >
                    {t('watchRoom.create')}
                </button>
            </div>
            <p className={styles.heroDescription}>{t('watchRoom.description')}</p>
        </header>
        {activeRoomId && <div className={styles.activeRoom}><div><span className={styles.eyebrow}>{t('roomUX.activeTitle')}</span><strong>{room?.title ?? t('watchRoom.room')}</strong></div><Link className={styles.primaryLink} to={`/together/${activeRoomId}`}>{t('roomUX.returnRoom')} →</Link></div>}
        {!userToken && <div className={styles.signIn}><div><strong>{t('roomUX.signInTitle')}</strong><p>{t('roomUX.signInHint')}</p></div><Link className={styles.primaryLink} to="/account/login">{t('nav.account')}</Link></div>}
        <section className={styles.publicSection} aria-labelledby="public-rooms-title" aria-busy={loading}>
            <header className={styles.sectionHeading}><div><h2 id="public-rooms-title">{t('watchRoom.publicRooms')}</h2><p className={styles.muted}>{t('roomUX.publicHintList')}</p></div><button className={styles.secondary} type="button" disabled={loading} onClick={() => void load()}>{t('watchRoom.refresh')}</button></header>
            {listError && <p role="alert" className={styles.inlineError}>{listError}</p>}
            <div className={styles.rooms}>{rooms.map(r => <Link key={r.roomId} to={`/together/${r.roomId}`} className={styles.roomCard}>
                <span className={styles.roomIcon} aria-hidden="true"><img src={PlayIcon} alt="" /></span><div><strong>{r.title}</strong><p>{r.media?.releaseName ?? t('watchRoom.noEpisode')}</p>{r.media && <small>{r.media.episodeName}</small>}</div><span className={styles.roomCount}>{t(`watchRoom.participants.${selectPlural(r.participants)}`, { count: r.participants })}<span aria-hidden="true"> ↗</span></span>
            </Link>)}</div>
            {loading && <p role="status" className={styles.muted}>{t('page.loading')}</p>}
            {!rooms.length && !loading && !listError && <div className={styles.emptyState}><strong>{t('roomUX.emptyRooms')}</strong><p>{t('roomUX.emptyRoomsHint')}</p></div>}
            {cursor && <button type="button" className={styles.secondary} disabled={loading} onClick={() => void load(cursor)}>{t('roomV2.loadMore')}</button>}
        </section>

        <CreateRoomModal isOpen={isCreateOpen} onClose={() => setIsCreateOpen(false)} />
        <JoinRoomModal isOpen={isJoinOpen} onClose={() => setIsJoinOpen(false)} />
    </section>;
}

function ConnectedRoom({ roomId }: { roomId: string }) {
    const { room: state, join, status, self, send } = useRoomPresence();
    const room = state?.roomId === roomId ? state : null;
    const { userToken, userId } = useUser();
    const { t, language } = useTranslation();
    const [params] = useSearchParams();
    const code = params.get('code') ?? undefined;
    const api = useApi();
    const navigate = useNavigate();
    const searchInput = useRef<HTMLInputElement>(null);
    const [query, setQuery] = useState('');
    const [result, setResult] = useState<{ query: string; status: 'loading' | 'ready' | 'error'; items: Anime[] }>({ query: '', status: 'ready', items: [] });
    const [selected, setSelected] = useState<Anime | null>(null);
    const [joinError, setJoinError] = useState('');
    const canControl = status === 'connected' && (room?.participants.some(p => p.profileId === (self?.profileId ?? userId) && p.canControl) ?? false);
    const normalizedQuery = query.trim();
    useEffect(() => { if (userToken) void join(roomId, code).catch(cause => setJoinError(t(roomErrorKey(cause instanceof Error ? cause.message : '')))); }, [join, roomId, code, userToken, t]);
    useEffect(() => {
        if (!canControl || normalizedQuery.length < 2 || selected) return;
        let current = true;
        const timeout = window.setTimeout(() => {
            setResult({ query: normalizedQuery, status: 'loading', items: [] });
            void api.post<{ releases?: Anime[]; content?: Anime[] }>('/search/releases/0', { query: normalizedQuery, searchBy: 0 }, { 'Api-Version': 'v2' })
                .then(data => { if (current) setResult({ query: normalizedQuery, status: 'ready', items: data.releases ?? data.content ?? [] }); })
                .catch(() => { if (current) setResult({ query: normalizedQuery, status: 'error', items: [] }); });
        }, 350);
        return () => { current = false; window.clearTimeout(timeout); };
    }, [api, canControl, normalizedQuery, selected]);
    const cancelSelection = () => { setSelected(null); window.requestAnimationFrame(() => searchInput.current?.focus()); };
    const selectMedia = async (media: RoomMedia) => {
        await send({ type: 'set_media', media });
        navigate(`/anime/${media.releaseId}/watch?room=${encodeURIComponent(roomId)}`);
    };
    const searching = normalizedQuery.length >= 2 && (result.query !== normalizedQuery || result.status === 'loading');

    return <section className={styles.page}>
        <Link className={styles.back} to="/together">← {t('watchRoom.allRooms')}</Link>
        <header className={styles.roomPageHeader}><div><span className={styles.eyebrow}>{t('watchRoom.title')}</span><h1>{room?.title ?? t('watchRoom.room')}</h1></div>{room && <span className={styles.badge}>{t(room.visibility === 'private' ? 'watchRoom.privateRoom' : 'watchRoom.publicRoom')}</span>}</header>
        {!userToken ? <div className={styles.signIn}><p>{t('roomUX.signInHint')}</p><Link className={styles.primaryLink} to="/account/login">{t('nav.account')}</Link></div> : <div className={styles.roomGrid}>
            <div className={styles.roomContent}>
                <section className={`${styles.card} ${styles.mediaHero}`} aria-labelledby="room-media-title">
                    <span className={styles.mediaIcon} aria-hidden="true"><img src={PlayIcon} alt="" /></span>
                    <div><p className={styles.eyebrow}>{room?.media ? t('watchRoom.nowWatching') : t('watchRoom.title')}</p><h2 id="room-media-title">{room?.media?.releaseName ?? t('roomUX.emptyMedia')}</h2>
                        <p className={styles.muted}>{room?.media?.episodeName ?? t(canControl ? 'roomUX.emptyMediaHint' : 'roomUX.waitHostHint')}</p>
                        {room?.media && <div className={styles.mediaActions}><Link className={styles.primaryLink} to={`/anime/${room.media.releaseId}/watch?room=${encodeURIComponent(roomId)}`}>{t('roomUX.startTogether')} <span aria-hidden="true">→</span></Link><span className={styles.muted}>{room.barrier ? t('roomV2.waiting') : t(room.playback.paused ? 'roomUX.paused' : 'roomUX.playing')}</span></div>}
                    </div>
                </section>
                {canControl && (selected ? <RoomMediaPicker release={selected} onCancel={cancelSelection} onSelected={selectMedia} disabled={status !== 'connected'} /> : <section className={styles.card} aria-labelledby="room-search-title">
                    <h2 id="room-search-title">{t('roomUX.chooseAnime')}</h2>
                    <label className={styles.field}>{t('watchRoom.searchAnime')}<input ref={searchInput} value={query} placeholder={t('watchRoom.searchPlaceholder')} onChange={event => setQuery(event.target.value)} /></label>
                    {normalizedQuery.length < 2 ? <p className={styles.fieldHint}>{t('roomUX.searchHint')}</p> : searching ? <p role="status" className={styles.muted}>{t('watchRoom.searching')}</p> : result.status === 'error' ? <p role="alert" className={styles.inlineError}>{t('watchRoom.searchError')}</p> : <div className={styles.searchResults}>
                        {result.items.length ? result.items.map(release => <button type="button" key={release.id} className={styles.searchResult} onClick={() => setSelected(release)}>
                            {release.image && <RemoteImage src={release.image} alt="" loading="lazy" />}<span><strong>{language === 'english' ? release.title_original || release.title_ru : release.title_ru || release.title_original}</strong><small>{release.year || t('watchRoom.unknownYear')} · {t('watchRoom.episodeCount', { count: release.episodes_released || 0 })}</small></span><span aria-hidden="true">→</span>
                        </button>) : <p className={styles.muted}>{t('roomUX.searchEmpty')}</p>}
                    </div>}
                </section>)}
                {joinError && <p role="alert" className={styles.inlineError}>{joinError}</p>}
            </div>
            <RoomPanel />
        </div>}
    </section>;
}
