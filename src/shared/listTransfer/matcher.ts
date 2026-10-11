import { positiveId } from './validation.ts';
import type { Anime } from '../types/api.ts';
import type { useApi } from '../apiClient.ts';
import type { ImportPreviewItem, ParsedAnimeItem } from './types.ts';

/**
 * Normalizes title for comparison while STRICTLY preserving season numbers and release type identity.
 * Never strips season numbers or types (tv/ova/movie).
 */
export function normalizeTitle(raw: string): string {
    return raw
        .toLowerCase()
        .replace(/[.,/#!$%^&*;:{}=\-_`~()?[\]"']/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

export function areTitlesEquivalent(a: string, b: string): boolean {
    const normA = normalizeTitle(a);
    const normB = normalizeTitle(b);
    if (!normA || !normB) return false;
    return normA === normB;
}

/**
 * Searches Anixart for candidate releases matching an anime title.
 */
export async function searchCandidates(
    query: string,
    api: ReturnType<typeof useApi>
): Promise<Anime[]> {
    const trimmed = query.trim();
    if (!trimmed) return [];

    const response = await api.post<{ code: number; releases?: Anime[]; content?: Anime[] }>(
        '/search/releases/0', { query: trimmed, searchBy: 0 }, { 'Api-Version': 'v2' });
    const candidates = response.releases ?? response.content;
    if (response.code !== 0 || !Array.isArray(candidates) || candidates.some(item => !item || !positiveId(item.id))) {
        throw new Error('Invalid Anixart search response');
    }
    return candidates;

}

/**
 * Fetches single release by Anixart ID.
 */
export async function fetchReleaseById(
    id: number,
    api: ReturnType<typeof useApi>
): Promise<Anime | null> {
    try {
        const response = await api.get<{ code: number; release?: Anime }>(`/release/${id}`);
        if (response.code === 0 && response.release && response.release.id === id) {
            return response.release;
        }
    } catch {
        // Release does not exist or network failed
    }
    return null;
}

/**
 * Matches parsed XML/JSON items against Anixart catalog.
 * Follows strict rules:
 * - Direct ID lookup only if trusted Anixart ID is present (anixartId)
 * - Never strip season numbers or types to auto-match
 * - Search results require manual selection; titles alone never establish identity
 * - Unmatched items are explicitly preserved with candidates list
 * - Current list status is checked to flag potential overwrite conflicts
 */
export async function matchItem(
    item: ParsedAnimeItem,
    api: ReturnType<typeof useApi>
): Promise<ImportPreviewItem> {
    let matchedRelease: Anime | null = null;
    let candidates: Anime[] = [];

    // 1. If explicit Anixart ID was provided (e.g., from our own export extension)
    const ownId = positiveId(item.anixartId);
    if (ownId) {
        const release = await fetchReleaseById(ownId, api);
        if (release) {
            matchedRelease = release;
        }
    }

    // 2. Search by title if not already matched by explicit Anixart ID
    if (!matchedRelease) {
        const queriesToTry: string[] = [];
        if (item.titleRu) queriesToTry.push(item.titleRu);
        if (item.title) queriesToTry.push(item.title);

        for (const q of queriesToTry) {
            candidates = await searchCandidates(q, api);
            if (candidates.length > 0) break;
        }

        // Catalog titles are suggestions; only explicit own IDs establish identity.
    }

    const currentListStatus = matchedRelease?.profile_list_status ?? 0;
    const currentVote = matchedRelease?.your_vote ?? matchedRelease?.my_vote ?? 0;
    const hasConflict = Boolean(
        matchedRelease &&
        currentListStatus > 0 &&
        item.anixartStatus !== null &&
        currentListStatus !== item.anixartStatus
    );

    let matchState: ImportPreviewItem['matchState'] = 'unmatched';
    if (matchedRelease) {
        matchState = 'matched';
    } else if (candidates.length > 0) {
        matchState = 'candidate';
    }

    return {
        ...item,
        matchState,
        matchedRelease,
        resolutionCandidates: candidates.slice(0, 10),
        currentListStatus,
        currentVote,
        hasConflict,
        isSkipped: false,
    };
}
