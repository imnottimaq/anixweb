import type { useApi } from './apiClient';
import { feedId, feedMutation, feedUrl, type FeedPage } from './feed';

type Api = ReturnType<typeof useApi>;
function object(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === 'object' && !Array.isArray(value)); }
function id(value: number) { if (!feedId(value)) throw new Error('Invalid ID'); return value; }
export interface FeedMember {
    id: number; login: string; avatar?: string; permission?: number;
    is_blocked?: boolean; is_perm_blocked?: boolean; block_reason?: string; block_expire_date?: number;
}
export type MemberList = 'subscribers' | 'administrators' | 'blocked';
export async function loadFeedMembers(api: Api, channelId: number, kind: MemberList, query: string, index: number, signal: AbortSignal): Promise<FeedPage<FeedMember>> {
    id(channelId);
    if (!Number.isSafeInteger(index) || index < 0) throw new Error('Invalid page');
    const result = kind === 'blocked' ? await api.get<unknown>(`/channel/${channelId}/block/all/${index}`, { signal })
        : kind === 'administrators' ? await api.post<unknown>(`/channel/${channelId}/permission/all/${index}`, { permission: 1 }, undefined, { signal })
            : await api.post<unknown>(`/search/channel/${channelId}/subscribers/${index}`, { query: query.trim(), searchBy: 0 }, undefined, { signal });
    if (!object(result) || result.code !== 0 || !Array.isArray(result.content) || !result.content.every(item => object(item) && feedId(item.id) && typeof item.login === 'string')) throw new Error('Invalid member response');
    return { content: result.content, total_count: typeof result.total_count === 'number' ? result.total_count : undefined };
}
export function setFeedPermission(api: Api, channelId: number, profileId: number, admin: boolean) {
    return feedMutation(api, 'post', `/channel/${id(channelId)}/permission/manage`, { target_profile_id: id(profileId), permission: admin ? 1 : null });
}
export async function setFeedBlock(api: Api, channelId: number, profileId: number, blocked: boolean, options: { reason: string; showReason: boolean; expires: number | null }) {
    if (options.reason.length > 1000 || (blocked && options.expires !== null && (!Number.isSafeInteger(options.expires) || options.expires <= Date.now() / 1000))) throw new Error('Invalid block settings');
    return feedMutation(api, 'post', `/channel/${id(channelId)}/block/manage`, {
        target_profile_id: id(profileId), is_blocked: blocked, is_perm_blocked: blocked && options.expires === null,
        expire_date: blocked ? options.expires : null, reason: blocked ? options.reason.trim() : '', is_reason_showing_enabled: blocked && options.showReason,
    });
}
export function validateFeedImage(file: File) {
    if (!/^image\/(jpeg|png|webp|gif)$/.test(file.type) || file.size === 0 || file.size > 20 * 1024 * 1024) throw new Error('Invalid image file');
}
async function editorToken(api: Api, channelId: number, options: { suggestion: boolean; edit: boolean }, signal: AbortSignal) {
    const available = await api.get<unknown>(`/channel/${id(channelId)}/editor/available?is_suggestion=${options.suggestion}&is_edit_mode=${options.edit}`, { signal, cache: 'no-store' });
    if (!object(available) || available.code !== 0 || typeof available.media_upload_token !== 'string' || !available.media_upload_token) throw new Error('Media upload unavailable');
    return available.media_upload_token;
}
export async function uploadFeedMedia(api: Api, channelId: number, file: File, options: { suggestion: boolean; edit: boolean }, signal: AbortSignal): Promise<Record<string, unknown>> {
    validateFeedImage(file);
    const token = await editorToken(api, channelId, options, signal);
    const body = new FormData(); body.append('file', file);
    // The native editor uses its own origin and a short-lived media token, never the account token.
    const response = await fetch('https://editor.anixsekai.com/content/upload', {
        method: 'POST', body, headers: { Authorization: `Bearer ${token}` }, signal, credentials: 'omit', redirect: 'error',
    });
    if (!response.ok) throw new Error('Media upload failed');
    const result: unknown = await response.json();
    if (!object(result) || !result.success || !object(result.file) || !feedUrl(result.file.url)) throw new Error('Invalid media upload response');
    return result.file;
}
export async function resolveFeedEmbed(api: Api, channelId: number, url: string, options: { suggestion: boolean; edit: boolean }, signal: AbortSignal) {
    if (!feedUrl(url)) throw new Error('Invalid link');
    const parsed = new URL(url);
    const service = /(^|\.)(youtube\.com|youtu\.be)$/.test(parsed.hostname) ? 'youtube' : /(^|\.)vk\.com$/.test(parsed.hostname) && parsed.pathname.startsWith('/video') ? 'vk' : 'link';
    const token = await editorToken(api, channelId, options, signal);
    const response = await fetch(`https://editor.anixsekai.com/embed/${service}?${new URLSearchParams({ url })}`, { headers: { Authorization: `Bearer ${token}` }, signal, credentials: 'omit', redirect: 'error' });
    if (!response.ok) throw new Error('Link preview failed');
    const data: unknown = await response.json();
    if (!object(data) || !data.success || (!data.title && !data.description)) throw new Error('Invalid link preview');
    return { ...data, url, service };
}
export async function uploadFeedArtwork(api: Api, channelId: number, kind: 'avatar' | 'cover', file: File, signal: AbortSignal): Promise<string> {
    validateFeedImage(file);
    const body = new FormData(); body.append('image', file);
    const result = await api.postForm<unknown>(`/channel/${kind}/upload/${id(channelId)}`, body, { signal });
    if (!object(result) || result.code !== 0 || !feedUrl(result.url)) throw new Error('Invalid artwork response');
    return result.url as string;
}
