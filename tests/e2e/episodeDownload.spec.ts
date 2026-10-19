import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const segment = readFileSync(new URL('../fixtures/media/hls-segment.bin', import.meta.url));
const playlist = '#EXTM3U\n#EXT-X-TARGETDURATION:10\n#EXTINF:10,\nsegment.bin\n#EXT-X-ENDLIST\n';

test('HLS worker assembles a real playable MP4 and supports cancellation', async ({ page, context }) => {
    await context.route('**/__download_fixture__/**', async route => {
        const url = route.request().url();
        if (url.endsWith('index.m3u8')) {
            await route.fulfill({ body: playlist, contentType: 'application/vnd.apple.mpegurl' });
        } else {
            await route.fulfill({ body: segment, contentType: 'video/mp2t' });
        }
    });
    await page.goto('/');
    const result = await page.evaluate(async () => {
        const moduleUrl = '/src/shared/player/hlsDownloadClient.ts';
        const { downloadHlsInWorker } = await import(moduleUrl);
        const progress: number[] = [];
        const result = await downloadHlsInWorker({
            stream: { src: new URL('/__download_fixture__/index.m3u8', location.origin).href },
            filename: 'episode.mp4', onProgress: (p: { percent: number }) => progress.push(p.percent),
        });
        const video = document.createElement('video');
        video.muted = true;
        video.src = URL.createObjectURL(result.blob);
        document.body.append(video);
        try {
            await new Promise<void>((resolve, reject) => {
                video.onloadedmetadata = () => resolve();
                video.onerror = () => reject(new Error(`MP4 decode error ${video.error?.code}`));
            });
            await video.play();
            await new Promise<void>((resolve, reject) => {
                video.ontimeupdate = () => { if (video.currentTime > 0.05) resolve(); };
                video.onerror = () => reject(new Error('MP4 playback failed'));
            });
            return { duration: video.duration, width: video.videoWidth, currentTime: video.currentTime, size: result.size, progress };
        } finally {
            video.pause(); URL.revokeObjectURL(video.src); video.remove();
        }
    });
    expect(result.duration).toBeGreaterThan(0);
    expect(result.width).toBeGreaterThan(0);
    expect(result.currentTime).toBeGreaterThan(0.05);
    expect(result.progress.at(-1)).toBe(100);

    await context.route('**/__download_fixture__/pending.m3u8', () => {});
    const cancelled = await page.evaluate(async () => {
        const moduleUrl = '/src/shared/player/hlsDownloadClient.ts';
        const { downloadHlsInWorker } = await import(moduleUrl);
        const controller = new AbortController();
        const pending = downloadHlsInWorker({ stream: { src: new URL('/__download_fixture__/pending.m3u8', location.origin).href }, filename: 'cancel.mp4', signal: controller.signal });
        setTimeout(() => controller.abort(), 100);
        try { await pending; return 'saved'; }
        catch (error) { return error instanceof DOMException ? error.name : String(error); }
    });
    expect(cancelled).toBe('AbortError');
});
