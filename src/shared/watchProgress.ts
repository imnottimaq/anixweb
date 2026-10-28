export const WATCH_PROGRESS_STORAGE_KEY = 'watch_progress';
export const CONTINUE_WATCHING_STORAGE_KEY = 'continue_watching';

export type WatchProgress = Record<string, Record<string, number>>;

export interface ContinueWatchingItem {
    animeId: number;
    title: string;
    image?: string | null;
    episodeNumber?: number;
    episodeName?: string;
    seconds: number;
    duration: number;
    updatedAt: number;
}

export function getWatchProgress(): WatchProgress {
    try {
        const rawProgress = localStorage.getItem(WATCH_PROGRESS_STORAGE_KEY);
        return rawProgress ? JSON.parse(rawProgress) : {};
    } catch {
        return {};
    }
}

export function saveWatchProgress(animeId: number, episodeKey: string, seconds: number) {
    const progress = getWatchProgress();
    const animeProgress = progress[String(animeId)] ?? {};

    progress[String(animeId)] = {
        ...animeProgress,
        [episodeKey]: seconds,
    };

    localStorage.setItem(WATCH_PROGRESS_STORAGE_KEY, JSON.stringify(progress));
}

export function clearWatchProgress(animeId: number, episodeKey: string) {
    const progress = getWatchProgress();
    const animeKey = String(animeId);
    const animeProgress = progress[animeKey];

    if (!animeProgress || !(episodeKey in animeProgress)) return;

    delete animeProgress[episodeKey];

    if (Object.keys(animeProgress).length === 0) {
        delete progress[animeKey];
    }

    localStorage.setItem(WATCH_PROGRESS_STORAGE_KEY, JSON.stringify(progress));
}

const MAX_CONTINUE_WATCHING_ITEMS = 20;

export function getContinueWatchingList(): ContinueWatchingItem[] {
    try {
        const raw = localStorage.getItem(CONTINUE_WATCHING_STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    } catch {
        return [];
    }
}

export function saveContinueWatchingItem(item: Omit<ContinueWatchingItem, 'updatedAt'>) {
    try {
        if (item.seconds < 5 || (item.duration > 0 && item.seconds / item.duration >= 0.95)) {
            removeContinueWatchingItem(item.animeId);
            return;
        }
        const currentList = getContinueWatchingList();
        const prev = currentList.find(i => i.animeId === item.animeId);
        const image = item.image ?? prev?.image ?? null;
        const newItem: ContinueWatchingItem = {
            ...item,
            image,
            updatedAt: Date.now(),
        };
        const updated = [newItem, ...currentList.filter(i => i.animeId !== item.animeId)].slice(0, MAX_CONTINUE_WATCHING_ITEMS);
        localStorage.setItem(CONTINUE_WATCHING_STORAGE_KEY, JSON.stringify(updated));
    } catch {
        // ignore storage errors
    }
}

export function removeContinueWatchingItem(animeId: number) {
    try {
        const list = getContinueWatchingList().filter(i => i.animeId !== animeId);
        localStorage.setItem(CONTINUE_WATCHING_STORAGE_KEY, JSON.stringify(list));
    } catch {
        // ignore storage errors
    }
}

