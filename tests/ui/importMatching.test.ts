import { expect, it, vi } from 'vitest';
import { matchItem } from '../../src/shared/listTransfer/matcher';
import type { useApi } from '../../src/shared/apiClient';
import type { ParsedAnimeItem } from '../../src/shared/listTransfer/types';

const item: ParsedAnimeItem = { id: 'row', sourceId: 245, title: 'Great Teacher Onizuka', titleRu: 'Крутой учитель Онидзука', episodesWatched: 0, rawScore: 0, anixartScore: 0, rawStatus: 'watching', anixartStatus: 1 };
const anime = { id: 123, title_original: item.title, title_ru: item.titleRu, profile_list_status: 3, your_vote: 4 };
function apiFor(results: unknown[]) {
    const post = vi.fn().mockResolvedValueOnce({ code: 0, releases: results[0] }).mockResolvedValueOnce({ code: 0, releases: results[1] ?? results[0] });
    const get = vi.fn().mockResolvedValue({ code: 1 });
    return { post, get } as unknown as ReturnType<typeof useApi>;
}

it('automatically selects an exact bilingual match, deduplicates hits and preserves conflict state', async () => {
    const api = apiFor([[anime], [anime]]);
    const result = await matchItem(item, api);
    expect(api.post).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ autoMatched: true, matchState: 'matched', matchedRelease: anime, currentListStatus: 3, currentVote: 4, hasConflict: true });
    expect(result.resolutionCandidates).toHaveLength(1);
});

it('continues to the original title when the localized query returns only broad suggestions', async () => {
    const broad = { ...anime, id: 9, title_original: 'Another anime', title_ru: 'Another title' };
    const result = await matchItem(item, apiFor([[broad], [anime]]));
    expect(result.matchedRelease?.id).toBe(123);
    expect(result.resolutionCandidates[0].id).toBe(123);
});

it('leaves duplicate exact titles for manual selection', async () => {
    const result = await matchItem(item, apiFor([[anime, { ...anime, id: 456 }]]));
    expect(result.matchState).toBe('candidate');
    expect(result.matchedRelease).toBeNull();
});

it('never selects another season or release type based on a shared localized title', async () => {
    for (const title of ['Great Teacher Onizuka 2', 'Great Teacher Onizuka (OVA)']) {
        const source = title.includes('OVA') ? { ...item, title: 'Great Teacher Onizuka (TV)' } : item;
        const result = await matchItem(source, apiFor([[{ ...anime, title_original: title }]]));
        expect(result.matchedRelease).toBeNull();
    }
});

it('does not automatically choose a merely similar title or the first search result', async () => {
    const result = await matchItem(item, apiFor([[{ ...anime, title_original: 'Great Teacher Onizuka: The Movie', title_ru: 'Different title' }]]));
    expect(result.matchedRelease).toBeNull();
});

it('loads missing current list state before enabling an automatic match', async () => {
    const api = apiFor([[{ ...anime, profile_list_status: undefined }]]);
    vi.mocked(api.get).mockResolvedValue({ code: 0, release: anime });
    expect((await matchItem(item, api)).hasConflict).toBe(true);
    expect(api.get).toHaveBeenCalledWith('/release/123');
});

it('searches an identical Russian and original title only once', async () => {
    const api = apiFor([[anime]]);
    await matchItem({ ...item, titleRu: item.title }, api);
    expect(api.post).toHaveBeenCalledTimes(1);
});
