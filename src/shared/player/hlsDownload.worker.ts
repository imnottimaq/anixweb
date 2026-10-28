import { downloadEpisodeHls } from './hlsDownload.ts';
import type { DownloadOptions } from './download.ts';

self.onmessage = async (event: MessageEvent<Pick<DownloadOptions, 'stream' | 'filename' | 'maxBytes' | 'concurrency'>>) => {
    try {
        const result = await downloadEpisodeHls({
            ...event.data,
            onProgress: progress => self.postMessage({ type: 'progress', progress }),
        });
        self.postMessage({ type: 'complete', result });
    } catch (error) {
        self.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) });
    }
};
