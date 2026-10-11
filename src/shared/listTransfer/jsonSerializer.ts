import { validateExportEntries } from './validation.ts';
import { mapAnixartScoreToMal, mapAnixartStatusToShikimori } from './statusMapper.ts';
import type { SerializeOptions } from './types.ts';

export interface ShikimoriExportRecord {
    target_id: number;
    target_type: 'Anime';
    target_title: string;
    target_title_ru: string;
    status: string;
    score: number;
    episodes: number;
    rewatches: number;
    text: string;
    anixart_id?: number;
}

/**
 * Serializes user's Anixart lists to official native Shikimori JSON format.
 * Source reference: https://github.com/shikimori/shikimori/blob/master/app/views/users/list_exports/export.json.jbuilder
 * Requires genuine mapped external target_id for every record.
 */
export function serializeToShikimoriJson(options: SerializeOptions): string {
    const { entries } = options;

    validateExportEntries(entries);

    const records: ShikimoriExportRecord[] = entries.map(entry => {
        const { anime, status, externalId } = entry;
        const rating = anime.your_vote ?? anime.my_vote ?? 0;
        const malScore = mapAnixartScoreToMal(rating);
        const titleOriginal = anime.title_original?.trim() || anime.title_ru?.trim() || `Anime ${anime.id}`;
        const titleRu = anime.title_ru?.trim() || '';
        const totalEps = anime.episodes_total ?? anime.episodes_released ?? 0;
        const watchedEps = status === 3 ? totalEps : 0;

        return {
            target_id: externalId!,
            target_type: 'Anime',
            target_title: titleOriginal,
            target_title_ru: titleRu,
            status: mapAnixartStatusToShikimori(status),
            score: malScore,
            episodes: watchedEps,
            rewatches: 0,
            text: '',
            anixart_id: anime.id,
        };
    });

    return JSON.stringify(records, null, 2);
}
