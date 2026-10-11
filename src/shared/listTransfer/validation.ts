import type { ExportListEntry } from './types.ts';

export const MAX_TRANSFER_ROWS = 2000;
export const MAX_TRANSFER_BYTES = 10 * 1024 * 1024;

export function positiveId(value: unknown): number | undefined {
    const number = typeof value === 'number' ? value
        : typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value.trim()) : NaN;
    return Number.isSafeInteger(number) && number > 0 ? number : undefined;
}

export function integerField(value: unknown, name: string, max = Number.MAX_SAFE_INTEGER): number {
    const number = typeof value === 'number' ? value
        : typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value.trim()) : NaN;
    if (!Number.isSafeInteger(number) || number < 0 || number > max) {
        throw new Error(`Invalid ${name}: expected an integer between 0 and ${max}`);
    }
    return number;
}

export function validateExportEntries(entries: ExportListEntry[]): void {
    if (entries.length > MAX_TRANSFER_ROWS) throw new Error(`Maximum ${MAX_TRANSFER_ROWS} entries per transfer`);
    const externalIds = new Set<number>();
    for (const entry of entries) {
        if (!positiveId(entry.externalId)) throw new Error('Every export entry requires a valid Shikimori / MAL ID');
        if (!positiveId(entry.anime.id)) throw new Error('Invalid Anixart release ID');
        if (![1, 2, 3, 4, 5].includes(entry.status)) throw new Error('Invalid list status');
        if (externalIds.has(entry.externalId!)) {
            throw new Error(`Multiple releases map to Shikimori / MAL ID ${entry.externalId}. Resolve the mapping before exporting.`);
        }
        externalIds.add(entry.externalId!);
    }
}
