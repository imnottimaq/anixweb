import type { ParsedAnimeItem } from './types.ts';
import { mapMalScoreToAnixart, mapMalStatusToAnixart } from './statusMapper.ts';
import { integerField, MAX_TRANSFER_BYTES, MAX_TRANSFER_ROWS, positiveId } from './validation.ts';

export const MAX_JSON_FILE_BYTES = MAX_TRANSFER_BYTES;
export class JsonParseError extends Error {
    constructor(message: string) { super(message); this.name = 'JsonParseError'; }
}

/** Native Shikimori export is an array. Reject invalid rows instead of importing a silent subset. */
export function parseShikimoriJson(rawJson: string): ParsedAnimeItem[] {
    if (typeof rawJson !== 'string' || !rawJson.trim()) throw new JsonParseError('Empty JSON file');
    if (new TextEncoder().encode(rawJson).length > MAX_JSON_FILE_BYTES) throw new JsonParseError('Maximum file size is 10 MB');
    let records: unknown;
    try { records = JSON.parse(rawJson); } catch { throw new JsonParseError('Invalid JSON syntax'); }
    if (!Array.isArray(records)) throw new JsonParseError('Expected a Shikimori JSON array');
    if (records.length > MAX_TRANSFER_ROWS) throw new JsonParseError(`Maximum ${MAX_TRANSFER_ROWS} entries per transfer`);
    return records.map((value: unknown, index): ParsedAnimeItem => {
        try {
            if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an anime record');
            const rec = value as Record<string, unknown>;
            if (rec.target_type !== 'Anime') throw new Error('Only Anime records are supported');
            const sourceId = positiveId(rec.target_id);
            if (!sourceId) throw new Error('Invalid target_id');
            const title = rec.target_title;
            if (typeof title !== 'string' || !title.trim() || title.length > 1000) throw new Error('Invalid target_title');
            if (rec.target_title_ru !== undefined && typeof rec.target_title_ru !== 'string') throw new Error('Invalid target_title_ru');
            if (rec.status !== undefined && typeof rec.status !== 'string' && typeof rec.status !== 'number') throw new Error('Invalid status');
            const rawStatus = rec.status === undefined ? '' : String(rec.status).trim();
            const rawScore = integerField(rec.score ?? 0, 'score', 10);
            const episodesWatched = integerField(rec.episodes ?? 0, 'episodes');
            const rewatches = rec.rewatches === undefined ? undefined : integerField(rec.rewatches, 'rewatches');
            if (rec.text !== undefined && typeof rec.text !== 'string') throw new Error('Invalid text');
            const anixartId = rec.anixart_id === undefined ? undefined : positiveId(rec.anixart_id);
            if (rec.anixart_id !== undefined && !anixartId) throw new Error('Invalid anixart_id');
            return {
                id: `json_item_${index}_${sourceId}`, sourceId, title: title.trim(),
                titleRu: typeof rec.target_title_ru === 'string' ? rec.target_title_ru.trim() || undefined : undefined,
                episodesWatched, rawScore, anixartScore: mapMalScoreToAnixart(rawScore),
                rawStatus, anixartStatus: mapMalStatusToAnixart(rawStatus), anixartId,
                text: rec.text as string | undefined, rewatches,
            };
        } catch (error) {
            throw new JsonParseError(`Row ${index + 1}: ${error instanceof Error ? error.message : 'Invalid anime record'}`);
        }
    });
}
