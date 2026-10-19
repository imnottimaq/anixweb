import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import RoomProvider from '../../src/shared/contexts/RoomProvider';
import { useRoomPresence } from '../../src/shared/contexts/roomContext';
import { RoomClient } from '../../src/shared/roomClient';
import { AllProvidersWrapper } from './helpers/testUtils';

beforeEach(() => {
    sessionStorage.clear();
    vi.spyOn(RoomClient.prototype, 'connect').mockResolvedValue(undefined);
});
afterEach(() => { vi.restoreAllMocks(); sessionStorage.clear(); });

function wrapper({ children }: { children: ReactNode }) {
    return <AllProvidersWrapper options={{ userToken: 'fixture-token' }}>
        <RoomProvider>{children}</RoomProvider>
    </AllProvidersWrapper>;
}

it.each(['ROOM_DISCONNECTED', 'HOST_REQUIRED', 'COMMAND_TIMEOUT'])('retains membership and permits retry after failed closure: %s', async message => {
    const send = vi.spyOn(RoomClient.prototype, 'send').mockRejectedValueOnce(new Error(message)).mockResolvedValue(undefined);
    const { result } = renderHook(useRoomPresence, { wrapper });
    await act(async () => { await result.current.join('room-one'); });
    await act(async () => {
        await expect(result.current.closeRoom!()).rejects.toThrow(message);
    });
    expect(result.current.activeRoomId).toBe('room-one');
    expect(JSON.parse(sessionStorage.getItem('active_watch_room_v2')!).roomId).toBe('room-one');
    await act(async () => { await result.current.closeRoom!(); });
    expect(send).toHaveBeenCalledTimes(2);
    expect(result.current.activeRoomId).toBeNull();
    expect(sessionStorage.getItem('active_watch_room_v2')).toBeNull();
});
