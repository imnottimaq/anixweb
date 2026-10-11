export const DEFAULT_PROXY_SERVER_URL = 'http://localhost:8787';
export const DEFAULT_MEDIA_PROXY_URL = DEFAULT_PROXY_SERVER_URL;

export const SERVER_PROXY_ALLOWLIST = new Set([
    'kodikplayer.com',
    'api-s.anixsekai.com',
    'kodik.info',
    'kodik.biz',
    'kodik.cc',
    'cloud.kodik-storage.com',
    'video.sibnet.ru',
    'sibnet.ru',
    'rutube.ru',
    'vk.com',
    'api.vk.com',
    'oauth.vk.com',
    'ok.ru',
    'odnoklassniki.ru',
    'solodcdn.com',
    'anilibria.top',
    'test-streams.mux.dev',
]);

export function normalizeTrailingSlashes(url: string): string {
    return url.replace(/\/+$/, '');
}

const viteEnv = import.meta.env;

export function getProxyServerUrl(): string {
    const proc = (globalThis as unknown as { process?: { env?: Record<string, string | undefined> } }).process;
    const raw = proc?.env?.VITE_PROXY_SERVER_URL
        || viteEnv?.VITE_PROXY_SERVER_URL
        || proc?.env?.VITE_ROOM_SERVER_URL
        || viteEnv?.VITE_ROOM_SERVER_URL
        || DEFAULT_PROXY_SERVER_URL;
    return normalizeTrailingSlashes(raw);
}

export function getMediaProxyUrl(): string {
    const proc = (globalThis as unknown as { process?: { env?: Record<string, string | undefined> } }).process;
    const raw = proc?.env?.VITE_MEDIA_PROXY_URL
        || viteEnv?.VITE_MEDIA_PROXY_URL
        || getProxyServerUrl();
    return normalizeTrailingSlashes(raw);
}

export function cleanTargetUrl(targetUrl: string): string {
    // Prevent double encoding if targetUrl is already percent-encoded scheme
    if (/^https?%3A/i.test(targetUrl)) {
        try {
            return decodeURIComponent(targetUrl);
        } catch {
            return targetUrl;
        }
    }
    return targetUrl;
}

export function isAllowedServerProxyHost(targetUrl: string): boolean {
    try {
        const cleaned = cleanTargetUrl(targetUrl);
        const urlToParse = cleaned.startsWith('//') ? `https:${cleaned}` : cleaned;
        const hostname = new URL(urlToParse).hostname.toLowerCase();
        return SERVER_PROXY_ALLOWLIST.has(hostname);
    } catch {
        return false;
    }
}

export function getAgentProxyUrl(targetUrl: string): string {
    const cleaned = cleanTargetUrl(targetUrl);
    const base = getProxyServerUrl();
    return `${base}/agentproxy?url=${encodeURIComponent(cleaned)}`;
}

export function getCorsProxyUrl(targetUrl: string): string {
    const cleaned = cleanTargetUrl(targetUrl);
    const base = getProxyServerUrl();
    return `${base}/corsproxy?url=${encodeURIComponent(cleaned)}`;
}
