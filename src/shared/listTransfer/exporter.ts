import { MAX_TRANSFER_ROWS, positiveId } from './validation.ts';
import type { Anime } from '../types/api.ts';
import type { useApi } from '../apiClient.ts';
import type { AnixartListStatusId, ExportListOption, ExportProgress } from './types.ts';
import { type ExportListEntry, serializeToMalXml } from './xmlSerializer.ts';

const PAGE_DELAY_MS = 60;

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(new DOMException('Export aborted', 'AbortError'));
            return;
        }
        const timer = setTimeout(() => {
            signal?.removeEventListener('abort', onAbort);
            resolve();
        }, ms);
        const onAbort = () => {
            clearTimeout(timer);
            signal?.removeEventListener('abort', onAbort);
            reject(new DOMException('Export aborted', 'AbortError'));
        };
        signal?.addEventListener('abort', onAbort, { once: true });
    });
}

export interface ExportParams {
    api: ReturnType<typeof useApi>;
    profile?: { id?: number; login?: string };
    options: ExportListOption[];
    externalIdMap?: Record<number, number>;
    signal?: AbortSignal;
    onProgress?: (progress: ExportProgress) => void;
}

export async function fetchAllReleasesForStatus(
    statusId: AnixartListStatusId,
    api: ReturnType<typeof useApi>,
    signal?: AbortSignal,
    onPageFetched?: (page: number, count: number) => void
): Promise<Anime[]> {
    if (signal?.aborted) {
        throw new DOMException('Export aborted', 'AbortError');
    }

    const releases: Anime[] = [];
    let page = 0;
    const maxPages = 100;

    while (page < maxPages) {
        if (signal?.aborted) {
            throw new DOMException('Export aborted', 'AbortError');
        }

        const path = `/profile/list/all/${statusId}/${page}?extended_mode=true`;
        const data = await api.get<{
            code: number;
            content?: Array<Anime | { release: Anime }>;
            total_page_count?: number;
        }>(path, { signal });

        if (signal?.aborted) {
            throw new DOMException('Export aborted', 'AbortError');
        }

        if (data.code !== 0) {
            throw new Error(`Upstream API error: code ${data.code} for status ${statusId}`);
        }

        if (!Array.isArray(data.content)) throw new Error('Invalid list response: missing content');
        const rawContent = data.content;
        if (rawContent.length === 0) {
            if ((data.total_page_count ?? 0) > page + 1) throw new Error('List ended before the advertised last page');
            break;
        }

        const pageReleases = rawContent.map(item => {
            if (!item || typeof item !== 'object') throw new Error('Invalid list release');
            const release = 'release' in item ? item.release : item;
            if (!release || !positiveId(release.id)) throw new Error('Invalid list release ID');
            return release;
        });
        if (releases.length + pageReleases.length > MAX_TRANSFER_ROWS) throw new Error(`Maximum ${MAX_TRANSFER_ROWS} entries per transfer`);
        releases.push(...pageReleases);
        onPageFetched?.(page, releases.length);

        if (typeof data.total_page_count === 'number' && page + 1 >= data.total_page_count) {
            break;
        }

        page++;

        if (page >= maxPages) {
            throw new Error(`Pagination cap exceeded (${maxPages} pages). Export cannot be truncated silently.`);
        }

        await sleep(PAGE_DELAY_MS, signal);
    }

    return releases;
}

