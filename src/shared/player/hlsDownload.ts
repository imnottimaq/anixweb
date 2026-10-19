import { Parser, type ByteRange, type Segment } from 'm3u8-parser';
import mux from 'mux.js';
import type { DownloadOptions, DownloadProgress, DownloadResult } from './download.ts';

const MAX_BYTES = 256 * 1024 * 1024;
const MAX_PLAYLIST_BYTES = 2 * 1024 * 1024;

function checkAbort(signal?: AbortSignal) {
    signal?.throwIfAborted();
}

function mediaUrl(uri: string, base: string) {
    const url = new URL(uri, base);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Unsupported HLS URL');
    return url.href;
}

// Read incrementally so unknown-length responses cannot exhaust memory.
async function readResponse(response: Response, limit: number, signal?: AbortSignal) {
    if (!response.ok || !response.body) {
        await response.body?.cancel().catch(() => {});
        throw new Error(`HLS request failed: HTTP ${response.status}`);
    }
    if (Number(response.headers.get('content-length')) > limit) {
        await response.body.cancel().catch(() => {});
        throw new Error('Download exceeds the 256 MB memory limit');
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    const abort = () => { void reader.cancel().catch(() => {}); };
    signal?.addEventListener('abort', abort, { once: true });
    try {
        checkAbort(signal);
        while (true) {
            const { value, done } = await reader.read();
            checkAbort(signal);
            if (done) break;
            length += value.byteLength;
            if (length > limit) throw new Error('Download exceeds the 256 MB memory limit');
            chunks.push(value);
        }
    } catch (error) {
        await reader.cancel().catch(() => {});
        throw error;
    } finally {
        signal?.removeEventListener('abort', abort);
        reader.releaseLock();
    }
    const expected = Number(response.headers.get('content-length'));
    if (expected > 0 && !response.headers.get('content-encoding') && length !== expected) {
        throw new Error('HLS response was truncated');
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return bytes;
}

export async function downloadEpisodeHls({ stream, filename, signal, onProgress, fetchFn = fetch, maxBytes = MAX_BYTES }: DownloadOptions): Promise<DownloadResult> {
    const limit = Number.isFinite(maxBytes) && maxBytes > 0 ? Math.min(MAX_BYTES, maxBytes) : MAX_BYTES;
    let playlistUrl = stream.src;
    const visited = new Set<string>();
    let segments: Segment[] = [];
    for (let depth = 0; depth < 5; depth++) {
        checkAbort(signal);
        if (visited.has(playlistUrl)) throw new Error('Circular HLS playlist');
        visited.add(playlistUrl);
        const response = await fetchFn(playlistUrl, { signal });
        // Relative segment URLs are relative to the final URL after a redirect.
        playlistUrl = response.url || playlistUrl;
        const text = new TextDecoder().decode(await readResponse(response, MAX_PLAYLIST_BYTES, signal));
        if (!text.trimStart().startsWith('#EXTM3U')) throw new Error('Invalid HLS playlist');
        const parser = new Parser();
        parser.push(text); parser.end();
        const manifest = parser.manifest;
        if (manifest.contentProtection) throw new Error('Protected HLS downloads are not supported');
        if (manifest.playlists?.length) {
            const height = Number.parseInt(stream.quality || '', 10);
            const variant = [...manifest.playlists].sort((a, b) => {
                const aHeight = a.attributes.RESOLUTION?.height || 0;
                const bHeight = b.attributes.RESOLUTION?.height || 0;
                const distance = height > 0 ? Math.abs(aHeight - height) - Math.abs(bHeight - height) : 0;
                return distance || bHeight - aHeight || (b.attributes.BANDWIDTH || 0) - (a.attributes.BANDWIDTH || 0);
            })[0];
            const audio = variant.attributes.AUDIO;
            if (audio && Object.values(manifest.mediaGroups?.AUDIO?.[audio] || {}).some(item => item.uri)) {
                throw new Error('HLS with a separate audio playlist is not supported for downloading yet');
            }
            playlistUrl = mediaUrl(variant.uri, playlistUrl);
            continue;
        }
        if (!manifest.endList) throw new Error('Only complete episodes can be downloaded; this HLS stream is live');
        segments = manifest.segments;
        break;
    }
    if (!segments.length) throw new Error('HLS playlist contains no downloadable segments');
    if (segments.length > 20000) throw new Error('HLS playlist contains too many segments');
    for (const segment of segments) {
        if (segment.key && segment.key.method !== 'NONE') throw new Error('Encrypted HLS downloads are not supported');
        if (segment.discontinuity || (segment as Segment & { gap?: boolean }).gap) throw new Error('HLS timeline discontinuities or missing segments are not supported');
        if (!segment.uri) throw new Error('HLS segment URL is missing');
    }

    const output: Uint8Array<ArrayBuffer>[] = [];
    let outputSize = 0, loaded = 0;
    const append = (bytes: Uint8Array) => {
        if (outputSize + bytes.byteLength > limit) throw new Error('Assembled video exceeds the 256 MB memory limit');
        output.push(new Uint8Array(bytes));
        outputSize += bytes.byteLength;
    };
    const getBytes = async (uri: string, range?: ByteRange) => {
        checkAbort(signal);
        const url = mediaUrl(uri, playlistUrl);
        let headers: HeadersInit | undefined;
        if (range) {
            if (!Number.isSafeInteger(range.offset) || range.offset < 0 || !Number.isSafeInteger(range.length) || range.length <= 0) {
                throw new Error('Invalid HLS byte range');
            }
            headers = { Range: `bytes=${range.offset}-${range.offset + range.length - 1}` };
        }
        const response = await fetchFn(url, { signal, headers });
        if (range && (response.status !== 206 || response.headers.get('content-range')?.split('/')[0] !== `bytes ${range.offset}-${range.offset + range.length - 1}`)) {
            await response.body?.cancel().catch(() => {});
            throw new Error('Server did not return the requested HLS byte range');
        }
        const bytes = await readResponse(response, limit - loaded, signal);
        if (!bytes.length || (range && bytes.length !== range.length)) throw new Error('Empty or incomplete HLS segment');
        loaded += bytes.length;
        return bytes;
    };

    let wroteInit = false;
    let initSignature = '';
    let activeMap = '';
    const hasMap = Boolean(segments[0].map);
    const transmuxer = hasMap ? null : new mux.mp4.Transmuxer({ remux: true });
    transmuxer?.on('data', segment => {
        if (segment.type !== 'combined') throw new Error('HLS download requires a combined audio/video stream');
        // A single init segment describes the complete file. Reject codec changes.
        const signature = Array.from(segment.initSegment).join(',');
        if (wroteInit && signature !== initSignature) throw new Error('HLS codec changes are not supported');
        if (!wroteInit) { append(segment.initSegment); wroteInit = true; initSignature = signature; }
        append(segment.data);
    });
    try {
        for (let index = 0; index < segments.length; index++) {
            const segment = segments[index];
            if (Boolean(segment.map) !== hasMap) throw new Error('HLS segment format changes are not supported');
            if (segment.map) {
                const mapKey = JSON.stringify(segment.map);
                if (activeMap && mapKey !== activeMap) throw new Error('HLS initialization changes are not supported');
                if (!activeMap) {
                    const init = await getBytes(segment.map.uri, segment.map.byterange);
                    if (String.fromCharCode(...init.subarray(4, 8)) !== 'ftyp') throw new Error('Invalid HLS MP4 initialization');
                    append(init); activeMap = mapKey;
                }
            }
            const bytes = await getBytes(segment.uri, segment.byterange);
            if (hasMap) {
                const box = String.fromCharCode(...bytes.subarray(4, 8));
                if (!['styp', 'sidx', 'moof', 'emsg', 'prft'].includes(box)) throw new Error('Invalid HLS MP4 fragment');
                append(bytes);
            } else {
                if (bytes[0] !== 0x47) throw new Error('Unsupported HLS segment format; expected MPEG-TS');
                const previousSize = outputSize;
                transmuxer!.push(bytes); transmuxer!.flush();
                if (outputSize === previousSize) throw new Error('HLS segment contains no compatible audio/video');
            }
            const progress: DownloadProgress = {
                loaded, total: 0, percent: Math.min(99, Math.round((index + 1) / segments.length * 100)),
                completedSegments: index + 1, totalSegments: segments.length,
            };
            onProgress?.(progress);
        }
        checkAbort(signal);
        const blob = new Blob(output, { type: 'video/mp4' });
        onProgress?.({ loaded, total: loaded, percent: 100, completedSegments: segments.length, totalSegments: segments.length });
        return { blob, size: blob.size, filename };
    } finally {
        output.length = 0;
        transmuxer?.dispose();
    }
}
