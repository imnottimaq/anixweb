import { expect, it, vi } from 'vitest';
import { fetchExportBookmarks } from '../../src/shared/listTransfer/bookmarks';
import type { ExportListOption } from '../../src/shared/listTransfer/types';

const options: ExportListOption[] = [
    { id: 'watching', statusId: 1, labelKey: 'status.watching', enabled: true },
    { id: 'planned', statusId: 2, labelKey: 'status.planned', enabled: false },
];
const release = { id: 123, title_ru: 'Title', title_original: 'Original', title_alt: 'Alternative', your_vote: 4, profile_list_status: 1, is_favorite: false };

it('sends selected statuses once and keeps native IDs, scores and titles for preview', async () => {
    const post = vi.fn().mockResolvedValue({ releases: [release, release, { ...release, id: 124, profile_list_status: 0 }, { ...release, id: 125, profile_list_status: 2 }] });
    const controller = new AbortController();
    const items = await fetchExportBookmarks({ post }, options, controller.signal);
    expect(post).toHaveBeenCalledExactlyOnceWith('/export/bookmarks', { bookmarksExportProfileLists: [1] }, undefined, { signal: controller.signal, cache: 'no-store' });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ anime: release, status: 1, isSkipped: false });
    expect(items[0].externalId).toBeUndefined();
});

it('makes no request when every list is deselected', async () => {
    const post = vi.fn();
    expect(await fetchExportBookmarks({ post }, options.map(option => ({ ...option, enabled: false })))).toEqual([]);
    expect(post).not.toHaveBeenCalled();
});

it('rejects malformed exports and propagates authentication failures', async () => {
    for (const data of [{}, { releases: null }, { releases: [{ ...release, your_vote: 99 }] }, { releases: Array(2001).fill(release) }]) {
        await expect(fetchExportBookmarks({ post: vi.fn().mockResolvedValue(data) }, options)).rejects.toThrow();
    }
    await expect(fetchExportBookmarks({ post: vi.fn().mockRejectedValue(new Error('API error: 401')) }, options)).rejects.toThrow('401');
});

it('discards a response if the export was cancelled before it arrived', async () => {
    const controller = new AbortController();
    const post = vi.fn().mockImplementation(async () => {
        controller.abort();
        return { releases: [release] };
    });
    await expect(fetchExportBookmarks({ post }, options, controller.signal)).rejects.toThrow();
});
