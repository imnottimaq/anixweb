import { createContext, useContext } from 'react';
import type { RoomCommandPayload, RoomVisibility, WatchRoomState, Profile, RoomReaction, ReactionEmoji } from '../roomProtocol';
import type { RoomConnectionStatus } from '../roomClient';
export type RoomContextValue = {
    activeRoomId: string | null; room: WatchRoomState | null; status: RoomConnectionStatus; error: string | null;
    self: Profile | null;
    reactions: RoomReaction[];
    join(roomId: string, code?: string, force?: boolean): Promise<void>; joinByCode(code: string): Promise<string>;
    create(input: { title: string; visibility: RoomVisibility }): Promise<string>;
    leave(): Promise<void>; send(payload: RoomCommandPayload): Promise<void>;
    closeRoom?(): Promise<void>;
    sendChat(text: string): Promise<void>; sendReaction(emoji: ReactionEmoji): Promise<void>;
    serverNow(): number;
};
export const RoomContext=createContext<RoomContextValue|null>(null);
export function useRoomPresence() { const context=useContext(RoomContext);if(!context) throw new Error('RoomProvider missing');return context; }
