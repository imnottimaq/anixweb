export interface DiscoverCommentRelease {
    id?: number | string | null;
    '@id'?: number | string | null;
    release_id?: number | string | null;
    title_ru?: string | null;
    title_original?: string | null;
    title_alt?: string | null;
    title_en?: string | null;
    title_romaji?: string | null;
    title_japanese?: string | null;
    title?: string | null;
    name_ru?: string | null;
    name?: string | null;
    name_original?: string | null;
    name_en?: string | null;
    release_title_ru?: string | null;
    release_title?: string | null;
    image?: string | null;
    poster?: string | null;
    [key: string]: unknown;
}

export interface DiscoverCommentItem {
    id: number;
    profile: {
        id?: number;
        login: string;
        avatar?: string | null;
        [key: string]: unknown;
    };
    message: string;
    vote_count?: number;
    parent_comment_id?: number | null;
    release?: DiscoverCommentRelease | number | string | null;
    anime?: DiscoverCommentRelease | number | string | null;
    release_id?: number | string | null;
    release_title_ru?: string | null;
    release_title?: string | null;
    [key: string]: unknown;
}

export function isUsableTitle(value: unknown): value is string {
    if (typeof value !== 'string') return false;
    const trimmed = value.trim();
    if (!trimmed) return false;
    const lower = trimmed.toLowerCase();
    if (lower === 'undefined' || lower === 'null' || lower === '[object object]') return false;
    // Avoid displaying numeric IDs as a title (e.g. "12345" or "20389")
    if (/^\d+$/.test(trimmed)) return false;
    return true;
}

export function extractReleaseId(target: unknown): number | null {
    // Scalars and @id are Jackson identity references, never catalog IDs.
    if (!target || typeof target !== 'object') return null;
    if (typeof target === 'object') {
        const obj = target as Record<string, unknown>;
        if ('release' in obj || 'anime' in obj || 'message' in obj) {
            return extractReleaseId(obj.release ?? obj.anime) ?? catalogId(obj.release_id ?? obj.releaseId);
        }
        const candidate = obj.id ?? obj.release_id ?? obj.releaseId;
        if (typeof candidate === 'number' && Number.isInteger(candidate) && candidate > 0) {
            return candidate;
        }
        if (typeof candidate === 'string' && /^\d+$/.test(candidate.trim())) {
            const parsed = Number(candidate.trim());
            return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
        }
        // Nested release inside comment
        if (obj.release && typeof obj.release === 'object') {
            return extractReleaseId(obj.release);
        }
        if (obj.anime && typeof obj.anime === 'object') {
            return extractReleaseId(obj.anime);
        }
    }
    return null;
}

function catalogId(value: unknown): number | null {
    const id = typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value)) ? Number(value) : NaN;
    return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export function getCommentReleaseDisplayTitle(
    releaseOrComment: unknown,
    language: 'russian' | 'english' = 'russian',
): string | null {
    if (!releaseOrComment) return null;

    let releaseObj: Record<string, unknown> | null = null;
    let commentObj: Record<string, unknown> | null = null;

    if (typeof releaseOrComment === 'object') {
        const candidate = releaseOrComment as Record<string, unknown>;
        if (candidate.release && typeof candidate.release === 'object') {
            releaseObj = candidate.release as Record<string, unknown>;
            commentObj = candidate;
        } else if (candidate.anime && typeof candidate.anime === 'object') {
            releaseObj = candidate.anime as Record<string, unknown>;
            commentObj = candidate;
        } else if (!('release' in candidate || 'anime' in candidate || 'message' in candidate)) {
            releaseObj = candidate;
        }
    }

    if (!releaseObj) return null;

    const ruCandidates: string[] = [];
    const origCandidates: string[] = [];

    const ruKeys = [
        'title_ru', 'name_ru', 'titleRu', 'nameRu',
        'release_title_ru', 'release_title',
        'anime_title_ru', 'anime_name_ru',
    ];

    const origKeys = [
        'title_en', 'title_original', 'title_alt', 'title_romaji',
        'titleOriginal', 'name_original', 'name_en',
        'title', 'name', 'anime_title', 'anime_name',
        'title_japanese',
    ];

    for (const key of ruKeys) {
        const val = releaseObj[key] ?? commentObj?.[key];
        if (isUsableTitle(val)) ruCandidates.push(val.trim());
    }

    for (const key of origKeys) {
        const val = releaseObj[key] ?? commentObj?.[key];
        if (isUsableTitle(val)) origCandidates.push(val.trim());
    }

    if (language === 'english') {
        if (origCandidates.length > 0) return origCandidates[0];
        if (ruCandidates.length > 0) return ruCandidates[0];
    } else {
        if (ruCandidates.length > 0) return ruCandidates[0];
        if (origCandidates.length > 0) return origCandidates[0];
    }

    return null;
}

export function resolveCommentReleases<T extends DiscoverCommentItem>(comments: T[]): T[] {
    const identities = new Map<string, DiscoverCommentRelease>();
    // Register every full release first so forward and interleaved references work.
    for (const comment of comments) {
        for (const value of [comment.release, comment.anime]) {
            if (value && typeof value === 'object' && value['@id'] != null) {
                identities.set(String(value['@id']), value);
            }
        }
    }
    return comments.map(comment => {
        const value = comment.release ?? comment.anime;
        const release = value && typeof value === 'object' ? value
            : value != null ? identities.get(String(value)) ?? null : null;
        return { ...comment, release, anime: null };
    });
}
