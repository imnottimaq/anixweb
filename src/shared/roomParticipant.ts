import type { Profile } from './roomProtocol';

export type StoredIdentity = { id: number; login: string; avatar?: string | null };

const IDENTITY_KEY = 'user_room_identity';

export function saveRoomIdentity(profile: StoredIdentity) {
    localStorage.setItem(IDENTITY_KEY, JSON.stringify(profile));
}

export function getStoredRoomIdentity(): StoredIdentity | null {
    try {
        const raw = localStorage.getItem(IDENTITY_KEY);
        if (!raw) return null;
        const identity = JSON.parse(raw) as StoredIdentity;
        if (identity && typeof identity === 'object') return identity;
    } catch {
        return null;
    }
    return null;
}

export function getCandidateProfileId(): number | null {
    const identity = getStoredRoomIdentity();
    if (identity && Number.isSafeInteger(identity.id) && identity.id > 0) {
        return identity.id;
    }
    const rawUserId = localStorage.getItem('user_id');
    if (rawUserId) {
        const parsed = Number(rawUserId);
        if (Number.isSafeInteger(parsed) && parsed > 0) {
            return parsed;
        }
    }
    return null;
}

export function getRoomParticipant(userId: number): Profile {
    try {
        const identity = JSON.parse(localStorage.getItem(IDENTITY_KEY) ?? 'null') as StoredIdentity | null;
        if (identity?.id === userId && identity.login) {
            return { profileId: userId, login: identity.login, avatar: identity.avatar ?? null };
        }
    } catch(err: unknown) {
        if (err instanceof Error) console.error(err);
        else console.error("An unexpected error happened: ", String(err));
    }
    return { profileId: userId, login: 'Пользователь', avatar: null };
}
