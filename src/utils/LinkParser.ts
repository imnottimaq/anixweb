import type { VideoSources, VideoStreamType } from '../shared/types/video';

/*
    LinkParser.ts взят из AnixartJS(https://github.com/theDesConnet/AnixartJS)
*/

/**
 * Парсер различных источников
 */

/**
 * KodikParser
 * Парсер источника Kodik
 * Большая часть кода основана на KodikWrapper (https://github.com/thedvxchsquad/kodikwrapper/blob/master/src/video-links.ts)
 */

/**
 * Качество
 */

const PROXY_BASE = "https://kodik-proxy.imnottimaq.workers.dev/corsproxy?url="; //

async function proxyFetch(targetUrl: string, options?: RequestInit) {
    const proxiedUrl = `${PROXY_BASE}${encodeURIComponent(targetUrl)}`;
    
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

    public static async getLatestLink(url: string): Promise<string | null> {
        const endpointUrlRegex = new RegExp(/url:atob\((?<encodedPath>[^"]+)\)/is);
        const appPlayerPathRegex = new RegExp(/src="(?<path>\/assets\/js\/app\.player_single\..*?\.js)"/is);

        const playerResponse = await (await proxyFetch(url)).text();
        const appPlayerPath = playerResponse.match(appPlayerPathRegex)?.groups?.path;

        if (!appPlayerPath) return null;

        const appPlayerResponse = await (await proxyFetch(`https://${new URL(url).host}${appPlayerPath}`)).text();
        const latestEndpoint = appPlayerResponse.match(endpointUrlRegex)?.groups?.encodedPath;

        if (!latestEndpoint) return null;

        return atob(latestEndpoint);
    }

    public static async getDirectLinks(url: string, endpointPath: string = this._endpointUrl): Promise<KodikVideoLinks | null> {
        const urlResponse = await (await proxyFetch(url)).text();

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
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Accept': 'application/json'
            },
            body: new URLSearchParams(requestBody).toString()
        });

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

/**
 * Тайтл
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

/**
 * Жанр
 */
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

/**
 * Участник Anilibria
 */
export interface AniLibriaMember {
    id: string,
    role: {
        value: string,
        description: string
    },
    nickname: string,
    user: unknown
}

/**
 * Эпизод
 */
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

/**
 * Возвращаемый обьект
 */
export interface AniLibriaReturnObject {
    [key: string]: {
        src: string
    }
}

/**
 * Класс парсера анилибрии
 */
export class AniLibriaParser {
    private static _baseAniLibriaDomain = 'aniliberty.top'
    private static _endpointUrl = '/api/v1/anime/releases'

    public static idPattern = /id=(?<id>\d+)/;
    public static episodePattern = /ep=(?<ep>\d+)/;

    public static async getDirectLinks(link: string): Promise<AniLibriaReturnObject | null> {
        const id = this.idPattern.exec(link)?.groups?.id;
        const episode = this.episodePattern.exec(link)?.groups?.ep;

        const request = await fetch(`https://${this._baseAniLibriaDomain}${this._endpointUrl}/${id}`);

        const body = await request.json() as AniLibriaAnime;

        if (!body || typeof episode != 'string') return null;
        const ep = body.episodes.find(e => e.ordinal == parseInt(episode!)) ?? null;
        
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

    public static async getDirectLink(link: string): Promise<string | null> {
        const request = await proxyFetch(link);

        const body = await request.text();
        const match = this.srcMatch.exec(body);

        if (match) {
            const srcRequest = await proxyFetch(`https://${this._baseSibnetDomain}${match[1].replace(/"/g, '')}`, {
                headers: {
                    host: this._baseSibnetDomain,
                    referer: link
                }
            });

            return srcRequest.url ?? null;
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
    private static _regExpUrl = /(http|https):\/\/(?<domain>\w+.\w+)\/play\/embed\/(?<videoId>\w+)/;
    private static _regExpDirectLink = /^.*\s*RESOLUTION=(?<width>\d+)x(?<heigth>\d+)\n(?<url>.*)$/gm;

    public static async getDirectLinks(link: string): Promise<Record<string, string> | null> {
        const match = this._regExpUrl.exec(link)?.groups?.videoId ?? null;

        if (!match) return null;

        const request = await proxyFetch(`https://${this._baseRutubeDomain}/api/play/options/${match}/?no_404=true&referer&pver=v2`);
        const body = await request.json();
        const balancerUrl = body['video_balancer'].default ?? null;

        if (!balancerUrl) return null;

        const balancerRequest = await proxyFetch(balancerUrl);
        const balancerBody = await balancerRequest.text();

        let directLinkMatch = this._regExpDirectLink.exec(balancerBody);

        if (directLinkMatch?.length == 0) return null;

        const directLinks: Record<string, string> = {};

        do {
            const width = directLinkMatch?.groups?.width ?? null;
            const heigth = directLinkMatch?.groups?.heigth ?? null;
            const url = directLinkMatch?.groups?.url ?? null;

            if (!width || !heigth || !url) break;

            directLinks[`${heigth}`] = url;
            directLinkMatch = this._regExpDirectLink.exec(balancerBody);
        }
        while (directLinkMatch);
        return directLinks;
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
    private static _regExpDirectLink = /^.*\s*RESOLUTION=(?<width>\d+)x(?<heigth>\d+)\n(?<url>.*)$/gm;
    
    public static async getDirectLinks(link: string): Promise<Record<string, string> | null> {
        const oid = this.oidRegExp.exec(link)?.groups?.oid ?? null;
        const id = this.idRegExp.exec(link)?.groups?.id ?? null;
        const hash = this.hashRegExp.exec(link)?.groups?.hash ?? null;

        if (!oid || !id || !hash) return null;

        const uuid = crypto.randomUUID();
        const tokenResponse = await proxyFetch(`https://oauth.${this._baseVkDomain}/oauth/get_anonym_token?client_id=51552953&client_secret=qgr0yWwXCrsxA1jnRtRX&device_id=${uuid}`);

        const anonymToken: VKVideoTokenResponse = await tokenResponse.json();

        const getLinksResponse = await proxyFetch(`https://api.${this._baseVkDomain}/method/video.get`, {
            method: 'POST',
            body: `anonymous_token=${anonymToken.token}&device_id=${uuid}&lang=en&v=5.244&videos=${oid}_${id}_${hash}`,
        });

        const getLinksResponseJson = await getLinksResponse.json();
        const hlsMasterRequest = await proxyFetch(getLinksResponseJson.response.items[0].files.hls);
        const vkServerUrl = new URL(hlsMasterRequest.url).host;

        const hlsMasterBody = await hlsMasterRequest.text();

        let directLinkMatch = this._regExpDirectLink.exec(hlsMasterBody);

        if (directLinkMatch?.length == 0) return null;

        const directLinks: Record<string, string> = {};

        do {
            const width = directLinkMatch?.groups?.width ?? null;
            const heigth = directLinkMatch?.groups?.heigth ?? null;
            const url = directLinkMatch?.groups?.url ?? null;

            if (!width || !heigth || !url) break;

            directLinks[`${heigth}`] = `https://${vkServerUrl}${url}`;
            directLinkMatch = this._regExpDirectLink.exec(hlsMasterBody);
        }
        while (directLinkMatch);
        return directLinks;
    }
}

/**
 * OKParser
 * Парсер источника OK
 */
export class OKParser {
    private static _regExpDataOptions = /data-options="(?<content>{.*})"/m;
    private static _regExpDirectLink = /^.*\s*RESOLUTION=(?<width>\d+)x(?<heigth>\d+)\n(?<url>.*)$/gm;
    public static async getDirectLinks(link: string): Promise<Record<string, string> | null> {
        const request = await proxyFetch(link);
        const body = await request.text();

        const dataOptionsMatch = this._regExpDataOptions.exec(body)?.groups?.content ?? null;
        if (!dataOptionsMatch) return null;

        const dataOptions = dataOptionsMatch.replace(/&quot;/g, "\"").replace(/\\\\u0026/g, "&")
        const dataOptionsJson = JSON.parse(dataOptions);
        const metadataJson = JSON.parse(dataOptionsJson.flashvars.metadata);

        if (metadataJson.provider != "UPLOADED_ODKL" || metadataJson.isLive) return null;

        const hlsMasterRequest = await proxyFetch(metadataJson.hlsManifestUrl);
        const hlsMasterBody = await hlsMasterRequest.text();
        const okServerUrl = new URL(hlsMasterRequest.url).host;

        let directLinkMatch = this._regExpDirectLink.exec(hlsMasterBody);

        if (directLinkMatch?.length == 0) return null;

        const directLinks: Record<string, string> = {};

        do {
            const width = directLinkMatch?.groups?.width ?? null;
            const heigth = directLinkMatch?.groups?.heigth ?? null;
            const url = directLinkMatch?.groups?.url ?? null;

            if (!width || !heigth || !url) break;

            directLinks[`${heigth}`] = `https://${okServerUrl}${url}`;
            directLinkMatch = this._regExpDirectLink.exec(hlsMasterBody);
        }
        while (directLinkMatch);
        return directLinks;
    }
}

const PARSERS = [
    {
        test: (url: string) => url.includes('kodik'),
        parse: (url: string) => KodikParser.getDirectLinks(url)
    },
    {
        test: (url: string) => url.includes('aniliberty.top') || url.includes('anixart'),
        parse: (url: string) => AniLibriaParser.getDirectLinks(url)
    },
    {
        test: (url: string) => url.includes('video.sibnet.ru'),
        parse: async (url: string) => {
            const link = await SibnetParser.getDirectLink(url);
            return link ? { "default": link } : null;
        }
    },
    {
        test: (url: string) => url.includes('rutube.ru'),
        parse: (url: string) => RutubeParser.getDirectLinks(url)
    },
    {
        test: (url: string) => url.includes('vk.com'),
        parse: (url: string) => VKVideoParser.getDirectLinks(url)
    },
    {
        test: (url: string) => url.includes('ok.ru') || url.includes('odnoklassniki.ru'),
        parse: (url: string) => OKParser.getDirectLinks(url)
    }
];

export async function extractVideoLinks(url: string): Promise<VideoSources | null> {
    const parser = PARSERS.find(p => p.test(url));

    if (!parser) {
        console.warn("Не найден парсер для ссылки:", url);
        return null;
    }

    try {
        const links = await parser.parse(url);
        return links ? normalizeVideoSources(links as RawVideoSources) : null;
    } catch (err) {
        console.error("Ошибка при парсинге ссылки:", err);
        return null;
    }
}
