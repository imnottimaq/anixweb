import type { TranslationKey } from './i18n';

export type FeedOrigin = { to: string; key: string; index: number | null; label: TranslationKey };
export type FeedState = { feedTrail: FeedOrigin[] };
export const positions = new Map<string, number>();
const allowedLabels = new Set<TranslationKey>(['feed.back', 'feed.backToPost', 'feed.backToChannel', 'feed.backToChannels', 'feed.backToSettings', 'feed.backToEditor']);
export function internalFeedPath(value: unknown): value is string {
    if (typeof value !== 'string' || /[\\\r\n]/.test(value)) return false;
    const path = value.split(/[?#]/)[0];
    return path === '/feed' || /^\/feed\/(?:studio|compose|(?:post|channel)\/[1-9]\d*)$/.test(path);
}
export function trailOf(state: unknown): FeedOrigin[] {
    if (!state || typeof state !== 'object' || !('feedTrail' in state) || !Array.isArray(state.feedTrail)) return [];
    return state.feedTrail.filter((item): item is FeedOrigin => Boolean(item && internalFeedPath(item.to) && typeof item.key === 'string' && allowedLabels.has(item.label) && (item.index === null || (Number.isSafeInteger(item.index) && item.index >= 0)))).slice(-12);
}
export function labelFor(path: string): TranslationKey {
    if (path.startsWith('/feed/post/')) return 'feed.backToPost';
    if (path.startsWith('/feed/channel/')) return 'feed.backToChannel';
    if (path.startsWith('/feed/compose')) return 'feed.backToEditor';
    if (path.startsWith('/feed/studio')) return path.includes('edit=') ? 'feed.backToSettings' : 'feed.backToChannels';
    return 'feed.back';
}
export function remember(key: string, y: number) {
    positions.set(key, y);
    if (positions.size > 60) positions.delete(positions.keys().next().value!);
}

export function feedChildState(location: { pathname: string; search: string; hash: string; key: string; state: unknown }, extra: Record<string, unknown> = {}, push = true): FeedState {
    remember(location.key, window.scrollY);
    const current = `${location.pathname}${location.search}${location.hash}`;
    const index: unknown = window.history.state?.idx;
    const trail = trailOf(location.state);
    if (push) trail.push({ to: current, key: location.key, index: typeof index === 'number' ? index : null, label: labelFor(current) });
    return { ...extra, feedTrail: trail.slice(-12) };
}
