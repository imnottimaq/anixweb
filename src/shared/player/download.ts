import { useCallback, useEffect, useRef, useState } from 'react';

export type DownloadStatus = 'idle' | 'downloading' | 'completed' | 'cancelled' | 'error' | 'unsupported';

export interface DownloadProgress {
    loaded: number;
    total: number;
    percent: number;
}

export interface DownloadStreamOption {
    quality: string;
    src: string;
    type: string;
    isDirectMp4: boolean;
    isHls: boolean;
}

export function isHlsStream(stream: { src: string; type?: string }): boolean {
    const type = (stream.type || '').split(';')[0].trim().toLowerCase();
    const src = stream.src.toLowerCase();
    return ['application/x-mpegurl', 'application/vnd.apple.mpegurl', 'audio/mpegurl', 'audio/x-mpegurl'].includes(type) || src.includes('.m3u8') || src.includes(':hls:');
}

export function isDirectMp4Stream(stream: { src: string; type?: string }): boolean {
    if (isHlsStream(stream)) return false;
    const type = (stream.type || '').split(';')[0].trim().toLowerCase();
    return type === 'video/mp4' || /\.(mp4|m4v)([?#].*)?$/i.test(stream.src);
}

export function sanitizeFilename(name: string): string {
    return name
        .replace(/[\\/:*?"<>|]/g, '_')
        .replace(/\s+/g, ' ')
        .trim();
}

export function formatBytes(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const digitGroups = Math.min(Math.floor(Math.log10(bytes) / Math.log10(1024)), units.length - 1);
    const value = bytes / Math.pow(1024, digitGroups);
    const formatted = digitGroups === 0 ? Math.round(value).toString() : (value % 1 === 0 ? value.toFixed(0) : value.toFixed(1));
    return `${formatted} ${units[digitGroups]}`;
}

export function getDownloadStreamOptions(sources: Record<string, Array<{ src: string; type: string }>>): DownloadStreamOption[] {
    const qualities = Object.keys(sources).sort((a, b) => (Number(b) || 0) - (Number(a) || 0));
    return qualities.map(quality => {
        const stream = sources[quality]?.[0];
        const src = stream?.src || '';
        const type = stream?.type || '';
        const isHls = isHlsStream({ src, type });
        const isDirectMp4 = isDirectMp4Stream({ src, type });
        return { quality, src, type, isDirectMp4, isHls };
    });
}

export interface DownloadOptions {
    stream: { src: string; type?: string };
    filename: string;
    onProgress?: (progress: DownloadProgress) => void;
    signal?: AbortSignal;
    fetchFn?: typeof fetch;
    maxBytes?: number;
}

export interface DownloadResult {
    blob: Blob;
    filename: string;
    size: number;
}

export const MAX_DOWNLOAD_BYTES = 256 * 1024 * 1024;

export async function downloadEpisodeDirect({
    stream,
    filename,
    onProgress,
    signal,
    fetchFn = fetch,
    maxBytes = MAX_DOWNLOAD_BYTES,
}: DownloadOptions): Promise<DownloadResult> {
    if (isHlsStream(stream)) {
        throw new Error('HLS streams cannot be saved as direct MP4. Renaming .m3u8 to .mp4 produces invalid video files.');
    }
    if (!isDirectMp4Stream(stream)) {
        throw new Error('Unsupported stream format for direct downloading. Only direct MP4 streams are supported.');
    }

    if (signal?.aborted) {
        throw new DOMException('Download aborted', 'AbortError');
    }

    const response = await fetchFn(stream.src, { signal });
    if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        throw new Error(`HTTP error ${response.status}: ${response.statusText}`);
    }

    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    if (contentType.includes('text/html') || contentType.includes('application/xhtml+xml')) {
        await response.body?.cancel().catch(() => {});
        throw new Error('Received HTML response instead of video stream');
    }

    const contentLengthHeader = response.headers.get('content-length');
    const total = contentLengthHeader && /^\d+$/.test(contentLengthHeader) ? Number(contentLengthHeader) : 0;
    const limit = Number.isFinite(maxBytes) && maxBytes > 0 ? Math.min(MAX_DOWNLOAD_BYTES, maxBytes) : MAX_DOWNLOAD_BYTES;
    if (total > limit) {
        await response.body?.cancel().catch(() => {});
        throw new Error(`File size (${formatBytes(total)}) exceeds maximum supported limit (${formatBytes(limit)})`);
    }

    const body = response.body;
    if (!body) {
        throw new Error('Received empty video stream');
    }

    const reader = body.getReader();
    const chunks: Uint8Array<ArrayBuffer>[] = [];
    let loaded = 0;
    const cancelReader = () => { void reader.cancel('Download aborted').catch(() => {}); };
    signal?.addEventListener('abort', cancelReader, { once: true });

    try {
        while (true) {
            if (signal?.aborted) {
                await reader.cancel('Download aborted').catch(() => {});
                throw new DOMException('Download aborted', 'AbortError');
            }

            const { done, value } = await reader.read();
            if (done) break;

            if (value) {
                loaded += value.byteLength;
                if (loaded > limit) {
                    await reader.cancel('Exceeded maximum size').catch(() => {});
                    throw new Error(`Download exceeded maximum supported limit of ${formatBytes(limit)}`);
                }
                const ownedChunk: Uint8Array<ArrayBuffer> = value.slice();
                chunks.push(ownedChunk);
                const percent = total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : 0;
                onProgress?.({ loaded, total, percent });
            }
        }
    } catch (err) {
        chunks.length = 0;
        await reader.cancel('Download failed').catch(() => {});
        throw err;
    } finally {
        signal?.removeEventListener('abort', cancelReader);
        reader.releaseLock();
    }

    if (signal?.aborted) {
        chunks.length = 0;
        throw new DOMException('Download aborted', 'AbortError');
    }

    if (loaded === 0) {
        chunks.length = 0;
        throw new Error('Received empty video stream');
    }

    if (total > 0 && loaded < total) {
        chunks.length = 0;
        throw new Error('Video stream truncated before completion');
    }

    // ISO BMFF files identify their container with the first box's type.
    // Do not save a successful JSON/HTML error page under an MP4 filename.
    const prefix = new Uint8Array(Math.min(loaded, 12));
    let offset = 0;
    for (const chunk of chunks) {
        const part = chunk.subarray(0, prefix.length - offset);
        prefix.set(part, offset); offset += part.length;
        if (offset === prefix.length) break;
    }
    const box = String.fromCharCode(...prefix.slice(4, 8));
    if (prefix.length < 8 || !['ftyp', 'styp', 'moov', 'mdat', 'free', 'wide'].includes(box)) {
        chunks.length = 0;
        throw new Error('Received invalid MP4 payload');
    }

    const blob = new Blob(chunks, { type: 'video/mp4' });
    chunks.length = 0;
    onProgress?.({ loaded, total: total || loaded, percent: 100 });
    return { blob, filename, size: loaded };
}

export function triggerBrowserFileDownload(blob: Blob, filename: string): void {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    window.setTimeout(() => {
        URL.revokeObjectURL(url);
    }, 60_000);
}

export function useEpisodeDownload() {
    const [status, setStatus] = useState<DownloadStatus>('idle');
    const [progress, setProgress] = useState<DownloadProgress>({ loaded: 0, total: 0, percent: 0 });
    const [error, setError] = useState<string | null>(null);
    const [unsupportedReason, setUnsupportedReason] = useState<string | null>(null);
    const abortControllerRef = useRef<AbortController | null>(null);
    const jobIdRef = useRef(0);

    const cancelDownload = useCallback(() => {
        jobIdRef.current++;
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            abortControllerRef.current = null;
            setStatus('cancelled');
        }
    }, []);

    const reset = useCallback(() => {
        jobIdRef.current++;
        cancelDownload();
        setStatus('idle');
        setProgress({ loaded: 0, total: 0, percent: 0 });
        setError(null);
        setUnsupportedReason(null);
    }, [cancelDownload]);

    const startDownload = useCallback(async ({
        stream,
        filename,
        fetchFn,
    }: {
        stream: { src: string; type?: string };
        filename: string;
        fetchFn?: typeof fetch;
    }) => {
        reset();
        const currentJobId = ++jobIdRef.current;

        if (isHlsStream(stream)) {
            setStatus('unsupported');
            setUnsupportedReason('HLS streams (.m3u8 playlists) are segmented media that require remuxing or transcoding to produce a single MP4 file. Direct MP4 downloading is available only for direct MP4 sources.');
            return;
        }

        if (!isDirectMp4Stream(stream)) {
            setStatus('unsupported');
            setUnsupportedReason('Provider does not offer a direct downloadable MP4 format for this selection.');
            return;
        }

        const controller = new AbortController();
        abortControllerRef.current = controller;
        setStatus('downloading');

        try {
            const result = await downloadEpisodeDirect({
                stream,
                filename,
                signal: controller.signal,
                onProgress: p => {
                    if (currentJobId === jobIdRef.current && !controller.signal.aborted) {
                        setProgress(p);
                    }
                },
                fetchFn,
            });

            if (currentJobId !== jobIdRef.current || controller.signal.aborted) return;
            triggerBrowserFileDownload(result.blob, result.filename);
            setStatus('completed');
        } catch (err: unknown) {
            if (currentJobId !== jobIdRef.current) return;
            if (controller.signal.aborted || (err instanceof DOMException && err.name === 'AbortError')) {
                setStatus('cancelled');
            } else {
                setStatus('error');
                setError(err instanceof Error ? err.message : String(err));
            }
        } finally {
            if (abortControllerRef.current === controller) {
                abortControllerRef.current = null;
            }
        }
    }, [reset]);

    useEffect(() => {
        const jobs = jobIdRef;
        return () => {
            jobs.current++;
            if (abortControllerRef.current) {
                abortControllerRef.current.abort();
                abortControllerRef.current = null;
            }
        };
    }, []);

    return {
        status,
        progress,
        error,
        unsupportedReason,
        startDownload,
        cancelDownload,
        reset,
    };
}
