import type { useApi } from '../apiClient.ts';
import type { AnixartListStatusId, ExportListOption, ExportPreviewItem } from './types.ts';
import { MAX_TRANSFER_ROWS, positiveId } from './validation.ts';

interface BookmarkRelease {
    id: number;
    title_alt?: string;
    title_ru: string;
    title_original: string;
    your_vote: number;
    profile_list_status: number;
    is_favorite: boolean;
}

/** The native endpoint requires authentication; useApi.post supplies the session token. */
export async function fetchExportBookmarks(
    api: Pick<ReturnType<typeof useApi>, 'post'>,
    options: ExportListOption[],
    signal?: AbortSignal,
): Promise<ExportPreviewItem[]> {
    const enabled = options.filter(option => option.enabled);
    const statuses = enabled.flatMap(option => option.statusId && [1, 2, 3, 4, 5].includes(option.statusId) ? [option.statusId] : []);
    if (!statuses.length) return [];
    const requested = [...new Set(statuses)];
    const data = await api.post<{ releases: BookmarkRelease[] }>('/export/bookmarks', {
        bookmarksExportProfileLists: requested,
    }, undefined, { signal, cache: 'no-store' });
    signal?.throwIfAborted();
    if (!Array.isArray(data?.releases) || data.releases.length > MAX_TRANSFER_ROWS) throw new Error('Invalid bookmarks export response');
    const seen = new Set<number>();
    const result: ExportPreviewItem[] = [];
    for (const release of data.releases) {
        if (!release || !positiveId(release.id)
            || !Number.isInteger(release.profile_list_status) || release.profile_list_status < 0 || release.profile_list_status > 5
            || !Number.isInteger(release.your_vote) || release.your_vote < 0 || release.your_vote > 5
            || typeof release.title_ru !== 'string' || typeof release.title_original !== 'string'
            || typeof release.is_favorite !== 'boolean') throw new Error('Invalid bookmark release');
        if (seen.has(release.id)) continue;
        if (!statuses.includes(release.profile_list_status as AnixartListStatusId)) continue;
        seen.add(release.id);
        result.push({
            id: `exp_${release.id}`,
            anime: release,
            status: release.profile_list_status as AnixartListStatusId,
            isSkipped: false,
        });
    }
    return result;
}
