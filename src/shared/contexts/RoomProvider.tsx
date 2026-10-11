import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { RoomContext } from './roomContext';
import { useUser } from './userContext';
import { RoomClient, type RoomConnectionStatus, type RoomTerminalReason } from '../roomClient';
import { createWatchRoom, getRoomWebSocketUrl, joinWatchRoom, subscribeRoomProfile, getAuthenticatedRoomProfile } from '../watchRoom';
import { REACTION_TTL_MS, type RoomCommandPayload, type RoomVisibility, type WatchRoomState, type RoomReaction, type ReactionEmoji } from '../roomProtocol';

const STORAGE = 'active_watch_room_v2';
export default function RoomProvider({ children }: { children: ReactNode }) {
    const { userToken } = useUser();
    const self = useSyncExternalStore(subscribeRoomProfile, getAuthenticatedRoomProfile);
    const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
    const [room, setRoom] = useState<WatchRoomState | null>(null);
    const [reactions, setReactions] = useState<RoomReaction[]>([]);
    const [status, setStatus] = useState<RoomConnectionStatus>('idle');
    const [error, setError] = useState<string | null>(null);
    const active = useRef<{ roomId: string; code?: string } | null>(null);
    const previousToken = useRef(userToken);
    const actionVersion = useRef(0);
    const reactionTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

    const clearReactionTimers = useCallback(() => {
        for (const timer of reactionTimers.current.values()) {
            clearTimeout(timer);
        }
        reactionTimers.current.clear();
        setReactions([]);
    }, []);
    const handleStatus = useCallback((nextStatus: RoomConnectionStatus) => {
        setStatus(nextStatus);
        if (nextStatus !== 'connected') clearReactionTimers();
    }, [clearReactionTimers]);

    const handleTerminal = useCallback((reason: RoomTerminalReason) => {
        sessionStorage.removeItem(STORAGE);
        clearReactionTimers();
        if (reason === 'session_replaced') return;
        active.current = null;
        setActiveRoomId(null);
        setRoom(null);
    }, [clearReactionTimers]);

    const [client] = useState(() => new RoomClient(
        { ticket: joinWatchRoom, url: getRoomWebSocketUrl },
        {
            state: setRoom,
            status: setStatus,
            error: setError,
        },
    ));

    const handleReaction = useCallback((reaction: RoomReaction) => {
        if (!reaction?.id) return;
        if (reactionTimers.current.has(reaction.id)) return;
        const now = client.serverNow();
        const age = Math.max(0, now - reaction.createdAt);
        const remaining = REACTION_TTL_MS - age;
        if (remaining <= 0) return;

        setReactions(prev => {
            if (prev.some(r => r.id === reaction.id)) return prev;
            const next = [...prev, reaction];
            return next.length > 30 ? next.slice(-30) : next;
        });

        const timer = setTimeout(() => {
            reactionTimers.current.delete(reaction.id);
            setReactions(prev => prev.filter(r => r.id !== reaction.id));
        }, remaining);
        reactionTimers.current.set(reaction.id, timer);
    }, [client]);

    useEffect(() => { client.setTerminalHandler(handleTerminal); }, [client, handleTerminal]);
    useEffect(() => { client.setStatusHandler(handleStatus); }, [client, handleStatus]);
    useEffect(() => { client.setReactionHandler(handleReaction); }, [client, handleReaction]);

    const cancelActions = useCallback(() => { actionVersion.current++; }, []);
    useEffect(() => {
        const changedAccount = previousToken.current !== userToken;
        previousToken.current = userToken;
        if (changedAccount) {
            active.current = null;
            sessionStorage.removeItem(STORAGE);
            clearReactionTimers();
        }
        const restore = setTimeout(() => {
            if (!userToken || changedAccount) {
                active.current = null;
                setActiveRoomId(null);
                setRoom(null);
                clearReactionTimers();
                sessionStorage.removeItem(STORAGE);
                return;
            }
            // A route may have joined during this mount; don't replace that socket.
            if (active.current) return;
            try {
                const saved = JSON.parse(sessionStorage.getItem(STORAGE) ?? 'null');
                if (typeof saved?.roomId === 'string') {
                    active.current = saved;
                    setActiveRoomId(saved.roomId);
                    void client.connect(saved.roomId, saved.code);
                }
            } catch { sessionStorage.removeItem(STORAGE); }
        }, 0);
        return () => {
            clearTimeout(restore);
            client.disconnect();
            active.current = null;
            clearReactionTimers();
            cancelActions();
        };
    }, [cancelActions, clearReactionTimers, client, userToken]);

    const join = useCallback(async (roomId: string, code?: string, force = false) => {
        if (!userToken) throw new Error('ROOM_SIGN_IN');
        if (active.current?.roomId === roomId && !force) return;
        const version = ++actionVersion.current;
        code ??= active.current?.roomId === roomId ? active.current.code : undefined;
        if (!code) {
            try {
                const saved = JSON.parse(sessionStorage.getItem(STORAGE) ?? 'null');
                if (saved?.roomId === roomId && typeof saved.code === 'string') code = saved.code;
            } catch { /* Invalid saved membership does not override an explicit invite. */ }
        }
        if (active.current && active.current.roomId !== roomId) {
            try {
                await Promise.race([client.send({ type: 'leave' }), new Promise(r => setTimeout(r, 400))]);
            } catch { /* An offline old room expires independently. */ }
        }
        if (version !== actionVersion.current) return;
        clearReactionTimers();
        const next = { roomId, code };
        active.current = next;
        sessionStorage.setItem(STORAGE, JSON.stringify(next));
        setActiveRoomId(roomId);
        setRoom(null);
        await client.connect(roomId, code);
    }, [clearReactionTimers, client, userToken]);

    const leave = useCallback(async () => {
        const version = ++actionVersion.current;
        try { await client.send({ type: 'leave' }); } catch { /* Offline leave still clears local membership. */ }
        if (version !== actionVersion.current) return;
        client.disconnect();
        active.current = null;
        sessionStorage.removeItem(STORAGE);
        setActiveRoomId(null);
        setRoom(null);
        setError(null);
        clearReactionTimers();
    }, [clearReactionTimers, client]);
    const send = useCallback((payload: RoomCommandPayload) => client.send(payload), [client]);
    const closeRoom = useCallback(async () => {
        const version = ++actionVersion.current;
        try {
            await client.send({ type: 'close_room' });
        } catch {
            /* Offline or terminated close still clears local membership */
        }
        if (version !== actionVersion.current) return;
        client.disconnect();
        active.current = null;
        sessionStorage.removeItem(STORAGE);
        setActiveRoomId(null);
        setRoom(null);
        setError(null);
        clearReactionTimers();
    }, [clearReactionTimers, client]);
    const sendChat = useCallback(async (text: string) => {
        const trimmed = text.trim();
        if (!trimmed) throw new Error('EMPTY_TEXT');
        await client.send({ type: 'chat_message', text: trimmed });
    }, [client]);
    const sendReaction = useCallback(async (emoji: ReactionEmoji) => {
        await client.send({ type: 'reaction', emoji });
    }, [client]);
    const serverNow = useCallback(() => client.serverNow(), [client]);
    const create = useCallback(async (input: { title: string; visibility: RoomVisibility }) => {
        const created = await createWatchRoom(input);
        await join(created.roomId, created.state.joinCode);
        return created.roomId;
    }, [join]);
    const joinByCode = useCallback(async (code: string) => {
        code = code.trim().toUpperCase();
        const resolved = await joinWatchRoom(undefined, code);
        await join(resolved.roomId, code);
        return resolved.roomId;
    }, [join]);
    const value = useMemo(
        () => ({ activeRoomId, room, status, error, self, reactions, join, joinByCode, create, leave, closeRoom, send, sendChat, sendReaction, serverNow }),
        [activeRoomId, room, status, error, self, reactions, join, joinByCode, create, leave, closeRoom, send, sendChat, sendReaction, serverNow]
    );
    return <RoomContext.Provider value={value}>{children}</RoomContext.Provider>;
}
