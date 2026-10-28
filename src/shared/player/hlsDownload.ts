import { Parser, type ByteRange, type Segment } from 'm3u8-parser';
import mux from 'mux.js';
import type { DownloadOptions, DownloadProgress, DownloadResult } from './download.ts';

const MAX_BYTES = 256 * 1024 * 1024;
const MAX_PLAYLIST_BYTES = 2 * 1024 * 1024;

const DEFAULT_CONCURRENCY = 5;

function checkAbort(signal?: AbortSignal) {
    signal?.throwIfAborted();
}

function mediaUrl(uri: string, base: string) {
    const url = new URL(uri, base);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Unsupported HLS URL');
    return url.href;
}

// Read incrementally so unknown-length responses cannot exhaust memory.
async function readResponse(
    response: Response,
    limit: number,
    signal?: AbortSignal,
    onChunk?: (length: number) => void
) {
    if (!response.ok || !response.body) {
        await response.body?.cancel().catch(() => {});
        throw new Error(`HLS request failed: HTTP ${response.status}`);
    }
    const contentLength = Number(response.headers.get('content-length'));
    if (contentLength > limit) {
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
            onChunk?.(value.byteLength);
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
    if (chunks.length === 0) return new Uint8Array(0);
    if (chunks.length === 1) return chunks[0];
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return bytes;
}

export async function downloadEpisodeHls({
    stream,
    filename,
    signal,
    onProgress,
    fetchFn = fetch,
    maxBytes = MAX_BYTES,
    concurrency: customConcurrency,
}: DownloadOptions): Promise<DownloadResult> {
    const limit = Number.isFinite(maxBytes) && maxBytes > 0 ? Math.min(MAX_BYTES, maxBytes) : MAX_BYTES;
    const concurrency = Number.isInteger(customConcurrency) && customConcurrency! > 0
        ? Math.max(1, Math.min(customConcurrency!, 8))
        : DEFAULT_CONCURRENCY;
    const maxLookahead = concurrency * 2;

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
    const hasMap = Boolean(segments[0].map);
    const activeMap = hasMap ? JSON.stringify(segments[0].map) : '';
    for (const segment of segments) {
        if (segment.key && segment.key.method !== 'NONE') throw new Error('Encrypted HLS downloads are not supported');
        if (segment.discontinuity || (segment as Segment & { gap?: boolean }).gap) throw new Error('HLS timeline discontinuities or missing segments are not supported');
        if (!segment.uri) throw new Error('HLS segment URL is missing');
        if (Boolean(segment.map) !== hasMap) throw new Error('HLS segment format changes are not supported');
        if (segment.map && JSON.stringify(segment.map) !== activeMap) throw new Error('HLS initialization changes are not supported');
    }

    const output: Uint8Array<ArrayBuffer>[] = [];
    let outputSize = 0, loaded = 0;
    const append = (bytes: Uint8Array) => {
        if (outputSize + bytes.byteLength > limit) throw new Error('Assembled video exceeds the 256 MB memory limit');
        output.push(new Uint8Array(bytes));
        outputSize += bytes.byteLength;
    };

    const internalController = new AbortController();
    const internalSignal = internalController.signal;
    let fatalError: unknown = null;

    const waitingResolvers = new Map<number, (bytes: Uint8Array) => void>();
    const waitingRejecters = new Map<number, (err: unknown) => void>();
    const downloaded = new Map<number, Uint8Array>();

    const failAll = (err: unknown) => {
        if (fatalError) return;
        fatalError = err;
        internalController.abort(err);
        for (const reject of waitingRejecters.values()) {
            reject(err);
        }
        waitingResolvers.clear();
        waitingRejecters.clear();
        downloaded.clear();
    };

    const onUserAbort = () => {
        const err = signal?.reason instanceof Error
            ? signal.reason
            : new DOMException('Download aborted', 'AbortError');
        failAll(err);
    };
    signal?.addEventListener('abort', onUserAbort, { once: true });

    const getBytes = async (uri: string, range?: ByteRange) => {
        checkAbort(signal);
        checkAbort(internalSignal);
        const url = mediaUrl(uri, playlistUrl);
        let headers: HeadersInit | undefined;
        if (range) {
            if (!Number.isSafeInteger(range.offset) || range.offset < 0 || !Number.isSafeInteger(range.length) || range.length <= 0) {
                throw new Error('Invalid HLS byte range');
            }
            headers = { Range: `bytes=${range.offset}-${range.offset + range.length - 1}` };
        }
        const response = await fetchFn(url, { signal: internalSignal, headers });
        if (range && (response.status !== 206 || response.headers.get('content-range')?.split('/')[0] !== `bytes ${range.offset}-${range.offset + range.length - 1}`)) {
            await response.body?.cancel().catch(() => {});
            throw new Error('Server did not return the requested HLS byte range');
        }
        const remainingLimit = limit - loaded;
        if (remainingLimit <= 0) {
            await response.body?.cancel().catch(() => {});
            throw new Error('Download exceeds the 256 MB memory limit');
        }
        const bytes = await readResponse(response, remainingLimit, internalSignal, chunkBytes => {
            loaded += chunkBytes;
            if (loaded > limit) throw new Error('Download exceeds the 256 MB memory limit');
        });
        if (!bytes.length || (range && bytes.length !== range.length)) throw new Error('Empty or incomplete HLS segment');
        return bytes;
    };

    let wroteInit = false;
    let initSignature = '';
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
        if (hasMap) {
            const init = await getBytes(segments[0].map!.uri, segments[0].map!.byterange);
            if (String.fromCharCode(...init.subarray(4, 8)) !== 'ftyp') throw new Error('Invalid HLS MP4 initialization');
            append(init);
        }

        let nextFetchIndex = 0;
        let nextProcessIndex = 0;
        let activeFetches = 0;

        const scheduleFetches = () => {
            if (fatalError || internalSignal.aborted) return;
            while (
                activeFetches < concurrency &&
                nextFetchIndex < segments.length &&
                nextFetchIndex < nextProcessIndex + maxLookahead
            ) {
                const indexToFetch = nextFetchIndex++;
                activeFetches++;
                const seg = segments[indexToFetch];
                getBytes(seg.uri, seg.byterange)
                    .then(bytes => {
                        activeFetches--;
                        if (fatalError || internalSignal.aborted) return;
                        const resolver = waitingResolvers.get(indexToFetch);
                        if (resolver) {
                            waitingResolvers.delete(indexToFetch);
                            waitingRejecters.delete(indexToFetch);
                            resolver(bytes);
                        } else {
                            downloaded.set(indexToFetch, bytes);
                        }
                        scheduleFetches();
                    })
                    .catch(err => {
                        activeFetches--;
                        failAll(err);
                    });
            }
        };

        const getSegmentBytes = (indexToGet: number): Promise<Uint8Array> => {
            if (fatalError) return Promise.reject(fatalError);
            if (downloaded.has(indexToGet)) {
                const bytes = downloaded.get(indexToGet)!;
                downloaded.delete(indexToGet);
                return Promise.resolve(bytes);
            }
            return new Promise<Uint8Array>((resolve, reject) => {
                waitingResolvers.set(indexToGet, resolve);
                waitingRejecters.set(indexToGet, reject);
            });
        };

        scheduleFetches();

        for (let index = 0; index < segments.length; index++) {
            checkAbort(signal);
            if (fatalError) throw fatalError;
            const bytes = await getSegmentBytes(index);
            checkAbort(signal);
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
            nextProcessIndex = index + 1;
            scheduleFetches();
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
        signal?.removeEventListener('abort', onUserAbort);
        failAll(new Error('Operation terminated'));
        output.length = 0;
        downloaded.clear();
        waitingResolvers.clear();
        waitingRejecters.clear();
        transmuxer?.dispose();
    }
}