export async function fetchAllFavorites(
    api: ReturnType<typeof useApi>,
    signal?: AbortSignal,
    onPageFetched?: (page: number, count: number) => void
): Promise<Anime[]> {
    if (signal?.aborted) {
        throw new DOMException('Export aborted', 'AbortError');
    }

    const releases: Anime[] = [];
    let page = 0;
    const maxPages = 100;

    while (page < maxPages) {
        if (signal?.aborted) {
            throw new DOMException('Export aborted', 'AbortError');
        }

        const path = `/favorite/all/${page}?extended_mode=true`;
        const data = await api.get<{
            code: number;
            content?: Array<Anime | { release: Anime }>;
            total_page_count?: number;
        }>(path, { signal });

        if (signal?.aborted) {
            throw new DOMException('Export aborted', 'AbortError');
        }

        if (data.code !== 0) {
            throw new Error(`Upstream API error: code ${data.code} for favorites`);
        }

        if (!Array.isArray(data.content)) throw new Error('Invalid list response: missing content');
        const rawContent = data.content;
        if (rawContent.length === 0) {
            if ((data.total_page_count ?? 0) > page + 1) throw new Error('List ended before the advertised last page');
            break;
        }

        const pageReleases = rawContent.map(item => {
            if (!item || typeof item !== 'object') throw new Error('Invalid list release');
            const release = 'release' in item ? item.release : item;
            if (!release || !positiveId(release.id)) throw new Error('Invalid list release ID');
            return release;
        });
        if (releases.length + pageReleases.length > MAX_TRANSFER_ROWS) throw new Error(`Maximum ${MAX_TRANSFER_ROWS} entries per transfer`);
        releases.push(...pageReleases);
        onPageFetched?.(page, releases.length);

        if (typeof data.total_page_count === 'number' && page + 1 >= data.total_page_count) {
            break;
        }

        page++;

        if (page >= maxPages) {
            throw new Error(`Pagination cap exceeded (${maxPages} pages). Export cannot be truncated silently.`);
        }

        await sleep(PAGE_DELAY_MS, signal);
    }

    return releases;
}

export async function exportUserListsToXml(params: ExportParams): Promise<string> {
    const { api, profile, options, externalIdMap, signal, onProgress } = params;

    if (signal?.aborted) {
        throw new DOMException('Export aborted', 'AbortError');
    }

    const exportEntries: ExportListEntry[] = [];
    const seenReleaseIds = new Set<number>();

    const progress: ExportProgress = {
        currentListLabel: '',
        currentPage: 0,
        fetchedCount: 0,
        isExporting: true,
        error: null,
    };

    onProgress?.({ ...progress });

    for (const opt of options) {
        if (!opt.enabled) continue;
        if (signal?.aborted) {
            throw new DOMException('Export aborted', 'AbortError');
        }

        progress.currentListLabel = opt.labelKey;
        onProgress?.({ ...progress });

        // Never swallow failures: propagate directly
        if (opt.statusId) {
            const releases = await fetchAllReleasesForStatus(
                opt.statusId,
                api,
                signal,
                (page, count) => {
                    progress.currentPage = page;
                    progress.fetchedCount = exportEntries.length + count;
                    onProgress?.({ ...progress });
                }
            );

            for (const anime of releases) {
                if (!seenReleaseIds.has(anime.id)) {
                    seenReleaseIds.add(anime.id);
                    const externalId = externalIdMap?.[anime.id];
                    exportEntries.push({ anime, status: opt.statusId, externalId });
                }
            }
        } else if (opt.isFavorite) {
            const favorites = await fetchAllFavorites(
                api,
                signal,
                (page, count) => {
                    progress.currentPage = page;
                    progress.fetchedCount = exportEntries.length + count;
                    onProgress?.({ ...progress });
                }
            );

            for (const anime of favorites) {
                if (!seenReleaseIds.has(anime.id)) {
                    seenReleaseIds.add(anime.id);
                    const status = (anime.profile_list_status as AnixartListStatusId) || 2;
                    const externalId = externalIdMap?.[anime.id];
                    exportEntries.push({ anime, status, externalId });
                }
            }
        }
    }

    if (signal?.aborted) {
        throw new DOMException('Export aborted', 'AbortError');
    }

    progress.isExporting = false;
    onProgress?.({ ...progress });

    return serializeToMalXml({ profile, entries: exportEntries });
}

export function triggerDownload(content: string, filename: string, mimeType: string): void {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    let link: HTMLAnchorElement | null = null;
    try {
        link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.style.display = 'none';
        document.body.appendChild(link);
        link.click();
    } finally {
        if (link) {
            if (link.parentNode) {
                link.parentNode.removeChild(link);
            } else if (typeof document.body?.removeChild === 'function') {
                try {
                    document.body.removeChild(link);
                } catch {
                    // Ignore if already removed or not attached
                }
            }
        }
        window.setTimeout(() => {
            URL.revokeObjectURL(url);
        }, 60_000);
    }
}

export function triggerXmlDownload(xmlString: string, filename = 'anixart_shikimori_list.xml'): void {
    triggerDownload(xmlString, filename, 'application/xml');
}

export function triggerJsonDownload(jsonString: string, filename = 'anixart_shikimori_list.json'): void {
    triggerDownload(jsonString, filename, 'application/json');
}
