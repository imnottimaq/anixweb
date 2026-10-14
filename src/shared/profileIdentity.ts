import { getCandidateProfileId, getStoredRoomIdentity, saveRoomIdentity } from './roomParticipant';

type SearchProfile = { id: number; login: string; avatar?: string | null };

export async function resolveAndStoreProfileIdentity(login: string): Promise<number | null> {
    const response = await fetch('https://api-s.anixsekai.com/search/profiles/0', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: login.trim(), searchBy: 0 }),
    });
    if (!response.ok) return null;
    const data = await response.json() as { code?: number; content?: SearchProfile[]; profiles?: SearchProfile[] };
    if (data.code !== 0) return null;
    const profiles = data.content ?? data.profiles ?? [];
    const normalizedLogin = login.trim().toLocaleLowerCase();
    const profile = profiles.find(item => item.login.toLocaleLowerCase() === normalizedLogin) ?? profiles[0];
    if (!profile?.id || !profile.login) return null;
    saveRoomIdentity({ id: profile.id, login: profile.login, avatar: profile.avatar ?? null });
    return profile.id;
}

export async function resolveCandidateProfileId(): Promise<number | null> {
    const existing = getCandidateProfileId();
    if (existing) return existing;

    // Prefer existing ID storage; a login search may only locate a candidate if needed
    const stored = getStoredRoomIdentity();
    if (stored?.login && typeof stored.login === 'string' && stored.login.trim()) {
        const candidateId = await resolveAndStoreProfileIdentity(stored.login.trim());
        if (candidateId && Number.isSafeInteger(candidateId) && candidateId > 0) {
            return candidateId;
        }
    }

    return null;
}
