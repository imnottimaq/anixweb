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
        .normalize('NFKC')
        .toLowerCase()
        .replace(/[‘’]/g, "'")
        .replace(/[–—]/g, '-')
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
 * - A single exact title match can be selected automatically; ambiguous results stay suggestions
 * - Unmatched items are explicitly preserved with candidates list
 * - Current list status is checked to flag potential overwrite conflicts
 */
export async function matchItem(
    item: ParsedAnimeItem,
    api: ReturnType<typeof useApi>
): Promise<ImportPreviewItem> {
    let matchedRelease: Anime | null = null;
    let candidates: Anime[] = [];
    let autoMatched = false;

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
        const queries = [item.titleRu, item.title].filter((title): title is string => Boolean(title?.trim()));
        const seenQueries = new Set<string>();
        const byId = new Map<number, Anime>();
        for (const query of queries) {
            const normalized = normalizeTitle(query);
            if (seenQueries.has(normalized)) continue;
            seenQueries.add(normalized);
            for (const candidate of await searchCandidates(query, api)) byId.set(candidate.id, candidate);
        }
        candidates = [...byId.values()];
        const exact = candidates.filter(candidate => {
            const names = [candidate.title_original, candidate.title_ru].filter((title): title is string => Boolean(title));
            if (!queries.some(query => names.some(name => areTitlesEquivalent(query, name)))) return false;
            // An exact localized name must not hide a different numbered season in the original title.
            if (item.title && candidate.title_original) {
                const sourceNumbers = normalizeTitle(item.title).match(/\d+/g) ?? [];
                const targetNumbers = normalizeTitle(candidate.title_original).match(/\d+/g) ?? [];
                if (sourceNumbers.join(',') !== targetNumbers.join(',')) return false;
                const sourceType = normalizeTitle(item.title).match(/\b(tv|ova|ona|movie|special)\b/)?.[0];
                const targetType = normalizeTitle(candidate.title_original).match(/\b(tv|ova|ona|movie|special)\b/)?.[0];
                if (sourceType && targetType && sourceType !== targetType) return false;
            }
            return true;
        });
        // Put the closest suggestions first without choosing between duplicate exact titles.
        candidates = [...exact, ...candidates.filter(candidate => !exact.includes(candidate))];
        if (exact.length === 1) {
            const candidate = exact[0];
            // Read existing list state before treating a sparse search hit as actionable.
            const release = [0, 1, 2, 3, 4, 5].includes(candidate.profile_list_status)
                ? candidate : await fetchReleaseById(candidate.id, api);
            if (release && [0, 1, 2, 3, 4, 5].includes(release.profile_list_status)) { matchedRelease = release; autoMatched = true; }
        }
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
        autoMatched,
        resolutionCandidates: candidates.slice(0, 10),
        currentListStatus,
        currentVote,
        hasConflict,
        isSkipped: false,
    };
}
