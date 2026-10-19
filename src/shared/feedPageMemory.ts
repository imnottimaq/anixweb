import type { FeedArticle } from './feed';

export type FeedSnapshot<T> = { items: T[]; page: number; hasMore: boolean; savedAt: number };
const memory = new Map<string, FeedSnapshot<{ id: number }>>();
let account: string | undefined;
export function activateFeedMemory(owner: string) {
    if (owner !== account) { memory.clear(); account = owner; }
}
export function readFeedSnapshot<T extends { id: number }>(key?: string): FeedSnapshot<T> | undefined {
    const snapshot = key ? memory.get(key) : undefined;
    return snapshot && Date.now() - snapshot.savedAt < 10 * 60 * 1000 ? snapshot as FeedSnapshot<T> : undefined;
}
export function writeFeedSnapshot<T extends { id: number }>(key: string | undefined, snapshot: Omit<FeedSnapshot<T>, 'savedAt'>) {
    if (!key) return;
    memory.set(key, { ...snapshot, savedAt: Date.now() });
    if (memory.size > 30) memory.delete(memory.keys().next().value!);
}
export function updateFeedArticleMemory(id: number, article?: FeedArticle) {
    for (const [key, snapshot] of memory) {
        const items = snapshot.items.flatMap(item => item.id !== id || !('channel' in item) ? [item] : article ? [article] : []);
        memory.set(key, { ...snapshot, items });
    }
}
