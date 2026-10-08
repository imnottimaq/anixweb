import type { PlayerSession, PlayerSessionEpisode } from './playerSession';
import type { RoomMedia } from './roomProtocol';
import { extractVideoLinks } from '../utils/LinkParser';

type EpisodeApi = { get<T>(path: string, init?: RequestInit): Promise<T> };

/** Resolve IDs independently on each viewer; stream URLs never enter room state. */
export async function resolveRoomMedia(api: EpisodeApi, media: RoomMedia, signal: AbortSignal): Promise<PlayerSession> {
    signal.throwIfAborted();
    const data = await api.get<{ episodes: PlayerSessionEpisode[] }>(
        `/episode/${media.releaseId}/${media.dubId}/${media.sourceId}`, { signal },
    );
    signal.throwIfAborted();
    const episode = data.episodes?.find(item => item.position === media.episode);
    if (!episode) throw new Error('Серия недоступна в выбранном источнике');
    const sources = await extractVideoLinks(episode.url, signal);
    signal.throwIfAborted();
    if (!sources || Object.keys(sources).length === 0) throw new Error('Не удалось получить видео');
    return {
        sources, animeId: media.releaseId, animeName: media.releaseName,
        dubId: media.dubId, sourceId: media.sourceId, episodeNumber: media.episode,
        episodeName: episode.name || media.episodeName, episodes: data.episodes,
    };
}
