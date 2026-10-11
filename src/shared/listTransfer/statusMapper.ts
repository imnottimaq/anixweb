import type { AnixartListStatusId } from './types.ts';

export const MAL_STATUS_STRINGS: Record<AnixartListStatusId, string> = {
    1: 'Watching',
    2: 'Plan to Watch',
    3: 'Completed',
    4: 'On-Hold',
    5: 'Dropped',
};

export const SHIKIMORI_STATUS_STRINGS: Record<AnixartListStatusId, string> = {
    1: 'watching',
    2: 'planned',
    3: 'completed',
    4: 'on_hold',
    5: 'dropped',
};

/**
 * Normalizes input status (from XML <my_status> or JSON status) to Anixart list status ID (1..5).
 * Correct MAL numeric statuses:
 *   1 watching -> Anixart 1
 *   2 completed -> Anixart 3
 *   3 on-hold -> Anixart 4
 *   4 dropped -> Anixart 5
 *   6 planned -> Anixart 2
 */
export function mapMalStatusToAnixart(status: string | number | null | undefined): AnixartListStatusId | null {
    if (status === null || status === undefined) return null;

    if (typeof status === 'number') {
        switch (status) {
            case 1:
                return 1;
            case 2:
                return 3;
            case 3:
                return 4;
            case 4:
                return 5;
            case 6:
                return 2;
            default:
                return null;
        }
    }

    const trimmed = String(status).trim();
    if (!trimmed) return null;

    // Check if numeric string
    if (/^\d+$/.test(trimmed)) {
        const num = Number.parseInt(trimmed, 10);
        switch (num) {
            case 1:
                return 1;
            case 2:
                return 3;
            case 3:
                return 4;
            case 4:
                return 5;
            case 6:
                return 2;
            default:
                return null;
        }
    }

    const normalized = trimmed.toLowerCase().replace(/[-_\s]+/g, '');

    switch (normalized) {
        case 'watching':
        case 'currentlywatching':
        case 'rewatching':
            return 1;
        case 'plantowatch':
        case 'planned':
            return 2;
        case 'completed':
        case 'watched':
            return 3;
        case 'onhold':
        case 'holdon':
        case 'holding':
            return 4;
        case 'dropped':
            return 5;
        default:
            return null;
    }
}

/**
 * Maps Anixart list status ID to standard Shikimori / MAL XML status string.
 */
export function mapAnixartStatusToMal(status: AnixartListStatusId): string {
    return MAL_STATUS_STRINGS[status] || 'Plan to Watch';
}

/**
 * Maps Anixart list status ID to official Shikimori JSON status string.
 */
export function mapAnixartStatusToShikimori(status: AnixartListStatusId): string {
    return SHIKIMORI_STATUS_STRINGS[status] || 'planned';
}

/**
 * Maps a 10-point score (from Shikimori / MAL) to Anixart's 5-point rating scale.
 * 0 remains 0 (unrated).
 * 1-2 -> 1
 * 3-4 -> 2
 * 5-6 -> 3
 * 7-8 -> 4
 * 9-10 -> 5
 */
export function mapMalScoreToAnixart(score: number): number {
    if (!Number.isFinite(score) || score <= 0) return 0;
    const rounded = Math.round(score);
    if (rounded <= 0) return 0;
    // Scale 1..10 to 1..5
    return Math.min(5, Math.max(1, Math.round(rounded / 2)));
}

/**
 * Maps Anixart's 5-point rating scale to standard Shikimori / MAL 10-point score.
 * 0 remains 0 (unrated).
 * 1 -> 2
 * 2 -> 4
 * 3 -> 6
 * 4 -> 8
 * 5 -> 10
 */
export function mapAnixartScoreToMal(score: number): number {
    if (!Number.isFinite(score) || score <= 0) return 0;
    const bounded = Math.min(5, Math.max(1, Math.round(score)));
    return bounded * 2;
}
