import type { Profile } from './roomProtocol.ts';

export type RoomSession = { session: string; expiresAt: number; profile: Profile };

/** Validate the identity obtained from the authenticated session endpoint. */
export function parseRoomSession(value: unknown, now = Date.now()): RoomSession {
    if (!value || typeof value !== 'object') throw new Error('INVALID_ROOM_SESSION');
    const response = value as Record<string, unknown>;
    const profile = response.profile;
    if (typeof response.session !== 'string' || !response.session || response.session.length > 8000
        || typeof response.expiresAt !== 'number' || !Number.isSafeInteger(response.expiresAt) || response.expiresAt <= now
        || !profile || typeof profile !== 'object') throw new Error('INVALID_ROOM_SESSION');
    const identity = profile as Record<string, unknown>;
    if (typeof identity.profileId !== 'number' || !Number.isSafeInteger(identity.profileId) || identity.profileId <= 0
        || typeof identity.login !== 'string' || !identity.login.trim() || identity.login.length > 100
        || !(identity.avatar === null || (typeof identity.avatar === 'string' && identity.avatar.length > 0 && identity.avatar.length <= 2048))) {
        throw new Error('INVALID_ROOM_IDENTITY');
    }
    return {
        session: response.session,
        expiresAt: response.expiresAt,
        profile: { profileId: identity.profileId, login: identity.login, avatar: identity.avatar },
    };
}
