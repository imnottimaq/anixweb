import type { DownloadOptions, DownloadProgress, DownloadResult } from './download.ts';

type WorkerResponse =
    | { type: 'progress'; progress: DownloadProgress }
    | { type: 'complete'; result: DownloadResult }
    | { type: 'error'; message: string };

export function downloadHlsInWorker({ stream, filename, maxBytes, signal, onProgress }: DownloadOptions): Promise<DownloadResult> {
    signal?.throwIfAborted();
    return new Promise((resolve, reject) => {
        const worker = new Worker(new URL('./hlsDownload.worker.ts', import.meta.url), { type: 'module' });
        const cleanup = () => {
            signal?.removeEventListener('abort', abort);
            worker.terminate();
        };
        const abort = () => { cleanup(); reject(new DOMException('Download aborted', 'AbortError')); };
        signal?.addEventListener('abort', abort, { once: true });
        worker.onerror = () => { cleanup(); reject(new Error('HLS download worker failed')); };
        worker.onmessage = ({ data }: MessageEvent<WorkerResponse>) => {
            if (data.type === 'progress') onProgress?.(data.progress);
            else {
                cleanup();
                if (data.type === 'complete') resolve(data.result);
                else reject(new Error(data.message));
            }
        };
        worker.postMessage({ stream, filename, maxBytes });
    });
}
