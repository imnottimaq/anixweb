import { createContext, useContext, useEffect } from 'react';
import type { Anime } from '../types/api';
export type ReleasePatch = Pick<Anime, 'profile_list_status' | 'is_favorite'>;
export const ReleaseActionsContext = createContext<{
    patches: Record<number, ReleasePatch>;
    pending: ReadonlySet<number>;
    begin: (id: number) => boolean;
    finish: (id: number) => void;
    publish: (id: number, patch: ReleasePatch, changed?: boolean) => void;
    subscribe: (listener: () => void) => () => void;
} | null>(null);
export function useReleaseAnime(anime: Anime): Anime {
    const context = useContext(ReleaseActionsContext);
    const patch = context?.patches[anime.id];
    return patch ? {...anime, ...patch} : anime;
}
export function useReleaseChanges(listener: () => void) {
    const context = useContext(ReleaseActionsContext);
    const subscribe = context?.subscribe;
    useEffect(() => subscribe?.(listener), [subscribe, listener]);
}

export function releaseMenuAttributes(anime: Partial<Anime>) {
    const status = anime.profile_list_status;
    const known = typeof anime.is_favorite === 'boolean' && typeof status === 'number' && Number.isInteger(status) && status >= 0 && status <= 5;
    return {
        'data-release-list-status': known ? status : undefined,
        'data-release-favorite': known ? String(anime.is_favorite) : undefined,
    };
}
