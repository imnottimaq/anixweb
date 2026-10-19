import test from 'node:test';
import assert from 'node:assert/strict';
import { roomPlaybackAccess } from '../src/shared/roomPermissions.ts';

const room = {
    hostId: 1,
    participants: [
        { profileId: 1, connected: true, canControl: true },
        { profileId: 2, connected: true, canControl: false },
        { profileId: 3, connected: true, canControl: true },
        { profileId: 4, connected: false, canControl: false },
    ],
};

test('room pause is allowed for viewers by default without granting full controls', () => {
    assert.deepEqual(roomPlaybackAccess(room, 2), { pause: true, control: false });
    assert.deepEqual(roomPlaybackAccess({ ...room, allowParticipantPause: true }, 2), { pause: true, control: false });
});
test('host pause policy limits viewers while preserving explicitly granted controls', () => {
    const locked = { ...room, allowParticipantPause: false };
    assert.deepEqual(roomPlaybackAccess(locked, 2), { pause: false, control: false });
    for (const id of [1, 3]) assert.deepEqual(roomPlaybackAccess(locked, id), { pause: true, control: true });
});
test('disconnected or absent participants cannot pause or control the room', () => {
    for (const id of [4, 99]) assert.deepEqual(roomPlaybackAccess(room, id), { pause: false, control: false });
    assert.deepEqual(roomPlaybackAccess(null, 1), { pause: false, control: false });
});
