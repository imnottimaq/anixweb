import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useUser } from '../shared/contexts/userContext';
import { createWatchRoom, getPublicWatchRooms, getWatchRoomProfile, resolveWatchRoomCode, type RoomVisibility, type WatchRoomState, WatchRoomSocket } from '../shared/watchRoom';
import type { Anime } from '../shared/types/api';
import { getRoomParticipant } from '../shared/roomParticipant';
import RemoteImage from '../components/RemoteImage';
import { useRoomPresence } from '../shared/contexts/roomContext';

type ParticipantProfile = { login: string; avatar: string | null };
import styles from './WatchRoomScreen.module.css';
import { useApi } from '../shared/apiClient';

export default function WatchRoomScreen() {
    const { roomId } = useParams<{ roomId: string }>();
    return roomId ? <ConnectedRoom roomId={roomId} /> : <WatchRoomLobby />;
}

function WatchRoomLobby() {
    const navigate = useNavigate();
    const { userId } = useUser();
    const [title, setTitle] = useState('Совместный просмотр');
    const [visibility, setVisibility] = useState<RoomVisibility>('private');
    const [joinCode, setJoinCode] = useState('');
    const [rooms, setRooms] = useState<Array<{ roomId: string; title: string; participants: number; media: WatchRoomState['media'] }>>([]);
    const [message, setMessage] = useState('');

    const loadRooms = async () => {
        try { setRooms((await getPublicWatchRooms()).rooms); }
        catch (error) { setMessage(error instanceof Error ? error.message : 'Не удалось загрузить комнаты'); }
    };

    useEffect(() => { void loadRooms(); }, []);

    const create = async () => {
        if (userId <= 0) return setMessage('Войдите в аккаунт, чтобы создать комнату');
        try {
            const room = await createWatchRoom({ title, visibility, host: getRoomParticipant(userId) });
            navigate(`/together/${room.roomId}`);
        } catch (error) { setMessage(error instanceof Error ? error.message : 'Не удалось создать комнату'); }
    };
    const joinByCode = async () => {
        try {
            const room = await resolveWatchRoomCode(joinCode);
            navigate(`/together/${room.roomId}`);
        } catch (error) { setMessage(error instanceof Error ? error.message : 'Не удалось войти в комнату'); }
    };

    return <section className={styles.page}>
        <div className={styles.hero}><h1>Совместный просмотр <span className={styles.beta}>Бета</span></h1><p>Создай комнату, выбери серию и смотри синхронно с друзьями.</p></div>
        <div className={styles.grid}>
            <form className={styles.card} onSubmit={event => { event.preventDefault(); void create(); }}>
                <h2>Новая комната</h2>
                <label>Название<input value={title} maxLength={80} onChange={event => setTitle(event.target.value)} /></label>
                <label>Доступ<select value={visibility} onChange={event => setVisibility(event.target.value as RoomVisibility)}><option value="private">Приватная — по ссылке</option><option value="public">Открытая — в каталоге</option></select></label>
                <button type="submit">Создать комнату</button>
                <div className={styles['join-by-code']}><label>Код комнаты<input value={joinCode} maxLength={8} placeholder="AB12CD34" onChange={event => setJoinCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} /></label><button type="button" disabled={joinCode.length !== 8} onClick={() => void joinByCode()}>Войти по коду</button></div>
            </form>
            <div className={styles.card}><div className={styles.cardHeading}><h2>Открытые комнаты</h2><button type="button" onClick={() => void loadRooms()}>Обновить</button></div>
                {rooms.length === 0 ? <p className={styles.muted}>Сейчас здесь пусто.</p> : <div className={styles.rooms}>{rooms.map(room => <Link key={room.roomId} to={`/together/${room.roomId}`}><strong>{room.title}</strong><span>{room.media?.releaseName ?? 'Серия ещё не выбрана'} · {room.participants} чел.</span></Link>)}</div>}
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
    const socketRef = useRef(new WatchRoomSocket());
    const [room, setRoom] = useState<WatchRoomState | null>(null);
    const [message, setMessage] = useState('Подключаемся к комнате…');
    const [releaseQuery, setReleaseQuery] = useState('');
    const [releaseResults, setReleaseResults] = useState<Anime[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const [participantProfiles, setParticipantProfiles] = useState<Record<number, ParticipantProfile>>({});
    const [unavailableProfiles, setUnavailableProfiles] = useState<number[]>([]);
    const [openParticipantMenu, setOpenParticipantMenu] = useState<number | null>(null);
    const isController = useMemo(() => Boolean(room?.participants.find(item => item.profileId === userId)?.canControl), [room, userId]);

    useEffect(() => { setActiveRoomId(roomId); }, [roomId, setActiveRoomId]);

    useEffect(() => {
        const previousTitle = document.title;
        const mediaTitle = room?.media
            ? `${room.media.releaseName} · ${room.media.episodeName}`
            : room?.title ?? 'Совместный просмотр';

        document.title = `${mediaTitle} — Anixart`;
        return () => { document.title = previousTitle; };
    }, [room?.media, room?.title]);

    useEffect(() => {
        const socket = socketRef.current
        if (userId <= 0) { setMessage('Войдите в аккаунт, чтобы подключиться к комнате'); return; }
        socket.connect(roomId, getRoomParticipant(userId), state => { setRoom(state); setMessage(''); }, setMessage, () => {
            setActiveRoomId(null);
            navigate('/together', { replace: true });
        });
        const interval = window.setInterval(() => socket.send({ type: 'sync_request' }), 15_000);
        return () => { window.clearInterval(interval); socket.disconnect(); };
    }, [navigate, roomId, setActiveRoomId, userId]);

    useEffect(() => {
        if (!room?.media) return;
        navigate(roomMediaUrl(roomId, room.media), { replace: true });
    }, [navigate, room?.media, roomId]);

    useEffect(() => {
        if (!room?.participants.length) return;
        let cancelled = false;
        const missingIds = room.participants
            .map(participant => participant.profileId)
            .filter(profileId => !participantProfiles[profileId] && !unavailableProfiles.includes(profileId));
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
        }).catch(error => console.error('Не удалось загрузить профили участников:', error));

        return () => { cancelled = true; };
    }, [participantProfiles, room?.participants, unavailableProfiles]);

    useEffect(() => {
        const query = releaseQuery.trim();
        if (!isController || room?.media || query.length < 2) return;

        let isCurrent = true;
        const timeout = window.setTimeout(() => {
            setIsSearching(true);
            searchReleases(query, api)
                .then(results => { if (isCurrent) setReleaseResults(results); })
                .catch(error => {
                    if (isCurrent) setMessage(error instanceof Error ? error.message : 'Не удалось выполнить поиск');
                })
                .finally(() => { if (isCurrent) setIsSearching(false); });
        }, 350);
        return () => {
            isCurrent = false;
            window.clearTimeout(timeout);
        };
    }, [api, isController, releaseQuery, room?.media]);

    const grant = (profileId: number, canControl: boolean) => socketRef.current.send({ type: canControl ? 'grant_control' : 'revoke_control', profileId });
    const kick = (profileId: number) => {
        socketRef.current.send({ type: 'kick', profileId });
        setOpenParticipantMenu(null);
    };
    const leaveRoom = () => {
        socketRef.current.send({ type: 'leave' });
        socketRef.current.disconnect();
        setActiveRoomId(null);
        navigate('/together');
    };
    return <section className={styles.page}>
        <Link className={styles.back} to="/together">← Все комнаты</Link>
        <div className={styles.roomHeader}><div><h1>{room?.title ?? 'Комната'}</h1><p>{room ? (room.visibility === 'private' ? 'Приватная комната' : 'Открытая комната') : 'Подключаемся…'}{room?.joinCode ? ` · код ${room.joinCode}` : ''}</p></div><div className={styles['room-actions']}><button className={styles['copy-link']} type="button" onClick={() => navigator.clipboard.writeText(window.location.href)}>Скопировать ссылку</button>{room?.joinCode && <button className={styles['copy-link']} type="button" onClick={() => navigator.clipboard.writeText(room.joinCode)}>Скопировать код</button>}<button className={styles['leave-room']} type="button" onClick={leaveRoom}>Покинуть</button></div></div>
        <div className={styles.grid}>
            <div className={styles.card}><h2>Сейчас смотрим</h2>{room?.media ? <><strong>{room.media.releaseName}</strong><p>{room.media.episodeName}</p><Link className={styles['open-release']} to={`/anime/${room.media.releaseId}?room=${encodeURIComponent(roomId)}`}>Открыть релиз</Link></> : isController ? <><p className={styles.muted}>Найди релиз, затем выбери озвучку и серию. После этого выбор автоматически попадёт всем в комнату.</p><label className={styles['search-label']}>Поиск аниме<input autoFocus value={releaseQuery} placeholder="Название аниме" onChange={event => {
                const value = event.target.value;
                setReleaseQuery(value);
                if (value.trim().length < 2) {
                    setReleaseResults([]);
                    setIsSearching(false);
                }
            }} /></label>{isSearching && <p className={styles.muted}>Ищем…</p>}{releaseQuery.trim().length >= 2 && !isSearching && <div className={styles['release-results']}>{releaseResults.length ? releaseResults.map(release => <Link key={release.id} to={`/anime/${release.id}?room=${encodeURIComponent(roomId)}`} state={{ partialAnime: release }}><strong>{release.title_ru}</strong><span>{release.year || 'Год неизвестен'} · {release.episodes_released || 0} эп.</span></Link>) : <p className={styles.muted}>Ничего не найдено.</p>}</div>}</> : <p className={styles.muted}>Ожидаем, пока хост выберет серию.</p>}</div>
            <div className={styles.card}><h2>Участники ({room?.participants.length ?? 0})</h2><div className={styles.participants}>{room?.participants.map(participant => {
                const profile = participantProfiles[participant.profileId];
                const login = profile?.login ?? participant.login;
                const avatar = profile?.avatar ?? participant.avatar;
                const canManage = userId === room?.hostId && participant.profileId !== userId;
                return <div key={participant.profileId}><span className={styles.participant}><span className={styles.avatar}>{avatar ? <RemoteImage src={avatar} alt="" /> : login[0]?.toUpperCase()}</span><span>{login}{participant.profileId === room.hostId ? ' · хост' : ''}</span></span>{canManage && <div className={styles['participant-menu-wrap']}><button className={styles['participant-menu-button']} type="button" aria-label={`Действия для ${login}`} onClick={() => setOpenParticipantMenu(current => current === participant.profileId ? null : participant.profileId)}>⋮</button>{openParticipantMenu === participant.profileId && <div className={styles['participant-menu']}>{room?.visibility === 'public' && <button type="button" onClick={() => { grant(participant.profileId, !participant.canControl); setOpenParticipantMenu(null); }}>{participant.canControl ? 'Забрать управление' : 'Разрешить управление'}</button>}<button className={styles['kick-button']} type="button" onClick={() => kick(participant.profileId)}>Исключить из комнаты</button></div>}</div>}</div>;
            })}</div></div>
        </div>
        {message && <p className={styles.error}>{message}</p>}
    </section>;
}

async function searchReleases(query: string, api: ReturnType<typeof useApi>) {
    const response = await api.post<{code: number; releases?: Anime[]; content?: Anime[]}>
    ('/search/releases/0', {query, searchBy: 0}, {'Api-Version': 'v2'})
    return response.releases ?? response.content ?? []
}

function roomMediaUrl(roomId: string, media: NonNullable<WatchRoomState['media']>) {
    const params = new URLSearchParams({
        room: roomId,
        dub: String(media.dubId),
        source: String(media.sourceId),
        episode: String(media.episode),
    });
    return `/anime/${media.releaseId}?${params.toString()}`;
}
