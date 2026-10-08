import type { Profile } from './roomProtocol';

type StoredIdentity = { id: number; login: string; avatar?: string | null };

const IDENTITY_KEY = 'user_room_identity';

export function saveRoomIdentity(profile: StoredIdentity) {
    localStorage.setItem(IDENTITY_KEY, JSON.stringify(profile));
}

export function getRoomParticipant(userId: number): Profile {
    try {
        const identity = JSON.parse(localStorage.getItem(IDENTITY_KEY) ?? 'null') as StoredIdentity | null;
        if (identity?.id === userId && identity.login) {
            return { profileId: userId, login: identity.login, avatar: identity.avatar ?? null };
        }
    } catch(err: unknown) {
        if (err instanceof Error)console.error(err);
        else console.error("An unexpected error happened: ", String(err))
    }
    return { profileId: userId, login: 'Пользователь', avatar: null };
}
