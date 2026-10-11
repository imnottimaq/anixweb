import type { VideoSources, VideoStreamType } from '../shared/types/video.ts';
import { getCorsProxyUrl } from '../shared/proxy.ts';

/*
    LinkParser.ts взят из AnixartJS(https://github.com/theDesConnet/AnixartJS)
*/

/**
 * Парсер различных источников
 */

export function getUpstreamUrl(response: Response, fallbackUrl: string): string {
    const upstream = response.headers.get('x-upstream-url');
    if (upstream) {
        try {
            const parsed = new URL(upstream);
            if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
                return parsed.toString();
            }
        } catch {
            // Malformed header, fallback
        }
    }
    return fallbackUrl;
}

export function resolvePlaylistEntry(entry: string, baseUpstreamUrl: string): string {
    const trimmed = entry.trim();
    return new URL(trimmed, baseUpstreamUrl).toString();
}

export async function proxyFetch(targetUrl: string, options?: RequestInit) {
    const proxiedUrl = getCorsProxyUrl(targetUrl);
    return fetch(proxiedUrl, options);
}

export type KodikQuality = '240' | '360' | '480' | '720' | '1080' | string;

export interface KodikVideoSource {
    src: string,
    type: string
}

export type KodikVideoLinks = Record<KodikQuality, KodikVideoSource[]>;

type RawVideoSources = Record<string, string | { src: string; type?: string } | Array<{ src: string; type?: string }>>;

function getStreamType(src: string, declaredType?: string): VideoStreamType {
    if (declaredType) return declaredType;
    return src.includes('.m3u8') || src.includes(':hls:')
        ? 'application/x-mpegURL'
        : 'video/mp4';
}

function normalizeStreamUrl(src: string): string {
    return src.startsWith('//') ? `https:${src}` : src;
}

export function normalizeVideoSources(links: RawVideoSources): VideoSources {
    return Object.fromEntries(
        Object.entries(links)
            .map(([quality, value]) => {
                const sources = Array.isArray(value) ? value : [value];
                const normalized = sources
                    .map(source => typeof source === 'string' ? { src: source } : source)
                    .filter((source): source is { src: string; type?: string } => Boolean(source?.src))
                    .map(source => {
                        const src = normalizeStreamUrl(source.src);
                        return { src, type: getStreamType(src, source.type) };
                    });
                return [quality, normalized] as const;
            })
            .filter(([, sources]) => sources.length > 0)
    );
}

export interface KodikVast {
    title_small: string,
    src: string,
    timer?: number,
    hide_interface?: boolean,
    async_load?: boolean,
    vpaid_target_event?: string,
    vpaid_max_load_time?: number,
    vpaid_max_start_time?: number,
    vpaid_start_event?: string,
    vpaid_timer_start_event?: string,
    vpaid_ad_skippable_state?: boolean,
    advert_id?: string,
    save_views?: boolean,
    start_muted?: boolean,
    max_length?: number,
    disable_advert_click?: number,
    send_stat_method?: string,
    stop_timer_on_pause?: boolean,
}

export interface KodikDirectLinkResponse {
    advert_script: string,
    domain: string,
    default: number,
    links: KodikVideoLinks,
    vast: KodikVast[],
    reserve_vast: KodikVast[],
    ip: string
}

export class KodikParser {
    private static _baseKodikDomain = 'kodikplayer.com'
    private static _endpointUrl = '/ftor';

    private static checkHost(url: string) {
        let parsed: URL;
        try {
            parsed = new URL(url);
        } catch {
            throw new Error(`Invalid URL provided to KodikParser: "${url}"`);
        }
        const hostname = parsed.hostname.toLowerCase();
        const valid = hostname === 'kodikplayer.com' || hostname.endsWith('.kodikplayer.com') ||
                      hostname === 'kodik.info' || hostname.endsWith('.kodik.info') ||
                      hostname === 'kodik.biz' || hostname.endsWith('.kodik.biz') ||
                      hostname === 'kodik.cc' || hostname.endsWith('.kodik.cc');
        if (!valid) {
            throw new Error(`Unsupported host "${hostname}" for KodikParser.`);
        }
    }

