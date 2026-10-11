import { MAX_TRANSFER_ROWS, positiveId } from './validation.ts';
import type { useApi } from '../apiClient.ts';
import type { ImportOptions, ImportPreviewItem, ImportProgress } from './types.ts';

const SEQUENTIAL_DELAY_MS = 100;

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
        if (signal?.aborted) {
            resolve();
            return;
        }
        const timer = setTimeout(() => {
            signal?.removeEventListener('abort', onAbort);
            resolve();
        }, ms);
        const onAbort = () => {
            clearTimeout(timer);
            signal?.removeEventListener('abort', onAbort);
            resolve();
        };
        signal?.addEventListener('abort', onAbort, { once: true });
    });
}

export interface RunImportParams {
    items: ImportPreviewItem[];
    options: ImportOptions;
    api: ReturnType<typeof useApi>;
    signal?: AbortSignal;
    onProgress?: (progress: ImportProgress) => void;
}

/**
 * Runs bounded sequential API updates for approved imported items.
 * Rules:
 * - Detects conflicting duplicate destination IDs before ANY writes
 * - Allows score-only imports with unknown source status
 * - Checks cancellation between status write and score write
 * - Supports per-item error isolation and rate limiting
 */
export async function runImport(params: RunImportParams): Promise<ImportProgress> {
    const { items, options, api, signal, onProgress } = params;
    if (items.length > MAX_TRANSFER_ROWS) throw new Error(`Maximum ${MAX_TRANSFER_ROWS} entries per transfer`);

    // Filter to actionable items:
    // When applyStatus is true, item must have a valid anixartStatus (1..5)
    // When applyScore is true, item must have an anixartScore > 0
    // Score-only import works even if anixartStatus is null
    const actionableItems = items.filter(item => {
        if (item.isSkipped || !item.matchedRelease) return false;
        const canApplyStatus = options.applyStatus && item.anixartStatus !== null;
        const canApplyScore = options.applyScore && item.anixartScore > 0;
        return canApplyStatus || canApplyScore;
    });

    // 1. Critical pre-write check: detect conflicting duplicate destination IDs before ANY writes
    const destinationMap = new Map<number, ImportPreviewItem>();
    for (const item of actionableItems) {
        const destId = item.matchedRelease!.id;
        if (!positiveId(destId) || (item.anixartStatus !== null && ![1, 2, 3, 4, 5].includes(item.anixartStatus))
            || !Number.isInteger(item.anixartScore) || item.anixartScore < 0 || item.anixartScore > 5) throw new Error('Invalid import values');
        if (destinationMap.has(destId)) {
            const existing = destinationMap.get(destId)!;
            const statusConflict = options.applyStatus && (existing.anixartStatus !== item.anixartStatus);
            const scoreConflict = options.applyScore && (existing.anixartScore !== item.anixartScore);
            if (statusConflict || scoreConflict) {
                throw new Error(
                    `Conflicting duplicate destination anime ID ${destId}: items "${existing.title}" and "${item.title}" specify differing target values.`
                );
            }
        } else {
            destinationMap.set(destId, item);
        }
    }

    const progress: ImportProgress = {
        total: actionableItems.length,
        processed: 0,
        succeeded: 0,
        failed: 0,
        skipped: 0,
        isImporting: true,
        isCancelled: false,
        errors: [],
    };

    onProgress?.({ ...progress });

    for (const item of actionableItems) {
        if (signal?.aborted) {
            progress.isCancelled = true;
            progress.isImporting = false;
            onProgress?.({ ...progress });
            return progress;
        }

        const release = destinationMap.get(item.matchedRelease!.id)!.matchedRelease;
        if (!release) continue;

        progress.currentItemTitle = release.title_ru || release.title_original || item.title;
        onProgress?.({ ...progress });


        try {
            let changed = false;
            const status = item.anixartStatus;
            const currentStatus = release.profile_list_status ?? item.currentListStatus ?? 0;
            const statusConflict = currentStatus > 0 && currentStatus !== status;
            if (options.applyStatus && status !== null && item.completedStatus !== status
                && currentStatus !== status && (!statusConflict || options.overwriteStatusOnConflict)) {
                await api.get<{ code: number }>(`/profile/list/add/${status}/${release.id}`, { cache: 'no-store', signal });
                // Record a committed operation immediately, even if the next write fails.
                item.completedStatus = status;
                release.profile_list_status = status;
                item.currentListStatus = status;
                item.hasConflict = false;
                changed = true;
            }
            if (signal?.aborted) {
                progress.isCancelled = true;
                progress.isImporting = false;
                return progress;
            }
            const score = item.anixartScore;
            const currentScore = release.your_vote ?? release.my_vote ?? item.currentVote ?? 0;
            if (options.applyScore && score > 0 && item.completedScore !== score && currentScore !== score) {
                await api.get<{ code: number }>(`/release/vote/add/${release.id}/${score}`, { cache: 'no-store', signal });
                item.completedScore = score;
                release.your_vote = score;
                release.my_vote = score;
                item.currentVote = score;
                changed = true;
            }
            if (changed) {
                progress.succeeded++;
                item.importResult = 'success';
            } else {
                progress.skipped = (progress.skipped ?? 0) + 1;
                item.importResult = 'skipped';
            }
            item.importError = undefined;
        } catch (error) {
            if (signal?.aborted) {
                progress.isCancelled = true;
                progress.isImporting = false;
                return progress;
            }
            progress.failed++;
            const errorMessage = error instanceof Error ? error.message : 'Unknown API error';
            item.importResult = 'failed';
            item.importError = errorMessage;
            progress.errors.push({
                id: item.id,
                title: release.title_ru || release.title_original || item.title,
                error: errorMessage,
            });
        } finally {
            progress.processed++;
            onProgress?.({ ...progress });
        }

        if (signal?.aborted) {
            progress.isCancelled = true;
            progress.isImporting = false;
            onProgress?.({ ...progress });
            return progress;
        }

        // Bounded rate limit delay between requests
        if (progress.processed < progress.total) {
            await sleep(SEQUENTIAL_DELAY_MS, signal);
        }
    }

    progress.isImporting = false;
    progress.currentItemTitle = undefined;
    onProgress?.({ ...progress });

    return progress;
}
