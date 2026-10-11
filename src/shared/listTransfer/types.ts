import type { Anime } from '../types/api.ts';

export type AnixartListStatusId = 1 | 2 | 3 | 4 | 5;

export type MatchState = 'matched' | 'unmatched' | 'candidate' | 'skipped';

export interface ParsedAnimeItem {
    id: string; // Unique client-side row key
    sourceId: string | number; // ID from external file (<series_animedb_id> or target_id)
    title: string; // <series_title> or target_title
    titleRu?: string; // <series_title_ru> or target_title_ru
    episodesWatched: number; // <my_watched_episodes> or episodes
    episodesTotal?: number; // <series_episodes>
    rawScore: number; // Original score (0-10)
    anixartScore: number; // Converted score (0-5)
    rawStatus: string; // Original status string
    anixartStatus: AnixartListStatusId | null; // Converted status (1-5) or null if unknown
    anixartId?: number; // ONLY explicit <anixart_id> extension
    text?: string;
    rewatches?: number;
}

export interface ImportPreviewItem extends ParsedAnimeItem {
    matchState: MatchState;
    matchedRelease: Anime | null;
    resolutionCandidates: Anime[];
    currentListStatus?: number; // 0 for none, 1-5 if already in user's list
    currentVote?: number; // 0 if unrated, 1-5 if user already rated it
    hasConflict?: boolean; // true if already in list with different status
    isSkipped: boolean;
    customSearchQuery?: string;
    importResult?: 'pending' | 'success' | 'failed' | 'skipped';
    completedStatus?: number;
    completedScore?: number;
    importError?: string;
}

export interface ImportOptions {
    applyStatus: boolean;
    applyScore: boolean;
    overwriteStatusOnConflict: boolean;
}

export interface ImportProgress {
    total: number;
    processed: number;
    succeeded: number;
    skipped?: number;
    failed: number;
    isImporting: boolean;
    isCancelled: boolean;
    currentItemTitle?: string;
    errors: Array<{ id: string; title: string; error: string }>;
}

export interface ExportListOption {
    id: 'watching' | 'planned' | 'completed' | 'onHold' | 'dropped' | 'favorites';
    statusId?: AnixartListStatusId;
    isFavorite?: boolean;
    labelKey: string;
    enabled: boolean;
    count?: number;
}

export interface ExportProgress {
    currentListLabel: string;
    currentPage: number;
    fetchedCount: number;
    isExporting: boolean;
    error: string | null;
}

export interface ExportListEntry {
    anime: Anime;
    status: AnixartListStatusId;
    externalId?: number; // Verified Shikimori / MAL Anime ID
}

export interface SerializeOptions {
    profile?: { id?: number; login?: string };
    entries: ExportListEntry[];
}

export type ExportFormat = 'xml' | 'json';

export interface ShikimoriCandidate {
    id: number;
    title: string;
    titleRu?: string;
    year?: string | number;
    url?: string;
}

export interface ExportPreviewItem {
    id: string;
    anime: Anime;
    status: AnixartListStatusId;
    externalId?: number;
    manualInput?: string;
    isSkipped: boolean;
    suggestions?: ShikimoriCandidate[];
    isSearching?: boolean;
}