    public static async getLatestLink(url: string, signal?: AbortSignal): Promise<string | null> {
        this.checkHost(url);
        const endpointUrlRegex = new RegExp(/url:atob\((?<encodedPath>[^"]+)\)/is);
        const appPlayerPathRegex = new RegExp(/src="(?<path>\/assets\/js\/app\.player_single\..*?\.js)"/is);

        const playerFetch = await proxyFetch(url, { signal });
        if (!playerFetch.ok) return null;
        const playerResponse = await playerFetch.text();
        const appPlayerPath = playerResponse.match(appPlayerPathRegex)?.groups?.path;

        if (!appPlayerPath) return null;

        const appPlayerBase = getUpstreamUrl(playerFetch, url);
        const appPlayerUrl = new URL(appPlayerPath, appPlayerBase).toString();
        const appPlayerFetch = await proxyFetch(appPlayerUrl, { signal });
        if (!appPlayerFetch.ok) return null;
        const appPlayerResponse = await appPlayerFetch.text();
        const latestEndpoint = appPlayerResponse.match(endpointUrlRegex)?.groups?.encodedPath;

        if (!latestEndpoint) return null;

        return atob(latestEndpoint);
    }

    public static async getDirectLinks(url: string, endpointPath: string = this._endpointUrl, signal?: AbortSignal): Promise<KodikVideoLinks | null> {
        this.checkHost(url);
        const urlFetch = await proxyFetch(url, { signal });
        if (!urlFetch.ok) return null;
        const urlResponse = await urlFetch.text();

        const paramsMatch = urlResponse.match(/var\s+urlParams\s*=\s*(['"])(?<params>.*?)\1/is);
        const urlParams = JSON.parse(paramsMatch?.groups?.params || "{}") as Record<string, string>;

        const videoInfoHash = urlResponse.match(/hash\s*=\s*['"](?<hash>[a-zA-Z0-9]+)['"]/is)?.groups?.hash;
        const videoInfoId = urlResponse.match(/id\s*=\s*['"](?<id>\d+)['"]/is)?.groups?.id;
        const videoInfoType = urlResponse.match(/type\s*=\s*['"](?<type>[a-zA-Z]+)['"]/is)?.groups?.type;

        if (!videoInfoHash || !videoInfoId || !videoInfoType) return null;

        const requestBody = {
            ...urlParams,
            type: videoInfoType,
            hash: videoInfoHash,
            id: videoInfoId
        }

        const apiUrl = `https://${this._baseKodikDomain}${endpointPath}`;

        const directLinksResponse = await proxyFetch(apiUrl, {
            signal,
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Accept': 'application/json'
            },
            body: new URLSearchParams(requestBody).toString()
        });

        if (!directLinksResponse.ok) return null;

        const contentType = directLinksResponse.headers.get("content-type");
        
        if (!contentType || !contentType.includes("application/json")) return null;

        const directLinks: KodikDirectLinkResponse = await directLinksResponse.json();

        if (!directLinks.links) return null;
        const validKodikUrl = /\/\/(get|cloud)\.(kodik-storage|solodcdn)\.com\/useruploads\/.*?\/.*?\/(240|360|480|720|1080)\.mp4:hls:manifest.m3u8/s;
        const zCharCode = 'Z'.charCodeAt(0);

        for (const [, sources] of Object.entries(directLinks.links)) {
          for (const source of sources) {
            if (validKodikUrl.test(source.src)) continue;

            const decryptedBase64 = source.src.replace(/[a-zA-Z]/g, e => {
                let eCharCode = e.charCodeAt(0);
                return String.fromCharCode((eCharCode <= zCharCode ? 90 : 122) >= (eCharCode = eCharCode + 18) ? eCharCode : eCharCode - 26);
              });
            source.src = atob(decryptedBase64);
          }
        }

        return directLinks.links;
    }
}


/** 
 * AniLibriaParser
 * Парсер источника Libria
 */

export interface AniLibriaAnime {
    id: number,
    type: {
        value: string,
        description: string
    },
    year: number,
    name: {
        main: string,
        english: string,
        alternative: string
    },
    alias: string,
    season: {
        value: string,
        description: string
    },
    poster: {
        src: string,
        preview: string,
        thumbnail: string,
        optimized: {
            src: string,
            preview: string,
            thumbnail: string
        }
    },
    fresh_at: string,
    created_at: string,
    updated_at: string,
    is_ongoing: boolean,
    age_rating: {
        value: string,
        description: string,
        label: string,
        is_adult: boolean
    },
    publish_day: {
        value: string,
        description: string
    },
    description: string
    notification: unknown,
    episodes_count: number | null,
    external_player: unknown,
    is_in_production: boolean,
    is_blocked_by_geo: boolean,
    is_blocked_by_copyrights: boolean,
    added_in_users_favorites: number,
    average_duration_of_episode: unknown,
    added_in_planned_collection: number,
    added_in_watched_collection: number,
    added_in_watching_collection: number,
    added_in_postponed_collection: number,
    added_in_abandoned_collection: number,
    genres: AniLibriaGenre[],
    members: AniLibriaMember[],
    sponsor: {
        id: string,
        title: string,
        description: string,
        url_title: string,
        url: string
    },
    episodes: AniLibriaEpisode[]
}

export interface AniLibriaGenre {
    id: number,
    name: string,
    image: {
        preview: string,
        thumbnail: string,
        optimized: {
            preview: string,
            thumbnail: string
        }
    },
    total_releases: number
}

export interface AniLibriaMember {
    id: string,
    role: {
        value: string,
        description: string
    },
    nickname: string,
    user: unknown
}

export interface AniLibriaEpisode {
    id: string,
    name: string | null,
    ordinal: number,
    opening: {
        stop: number | null,
        start: number | null
    },
    ending: {
        stop: number | null,
        start: number | null
    },
    preview: {
        src: string,
        preview: string,
        thumbnail: string,
        optimized: {
            src: string,
            preview: string,
            thumbnail: string
        }
    },
    hls_480: string,
    hls_720: string,
    hls_1080: string,
    duration: number,
    rutube_id: unknown,
    youtube_id: unknown,
    updated_at: string,
    sort_order: number,
    release_id: number,
    name_english: string | null
}

export interface AniLibriaReturnObject {
    [key: string]: {
        src: string
    }
}

export class AniLibriaParser {
    private static _baseAniLibriaDomain = 'aniliberty.top'
    private static _endpointUrl = '/api/v1/anime/releases'

    public static idPattern = /id=(?<id>\d+)/;
    public static episodePattern = /ep=(?<ep>\d+)/;

    private static checkHost(link: string) {
        let parsed: URL;
        try {
            parsed = new URL(link);
        } catch {
            throw new Error(`Invalid URL provided to AniLibriaParser: "${link}"`);
        }
        const hostname = parsed.hostname.toLowerCase();
        const valid = hostname === 'aniliberty.top' || hostname.endsWith('.aniliberty.top') ||
                      hostname === 'anilibria.top' || hostname.endsWith('.anilibria.top') ||
                      hostname === 'anixart.tv' || hostname.endsWith('.anixart.tv');
        if (!valid) {
            throw new Error(`Unsupported host "${hostname}" for AniLibriaParser.`);
        }
    }

    public static async getDirectLinks(link: string, signal?: AbortSignal): Promise<AniLibriaReturnObject | null> {
        this.checkHost(link);
        const id = this.idPattern.exec(link)?.groups?.id;
        const episode = this.episodePattern.exec(link)?.groups?.ep;

        if (!id || typeof episode !== 'string') return null;

        const request = await fetch(`https://${this._baseAniLibriaDomain}${this._endpointUrl}/${id}`, { signal });
        if (!request.ok) return null;

        const body = await request.json() as AniLibriaAnime;

        if (!body) return null;
        const ep = body.episodes?.find(e => e.ordinal === parseInt(episode)) ?? null;
        
        if (ep) {
            return {
                "1080": {
                    src: ep.hls_1080
                },
                "720": {
                    src: ep.hls_720
                },
                "480": {
                    src: ep.hls_480
                }
            }
        }

        return null;
    }
}

/** 
 * SibnetParser
 * Парсер источника Sibnet
 */
export class SibnetParser {
    private static _baseSibnetDomain = 'video.sibnet.ru';

    public static srcMatch = new RegExp(/src: (".*?")/);

    private static checkHost(link: string) {
        let parsed: URL;
        try {
            parsed = new URL(link);
        } catch {
            throw new Error(`Invalid URL provided to SibnetParser: "${link}"`);
        }
        const hostname = parsed.hostname.toLowerCase();
        if (hostname !== 'video.sibnet.ru' && hostname !== 'sibnet.ru' && !hostname.endsWith('.sibnet.ru')) {
            throw new Error(`Unsupported host "${hostname}" for SibnetParser. Expected video.sibnet.ru.`);
        }
    }

    public static async getDirectLink(link: string, signal?: AbortSignal): Promise<string | null> {
        this.checkHost(link);
        const request = await proxyFetch(link, { signal });
        if (!request.ok) return null;

        const body = await request.text();
        const match = this.srcMatch.exec(body);

        if (match) {
            const rawPath = match[1].replace(/"/g, '');
            const targetUrl = rawPath.startsWith('http')
                ? rawPath
                : `https://${this._baseSibnetDomain}${rawPath.startsWith('/') ? '' : '/'}${rawPath}`;

            const srcRequest = await proxyFetch(targetUrl, {
                signal,
                headers: {
                    host: this._baseSibnetDomain,
                    referer: link
                }
            });

            if (!srcRequest.ok) return null;

            return getUpstreamUrl(srcRequest, targetUrl);
        }

        return null;
    }
}

/**
 * RutubeParser
 * Парсер источника Rutube
 */
export class RutubeParser {
    private static _baseRutubeDomain = 'rutube.ru';
    private static _regExpUrl = /(http|https):\/\/(?<domain>\w+\.\w+)\/play\/embed\/(?<videoId>\w+)/;
    private static _regExpDirectLink = /^.*\s*RESOLUTION=(?<width>\d+)x(?<heigth>\d+)\r?\n(?<url>.*)$/gm;

    private static checkHost(link: string) {
        let parsed: URL;
        try {
            parsed = new URL(link);
        } catch {
            throw new Error(`Invalid URL provided to RutubeParser: "${link}"`);
        }
        const hostname = parsed.hostname.toLowerCase();
        if (hostname !== 'rutube.ru' && !hostname.endsWith('.rutube.ru')) {
            throw new Error(`Unsupported host "${hostname}" for RutubeParser. Expected rutube.ru.`);
        }
    }

    public static async getDirectLinks(link: string, signal?: AbortSignal): Promise<Record<string, string> | null> {
        this.checkHost(link);
        const match = this._regExpUrl.exec(link)?.groups?.videoId ?? null;

        if (!match) return null;

        const request = await proxyFetch(`https://${this._baseRutubeDomain}/api/play/options/${match}/?no_404=true&referer&pver=v2`, { signal });
        if (!request.ok) return null;

        const body = await request.json();
        const balancerUrl = body['video_balancer']?.default ?? null;

        if (!balancerUrl) return null;

        const balancerRequest = await proxyFetch(balancerUrl, { signal });
        if (!balancerRequest.ok) return null;

        const upstreamUrl = getUpstreamUrl(balancerRequest, balancerUrl);
        const balancerBody = await balancerRequest.text();

        this._regExpDirectLink.lastIndex = 0;
        let directLinkMatch = this._regExpDirectLink.exec(balancerBody);

        if (!directLinkMatch) return null;

        const directLinks: Record<string, string> = {};

        while (directLinkMatch) {
            const heigth = directLinkMatch.groups?.heigth ?? null;
            const url = directLinkMatch.groups?.url?.trim() ?? null;

            if (heigth && url) {
                directLinks[`${heigth}`] = resolvePlaylistEntry(url, upstreamUrl);
            }
            directLinkMatch = this._regExpDirectLink.exec(balancerBody);
        }
        return Object.keys(directLinks).length > 0 ? directLinks : null;
    }
}

export interface VKVideoTokenResponse {
    token: string;
    expires_at: number;
}

/**
 * VKVideoParser
 * Парсер источника VKVideo
 */
export class VKVideoParser {
    private static _baseVkDomain = 'vk.com';

    private static oidRegExp = /[?&]oid=(?<oid>(-|)\d+)/;
    private static idRegExp = /[?&]id=(?<id>(-|)\d+)/;
    private static hashRegExp = /[?&]hash=(?<hash>\w+)/;
    private static _regExpDirectLink = /^.*\s*RESOLUTION=(?<width>\d+)x(?<heigth>\d+)\r?\n(?<url>.*)$/gm;
    
    private static checkHost(link: string) {
        let parsed: URL;
        try {
            parsed = new URL(link);
        } catch {
            throw new Error(`Invalid URL provided to VKVideoParser: "${link}"`);
        }
        const hostname = parsed.hostname.toLowerCase();
        if (hostname !== 'vk.com' && !hostname.endsWith('.vk.com')) {
            throw new Error(`Unsupported host "${hostname}" for VKVideoParser. Expected vk.com.`);
        }
    }

    public static async getDirectLinks(link: string, signal?: AbortSignal): Promise<Record<string, string> | null> {
        this.checkHost(link);
        const oid = this.oidRegExp.exec(link)?.groups?.oid ?? null;
        const id = this.idRegExp.exec(link)?.groups?.id ?? null;
        const hash = this.hashRegExp.exec(link)?.groups?.hash ?? null;

        if (!oid || !id || !hash) return null;

        const uuid = crypto.randomUUID();
        const tokenResponse = await proxyFetch(`https://oauth.${this._baseVkDomain}/oauth/get_anonym_token?client_id=51552953&client_secret=qgr0yWwXCrsxA1jnRtRX&device_id=${uuid}`, { signal });
        if (!tokenResponse.ok) return null;

        const anonymToken: VKVideoTokenResponse = await tokenResponse.json();

        const getLinksResponse = await proxyFetch(`https://api.${this._baseVkDomain}/method/video.get`, {
            signal,
            method: 'POST',
            body: `anonymous_token=${anonymToken.token}&device_id=${uuid}&lang=en&v=5.244&videos=${oid}_${id}_${hash}`,
        });
        if (!getLinksResponse.ok) return null;

        const getLinksResponseJson = await getLinksResponse.json();
        const masterUrl = getLinksResponseJson.response?.items?.[0]?.files?.hls;
        if (!masterUrl) return null;

        const hlsMasterRequest = await proxyFetch(masterUrl, { signal });
        if (!hlsMasterRequest.ok) return null;

        const upstreamUrl = getUpstreamUrl(hlsMasterRequest, masterUrl);
        const hlsMasterBody = await hlsMasterRequest.text();

        this._regExpDirectLink.lastIndex = 0;
        let directLinkMatch = this._regExpDirectLink.exec(hlsMasterBody);

        if (!directLinkMatch) return null;

        const directLinks: Record<string, string> = {};

        while (directLinkMatch) {
            const heigth = directLinkMatch.groups?.heigth ?? null;
            const url = directLinkMatch.groups?.url?.trim() ?? null;

            if (heigth && url) {
                directLinks[`${heigth}`] = resolvePlaylistEntry(url, upstreamUrl);
            }
            directLinkMatch = this._regExpDirectLink.exec(hlsMasterBody);
        }
        return Object.keys(directLinks).length > 0 ? directLinks : null;
    }
}

/**
 * OKParser
 * Парсер источника OK
 */
export class OKParser {
    private static _regExpDataOptions = /data-options="(?<content>{.*})"/m;
    private static _regExpDirectLink = /^.*\s*RESOLUTION=(?<width>\d+)x(?<heigth>\d+)\r?\n(?<url>.*)$/gm;

    private static checkHost(link: string) {
        let parsed: URL;
        try {
            parsed = new URL(link);
        } catch {
            throw new Error(`Invalid URL provided to OKParser: "${link}"`);
        }
        const hostname = parsed.hostname.toLowerCase();
        if (hostname !== 'ok.ru' && !hostname.endsWith('.ok.ru') &&
            hostname !== 'odnoklassniki.ru' && !hostname.endsWith('.odnoklassniki.ru')) {
            throw new Error(`Unsupported host "${hostname}" for OKParser. Expected ok.ru or odnoklassniki.ru.`);
        }
    }

    public static async getDirectLinks(link: string, signal?: AbortSignal): Promise<Record<string, string> | null> {
        this.checkHost(link);
        const request = await proxyFetch(link, { signal });
        if (!request.ok) return null;

        const body = await request.text();

        const dataOptionsMatch = this._regExpDataOptions.exec(body)?.groups?.content ?? null;
        if (!dataOptionsMatch) return null;

        const dataOptions = dataOptionsMatch.replace(/&quot;/g, "\"").replace(/\\\\u0026/g, "&");
        let dataOptionsJson: { flashvars?: { metadata?: string } };
        let metadataJson: { provider?: string; isLive?: boolean; hlsManifestUrl?: string };
        try {
            dataOptionsJson = JSON.parse(dataOptions);
            metadataJson = JSON.parse(dataOptionsJson.flashvars?.metadata || "{}");
        } catch {
            return null;
        }

        if (metadataJson.provider !== "UPLOADED_ODKL" || metadataJson.isLive) return null;

        const manifestUrl = metadataJson.hlsManifestUrl;
        if (!manifestUrl) return null;

        const hlsMasterRequest = await proxyFetch(manifestUrl, { signal });
        if (!hlsMasterRequest.ok) return null;

        const upstreamUrl = getUpstreamUrl(hlsMasterRequest, manifestUrl);
        const hlsMasterBody = await hlsMasterRequest.text();

        this._regExpDirectLink.lastIndex = 0;
        let directLinkMatch = this._regExpDirectLink.exec(hlsMasterBody);

        if (!directLinkMatch) return null;

        const directLinks: Record<string, string> = {};

        while (directLinkMatch) {
            const heigth = directLinkMatch.groups?.heigth ?? null;
            const url = directLinkMatch.groups?.url?.trim() ?? null;

            if (heigth && url) {
                directLinks[`${heigth}`] = resolvePlaylistEntry(url, upstreamUrl);
            }
            directLinkMatch = this._regExpDirectLink.exec(hlsMasterBody);
        }
        return Object.keys(directLinks).length > 0 ? directLinks : null;
    }
}

const PARSERS = [
    {
        test: (url: string) => url.includes('kodik'),
        parse: (url: string, signal?: AbortSignal) => KodikParser.getDirectLinks(url, undefined, signal)
    },
    {
        test: (url: string) => url.includes('aniliberty.top') || url.includes('anilibria.top') || url.includes('anixart'),
        parse: (url: string, signal?: AbortSignal) => AniLibriaParser.getDirectLinks(url, signal)
    },
    {
        test: (url: string) => url.includes('video.sibnet.ru'),
        parse: async (url: string, signal?: AbortSignal) => {
            const link = await SibnetParser.getDirectLink(url, signal);
            return link ? { "default": link } : null;
        }
    },
    {
        test: (url: string) => url.includes('rutube.ru'),
        parse: (url: string, signal?: AbortSignal) => RutubeParser.getDirectLinks(url, signal)
    },
    {
        test: (url: string) => url.includes('vk.com'),
        parse: (url: string, signal?: AbortSignal) => VKVideoParser.getDirectLinks(url, signal)
    },
    {
        test: (url: string) => url.includes('ok.ru') || url.includes('odnoklassniki.ru'),
        parse: (url: string, signal?: AbortSignal) => OKParser.getDirectLinks(url, signal)
    }
];

export async function extractVideoLinks(url: string, signal?: AbortSignal): Promise<VideoSources | null> {
    signal?.throwIfAborted();
    const parser = PARSERS.find(p => p.test(url));

    if (!parser) {
        console.warn("Не найден парсер для ссылки:", url);
        return null;
    }

    try {
        const links = await parser.parse(url, signal);
        signal?.throwIfAborted();
        return links ? normalizeVideoSources(links as RawVideoSources) : null;
    } catch (err) {
        console.error("Ошибка при парсинге ссылки:", err);
        return null;
    }
}
