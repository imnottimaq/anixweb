import assert from 'node:assert/strict';
import test from 'node:test';
import { parseRoomSession } from '../src/shared/roomSession.ts';

const valid = () => ({ session: 'signed-session', expiresAt: 2000, profile: { profileId: 123, login: 'Verified', avatar: null } });
test('session parser returns only validated server identity fields', () => {
    const data = valid();
    data.profile.canControl = true;
    assert.deepEqual(parseRoomSession(data, 1000), valid());
});
test('session parser rejects malformed credentials and expired sessions', () => {
    for (const data of [null, {}, { ...valid(), session: '' }, { ...valid(), expiresAt: 1000 }, { ...valid(), expiresAt: Infinity }]) {
        assert.throws(() => parseRoomSession(data, 1000), /INVALID_ROOM_SESSION/);
    }
});
test('session parser rejects missing, spoofed and malformed profiles', () => {
    for (const profile of [null, {}, { ...valid().profile, profileId: '123' }, { ...valid().profile, profileId: 0 }, { ...valid().profile, login: ' ' }, { ...valid().profile, avatar: {} }, { profileId: 123, login: 'Verified' }]) {
        assert.throws(() => parseRoomSession({ ...valid(), profile }, 1000), /INVALID_ROOM_(IDENTITY|SESSION)/);
    }
});
