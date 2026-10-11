import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import RoomProvider from '../../src/shared/contexts/RoomProvider';
import { RoomContext, useRoomPresence, type RoomContextValue } from '../../src/shared/contexts/roomContext';
import { UserContext } from '../../src/shared/contexts/userContext';
import { SettingsContext } from '../../src/shared/contexts/settingsContext';
import { defaultAppSettings } from '../../src/shared/types/settings';
import type { RoomConnectionStatus, RoomTerminalReason } from '../../src/shared/roomClient';
import { MAX_CHAT_HISTORY, REACTION_TTL_MS, type RoomReaction, type WatchRoomState } from '../../src/shared/roomProtocol';
import RoomChat from '../../src/components/RoomChat';
import ReactionOverlay from '../../src/components/ReactionOverlay';

type Callbacks = { state(room: WatchRoomState): void; status(status: RoomConnectionStatus): void; error(error: string | null): void };
const transport = vi.hoisted(() => ({
    callbacks: null as Callbacks | null,
    reaction: null as ((reaction: RoomReaction) => void) | null,
    terminal: null as ((reason: RoomTerminalReason) => void) | null,
}));
vi.mock('../../src/shared/roomClient', () => ({
    RoomClient: class {
        constructor(options: unknown, callbacks: Callbacks) { void options; transport.callbacks = callbacks; }
        setReactionHandler(callback: (reaction: RoomReaction) => void) { transport.reaction = callback; }
        setTerminalHandler(callback: (reason: RoomTerminalReason) => void) { transport.terminal = callback; }
        setStatusHandler(callback: (status: RoomConnectionStatus) => void) { transport.callbacks!.status = callback; }
        serverNow() { return Date.now() + 50_000; }
        async connect(roomId: string) {
            transport.callbacks!.status('connected');
            transport.callbacks!.state(roomFixture(roomId));
        }
        disconnect() { transport.callbacks!.status('idle'); }
        async send() { /* Transport acknowledgements are controlled by the fixture. */ }
    },
}));
vi.mock('../../src/shared/watchRoom', () => ({
    createWatchRoom: vi.fn(), getRoomWebSocketUrl: vi.fn(), joinWatchRoom: vi.fn(),
    subscribeRoomProfile: () => () => {}, getAuthenticatedRoomProfile: () => null,
}));

function roomFixture(roomId = 'room-one'): WatchRoomState {
    return {
        protocolVersion: 2, revision: 1, roomId, joinCode: '12345678', title: 'Room', visibility: 'private', hostId: 1,
        media: null, mediaVersion: 0, syncEpoch: 0,
        playback: { position: 0, paused: true, intent: 'paused', rate: 1, updatedAt: Date.now() },
        barrier: null, participants: [], emptySince: null, closed: false, chat: [],
    };
}
function reaction(id = 'reaction-one', age = 0): RoomReaction {
    return { id, profileId: 1, login: 'Host', avatar: null, emoji: 'heart', createdAt: Date.now() + 50_000 - age };
}
function context(room: WatchRoomState): RoomContextValue {
    return {
        activeRoomId: room.roomId, room, status: 'connected', error: null, self: null, reactions: [],
        join: vi.fn(), joinByCode: vi.fn(), create: vi.fn(), leave: vi.fn(), send: vi.fn(),
        sendChat: vi.fn(), sendReaction: vi.fn(), serverNow: () => Date.now() + 50_000,
    };
}
function ui(children: ReactNode, room = roomFixture()) {
    const settings = { ...defaultAppSettings, appearance: { ...defaultAppSettings.appearance, language: 'english' as const } };
    return <UserContext.Provider value={{userToken:'fixture-token',userId:1,setUserToken:vi.fn(),setUserId:vi.fn()}}>
        <SettingsContext.Provider value={{ settings, setSettings: vi.fn() }}>
            <RoomContext.Provider value={context(room)}>{children}</RoomContext.Provider>
        </SettingsContext.Provider>
    </UserContext.Provider>;
}
function Probe() {
    const presence = useRoomPresence();
    return <><button onClick={() => void presence.join('room-one')}>Join fixture</button>
        <output data-testid="reactions">{JSON.stringify(presence.reactions)}</output></>;
}
async function provider() {
    const view = render(<UserContext.Provider value={{ userToken: 'fixture-token', userId: 1, setUserToken: vi.fn(), setUserId: vi.fn() }}>
        <RoomProvider><Probe /></RoomProvider>
    </UserContext.Provider>);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Join fixture' })); });
    return view;
}
function currentReactions(): RoomReaction[] { return JSON.parse(screen.getByTestId('reactions').textContent ?? '[]'); }

beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(1_000_000); sessionStorage.clear();
    transport.callbacks = null; transport.reaction = null; transport.terminal = null;
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('RoomProvider reaction boundaries', () => {
    it('deduplicates repeated events by server ID', async () => {
        await provider(); const event = reaction();
        act(() => { transport.reaction!(event); transport.reaction!(event); });
        expect(currentReactions()).toHaveLength(1);
    });
    it('does not accept an already expired event using the calibrated server clock', async () => {
        await provider(); act(() => transport.reaction!(reaction('expired', REACTION_TTL_MS + 1)));
        expect(currentReactions()).toEqual([]);
    });
    it('expires a delayed event after its remaining lifetime', async () => {
        await provider(); act(() => transport.reaction!(reaction('delayed', 3_000)));
        expect(currentReactions()).toHaveLength(1);
        await act(async () => { await vi.advanceTimersByTimeAsync(1_001); });
        expect(currentReactions()).toEqual([]);
    });
    it('clears reaction state and expiry timers when the socket disconnects', async () => {
        await provider(); act(() => transport.reaction!(reaction()));
        act(() => transport.callbacks!.status('reconnecting'));
        expect(currentReactions()).toEqual([]);
        expect(vi.getTimerCount()).toBe(0);
    });
    it('cleans up expiry timers when the provider unmounts', async () => {
        const view = await provider(); act(() => transport.reaction!(reaction()));
        view.unmount(); expect(vi.getTimerCount()).toBe(0);
    });
});

describe('Chat and animation boundaries', () => {
    it('reports new messages while reading older messages even when the history stays at 50', () => {
        const room = roomFixture();
        room.chat = Array.from({ length: MAX_CHAT_HISTORY }, (_, index) => ({
            id: `message-${index}`, profileId: 1, login: 'Host', avatar: null, text: `Message ${index}`, createdAt: index,
        }));
        const view = render(ui(<RoomChat />, room));
        const log = screen.getByRole('log');
        Object.defineProperties(log, {
            scrollHeight: { configurable: true, value: 2_000 }, clientHeight: { configurable: true, value: 200 },
            scrollTop: { configurable: true, writable: true, value: 100 },
        });
        fireEvent.scroll(log);
        const next = { ...room, chat: [...room.chat.slice(1), { ...room.chat[0], id: 'new-tail', text: 'Newest message' }] };
        view.rerender(ui(<RoomChat />, next));
        expect(screen.getByRole('button', { name: /new messages/i })).toBeInTheDocument();
        expect(log.scrollTop).toBe(100);
    });
    it('does not display an expired reaction on mount despite local clock skew', () => {
        render(ui(<ReactionOverlay reactions={[reaction('expired', REACTION_TTL_MS + 1)]} />));
        expect(screen.queryAllByTestId('reaction-bubble')).toHaveLength(0);
    });
    it('does not resurrect an expired reaction when a new event arrives', async () => {
        const old = reaction();
        const view = render(ui(<ReactionOverlay reactions={[old]} />));
        await act(async () => { await vi.advanceTimersByTimeAsync(REACTION_TTL_MS + 1); });
        view.rerender(ui(<ReactionOverlay reactions={[old, reaction('new-event')]} />));
        expect(screen.getAllByTestId('reaction-bubble')).toHaveLength(1);
    });
});
