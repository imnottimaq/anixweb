import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useUser } from '../shared/contexts/userContext';
import { createWatchRoom, getPublicWatchRooms, getWatchRoomProfile, resolveWatchRoomCode, type RoomVisibility, type WatchRoomState, WatchRoomSocket } from '../shared/watchRoom';
import type { Anime } from '../shared/types/api';
import { getRoomParticipant } from '../shared/roomParticipant';
import RemoteImage from '../components/RemoteImage';
import { useRoomPresence } from '../shared/contexts/roomContext';
import { useTranslation } from '../shared/useTranslation';
import styles from './WatchRoomScreen.module.css';
import { useApi } from '../shared/apiClient';

type ParticipantProfile = { login: string; avatar: string | null };

export default function WatchRoomScreen() {
    const { roomId } = useParams<{ roomId: string }>();
    return roomId ? <ConnectedRoom roomId={roomId} /> : <WatchRoomLobby />;
}

function WatchRoomLobby() {
    const navigate = useNavigate();
    const { userId } = useUser();
    const { t, selectPlural } = useTranslation();
    const [title, setTitle] = useState(() => t('watchRoom.defaultTitle'));
    const [visibility, setVisibility] = useState<RoomVisibility>('private');
    const [joinCode, setJoinCode] = useState('');
    const [rooms, setRooms] = useState<Array<{ roomId: string; title: string; participants: number; media: WatchRoomState['media'] }>>([]);
    const [message, setMessage] = useState('');

    const participantCount = (count: number) => t(`watchRoom.participants.${selectPlural(count)}` as Parameters<typeof t>[0], { count });
    const loadRooms = useCallback(async () => {
        try { setRooms((await getPublicWatchRooms()).rooms); }
        catch (error) { console.error('Failed to load watch rooms:', error); setMessage(t('watchRoom.loadError')); }
    }, [t]);

    useEffect(() => {
        const timeout = window.setTimeout(() => { void loadRooms(); }, 0);
        return () => window.clearTimeout(timeout);
    }, [loadRooms]);

    const create = async () => {
        if (userId <= 0) return setMessage(t('watchRoom.signInCreate'));
        try {
            const room = await createWatchRoom({ title, visibility, host: getRoomParticipant(userId) });
            navigate(`/together/${room.roomId}`);
        } catch (error) { console.error('Failed to create watch room:', error); setMessage(t('watchRoom.createError')); }
    };
    const joinByCode = async () => {
        try {
            const room = await resolveWatchRoomCode(joinCode);
            navigate(`/together/${room.roomId}`);
        } catch (error) { console.error('Failed to join watch room:', error); setMessage(t('watchRoom.joinError')); }
    };

    return <section className={styles.page}>
        <div className={styles.hero}><h1>{t('watchRoom.title')} <span className={styles.beta}>{t('watchRoom.beta')}</span></h1><p>{t('watchRoom.description')}</p></div>
        <div className={styles.grid}>
            <form className={styles.card} onSubmit={event => { event.preventDefault(); void create(); }}>
                <h2>{t('watchRoom.new')}</h2>
                <label>{t('watchRoom.name')}<input value={title} maxLength={80} onChange={event => setTitle(event.target.value)} /></label>
                <label>{t('watchRoom.visibility')}<select value={visibility} onChange={event => setVisibility(event.target.value as RoomVisibility)}><option value="private">{t('watchRoom.private')}</option><option value="public">{t('watchRoom.public')}</option></select></label>
                <button type="submit">{t('watchRoom.create')}</button>
                <div className={styles['join-by-code']}><label>{t('watchRoom.code')}<input value={joinCode} maxLength={8} placeholder="AB12CD34" onChange={event => setJoinCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} /></label><button type="button" disabled={joinCode.length !== 8} onClick={() => void joinByCode()}>{t('watchRoom.joinCode')}</button></div>
            </form>
            <div className={styles.card}><div className={styles.cardHeading}><h2>{t('watchRoom.publicRooms')}</h2><button type="button" onClick={() => void loadRooms()}>{t('watchRoom.refresh')}</button></div>
                {rooms.length === 0 ? <p className={styles.muted}>{t('watchRoom.noRooms')}</p> : <div className={styles.rooms}>{rooms.map(room => <Link key={room.roomId} to={`/together/${room.roomId}`}><strong>{room.title}</strong><span>{room.media?.releaseName ?? t('watchRoom.noEpisode')} · {participantCount(room.participants)}</span></Link>)}</div>}
            </div>
        </div>
        {message && <p className={styles.error}>{message}</p>}
    </section>;
}

