import type { VideoSources } from './types/video';

const PLAYER_SESSION_KEY = 'player_session';

export interface PlayerSession {
    sources: VideoSources;
    animeId: number;
    animeName: string;
    image?: string | null;
    episodeNumber?: number;
    episodeName?: string;
    episodes?: PlayerSessionEpisode[];
    dubId?: number;
    sourceId?: number;
}

export interface PlayerSessionEpisode {
    name: string;
    position: number;
    url: string;
}

export function getPlayerSession(): PlayerSession | null {
    try {
        const rawSession = sessionStorage.getItem(PLAYER_SESSION_KEY);
        return rawSession ? JSON.parse(rawSession) : null;
    } catch {
        return null;
    }
}

export function setPlayerSession(session: PlayerSession) {
    sessionStorage.setItem(PLAYER_SESSION_KEY, JSON.stringify(session));
}

export function clearPlayerSession() {
    sessionStorage.removeItem(PLAYER_SESSION_KEY);
}