function ConnectedRoom({ roomId }: { roomId: string }) {
    const navigate = useNavigate();
    const { userId } = useUser();
    const api = useApi();
    const { setActiveRoomId } = useRoomPresence();
    const { t, language } = useTranslation();
    const socketRef = useRef(new WatchRoomSocket());
    const [room, setRoom] = useState<WatchRoomState | null>(null);
    const [message, setMessage] = useState(() => t('watchRoom.connectingRoom'));
    const [releaseQuery, setReleaseQuery] = useState('');
    const [releaseResults, setReleaseResults] = useState<Anime[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const [participantProfiles, setParticipantProfiles] = useState<Record<number, ParticipantProfile>>({});
    const [unavailableProfiles, setUnavailableProfiles] = useState<number[]>([]);
    const [openParticipantMenu, setOpenParticipantMenu] = useState<number | null>(null);
    const isController = useMemo(() => Boolean(room?.participants.find(item => item.profileId === userId)?.canControl), [room, userId]);
    const releaseTitle = (release: Anime) => language === 'english' ? release.title_original || release.title_ru : release.title_ru || release.title_original;

    useEffect(() => { setActiveRoomId(roomId); }, [roomId, setActiveRoomId]);
    useEffect(() => {
        const previousTitle = document.title;
        const mediaTitle = room?.media ? `${room.media.releaseName} · ${room.media.episodeName}` : room?.title ?? t('watchRoom.title');
        document.title = `${mediaTitle} — Anixart`;
        return () => { document.title = previousTitle; };
    }, [room?.media, room?.title, t]);

    useEffect(() => {
        const socket = socketRef.current;
        if (userId <= 0) {
            const timeout = window.setTimeout(() => setMessage(t('watchRoom.signInJoin')), 0);
            return () => window.clearTimeout(timeout);
        }
        socket.connect(roomId, getRoomParticipant(userId), state => { setRoom(state); setMessage(''); }, error => {
            console.error('Watch room connection error:', error);
            setMessage(t('watchRoom.connectionError'));
        }, () => { setActiveRoomId(null); navigate('/together', { replace: true }); });
        const interval = window.setInterval(() => socket.send({ type: 'sync_request' }), 15_000);
        return () => { window.clearInterval(interval); socket.disconnect(); };
    }, [navigate, roomId, setActiveRoomId, t, userId]);

    useEffect(() => { if (room?.media) navigate(roomMediaUrl(roomId, room.media), { replace: true }); }, [navigate, room?.media, roomId]);
    useEffect(() => {
        if (!room?.participants.length) return;
        let cancelled = false;
        const missingIds = room.participants.map(participant => participant.profileId).filter(profileId => !participantProfiles[profileId] && !unavailableProfiles.includes(profileId));
        if (!missingIds.length) return;
        void Promise.all(missingIds.map(async profileId => {
            const data = await getWatchRoomProfile(profileId);
            return data?.profile?.login ? [profileId, { login: data.profile.login, avatar: data.profile.avatar ?? null }] as const : profileId;
        })).then(results => {
            if (cancelled) return;
            const unavailable = results.filter((item): item is number => typeof item === 'number');
            const loaded = Object.fromEntries(results.filter((item): item is readonly [number, ParticipantProfile] => Array.isArray(item)));
            if (Object.keys(loaded).length) setParticipantProfiles(previous => ({ ...previous, ...loaded }));
            if (unavailable.length) setUnavailableProfiles(previous => [...new Set([...previous, ...unavailable])]);
        }).catch(error => console.error('Failed to load participant profiles:', error));
        return () => { cancelled = true; };
    }, [participantProfiles, room?.participants, unavailableProfiles]);

    useEffect(() => {
        const query = releaseQuery.trim();
        if (!isController || room?.media || query.length < 2) return;
        let isCurrent = true;
        const timeout = window.setTimeout(() => {
            setIsSearching(true);
            searchReleases(query, api).then(results => { if (isCurrent) setReleaseResults(results); }).catch(error => {
                console.error('Failed to search releases:', error);
                if (isCurrent) setMessage(t('watchRoom.searchError'));
            }).finally(() => { if (isCurrent) setIsSearching(false); });
        }, 350);
        return () => { isCurrent = false; window.clearTimeout(timeout); };
    }, [api, isController, releaseQuery, room?.media, t]);

    const grant = (profileId: number, canControl: boolean) => socketRef.current.send({ type: canControl ? 'grant_control' : 'revoke_control', profileId });
    const kick = (profileId: number) => { socketRef.current.send({ type: 'kick', profileId }); setOpenParticipantMenu(null); };
    const leaveRoom = () => { socketRef.current.send({ type: 'leave' }); socketRef.current.disconnect(); setActiveRoomId(null); navigate('/together'); };

    return <section className={styles.page}>
        <Link className={styles.back} to="/together">← {t('watchRoom.allRooms')}</Link>
        <div className={styles.roomHeader}><div><h1>{room?.title ?? t('watchRoom.room')}</h1><p>{room ? (room.visibility === 'private' ? t('watchRoom.privateRoom') : t('watchRoom.publicRoom')) : t('watchRoom.connecting')}{room?.joinCode ? ` · ${t('watchRoom.codeValue', { code: room.joinCode })}` : ''}</p></div><div className={styles['room-actions']}><button className={styles['copy-link']} type="button" onClick={() => navigator.clipboard.writeText(window.location.href)}>{t('watchRoom.copyLink')}</button>{room?.joinCode && <button className={styles['copy-link']} type="button" onClick={() => navigator.clipboard.writeText(room.joinCode)}>{t('watchRoom.copyCode')}</button>}<button className={styles['leave-room']} type="button" onClick={leaveRoom}>{t('watchRoom.leave')}</button></div></div>
        <div className={styles.grid}>
            <div className={styles.card}><h2>{t('watchRoom.nowWatching')}</h2>{room?.media ? <><strong>{room.media.releaseName}</strong><p>{room.media.episodeName}</p><Link className={styles['open-release']} to={`/anime/${room.media.releaseId}?room=${encodeURIComponent(roomId)}`}>{t('watchRoom.openRelease')}</Link></> : isController ? <><p className={styles.muted}>{t('watchRoom.selectHint')}</p><label className={styles['search-label']}>{t('watchRoom.searchAnime')}<input autoFocus value={releaseQuery} placeholder={t('watchRoom.searchPlaceholder')} onChange={event => { const value = event.target.value; setReleaseQuery(value); if (value.trim().length < 2) { setReleaseResults([]); setIsSearching(false); } }} /></label>{isSearching && <p className={styles.muted}>{t('watchRoom.searching')}</p>}{releaseQuery.trim().length >= 2 && !isSearching && <div className={styles['release-results']}>{releaseResults.length ? releaseResults.map(release => <Link key={release.id} to={`/anime/${release.id}?room=${encodeURIComponent(roomId)}`} state={{ partialAnime: release }}><strong>{releaseTitle(release)}</strong><span>{release.year || t('watchRoom.unknownYear')} · {t('watchRoom.episodeCount', { count: release.episodes_released || 0 })}</span></Link>) : <p className={styles.muted}>{t('watchRoom.nothingFound')}</p>}</div>}</> : <p className={styles.muted}>{t('watchRoom.waitingHost')}</p>}</div>
            <div className={styles.card}><h2>{t('watchRoom.participantsTitle', { count: room?.participants.length ?? 0 })}</h2><div className={styles.participants}>{room?.participants.map(participant => {
                const profile = participantProfiles[participant.profileId];
                const login = profile?.login ?? participant.login;
                const avatar = profile?.avatar ?? participant.avatar;
                const canManage = userId === room?.hostId && participant.profileId !== userId;
                return <div key={participant.profileId}><span className={styles.participant}><span className={styles.avatar}>{avatar ? <RemoteImage src={avatar} alt={t('watchRoom.avatarAlt', { login })} /> : login[0]?.toUpperCase()}</span><span>{login}{participant.profileId === room.hostId ? ` · ${t('watchRoom.host')}` : ''}</span></span>{canManage && <div className={styles['participant-menu-wrap']}><button className={styles['participant-menu-button']} type="button" aria-label={t('watchRoom.actionsFor', { login })} onClick={() => setOpenParticipantMenu(current => current === participant.profileId ? null : participant.profileId)}>⋮</button>{openParticipantMenu === participant.profileId && <div className={styles['participant-menu']}>{room?.visibility === 'public' && <button type="button" onClick={() => { grant(participant.profileId, !participant.canControl); setOpenParticipantMenu(null); }}>{participant.canControl ? t('watchRoom.revokeControl') : t('watchRoom.grantControl')}</button>}<button className={styles['kick-button']} type="button" onClick={() => kick(participant.profileId)}>{t('watchRoom.kick')}</button></div>}</div>}</div>;
            })}</div></div>
        </div>
        {message && <p className={styles.error}>{message}</p>}
    </section>;
}

async function searchReleases(query: string, api: ReturnType<typeof useApi>) {
    const response = await api.post<{code: number; releases?: Anime[]; content?: Anime[]}>('/search/releases/0', {query, searchBy: 0}, {'Api-Version': 'v2'});
    return response.releases ?? response.content ?? [];
}

function roomMediaUrl(roomId: string, media: NonNullable<WatchRoomState['media']>) {
    const params = new URLSearchParams({ room: roomId, dub: String(media.dubId), source: String(media.sourceId), episode: String(media.episode) });
    return `/anime/${media.releaseId}?${params.toString()}`;
}
