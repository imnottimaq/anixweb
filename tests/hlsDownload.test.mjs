import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { downloadEpisodeHls } from '../src/shared/player/hlsDownload.ts';

const tsSegment = readFileSync(new URL('./fixtures/media/hls-segment.bin', import.meta.url));
const playlist = (extra = '', end = '#EXT-X-ENDLIST') => `#EXTM3U\n#EXT-X-TARGETDURATION:10\n${extra}\n#EXTINF:10,\nsegment.bin\n${end}\n`;
const options = { stream: { src: 'https://media.example/episode/index.m3u8' }, filename: 'episode.mp4' };
const fixtureFetch = async url => new Response(url.endsWith('.m3u8') ? playlist() : tsSegment);

test('real MPEG-TS audio and video are remuxed into an MP4 with progress', async () => {
    const progress = [];
    const result = await downloadEpisodeHls({ ...options, fetchFn: fixtureFetch, onProgress: p => progress.push(p) });
    const bytes = new Uint8Array(await result.blob.arrayBuffer());
    assert.equal(String.fromCharCode(...bytes.slice(4, 8)), 'ftyp');
    const boxes = Buffer.from(bytes).toString('latin1');
    for (const box of ['moov', 'moof', 'mdat', 'avc1', 'mp4a']) assert.ok(boxes.includes(box), box);
    assert.equal(result.size, bytes.length);
    assert.equal(result.blob.type, 'video/mp4');
    assert.equal(progress.at(-1).percent, 100);
    assert.equal(progress.at(-1).completedSegments, 1);
});

test('master variants resolve relative to the redirected playlist URL', async () => {
    const requests = [];
    const result = await downloadEpisodeHls({ ...options, fetchFn: async url => {
        requests.push(url);
        if (requests.length === 1) {
            const response = new Response('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=100,RESOLUTION=640x360\nlow/list.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=200,RESOLUTION=1280x720\nhigh/list.m3u8');
            Object.defineProperty(response, 'url', { value: 'https://cdn.example/new/master.m3u8' });
            return response;
        }
        return fixtureFetch(url);
    } });
    assert.ok(result.size > 0);
    assert.deepEqual(requests.slice(1), ['https://cdn.example/new/high/list.m3u8', 'https://cdn.example/new/high/segment.bin']);
});

for (const [name, manifest, error] of [
    ['live', playlist('', ''), /live/],
    ['encryption', playlist('#EXT-X-KEY:METHOD=AES-128,URI="key"'), /Encrypted/],
    ['discontinuities', playlist('#EXT-X-DISCONTINUITY'), /discontinuities/],
    ['separate audio', '#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="en",URI="audio.m3u8"\n#EXT-X-STREAM-INF:BANDWIDTH=100,AUDIO="audio"\nvideo.m3u8', /separate audio/],
    ['HTML', '<html>Denied</html>', /Invalid HLS/],
]) test(`rejects ${name} before downloading any media`, async () => {
    let calls = 0;
    await assert.rejects(downloadEpisodeHls({ ...options, fetchFn: async () => { calls++; return new Response(manifest); } }), error);
    assert.equal(calls, 1);
});

test('invalid payload and memory limit errors cannot produce a completed download', async () => {
    await assert.rejects(downloadEpisodeHls({ ...options, fetchFn: async url => new Response(url.endsWith('.m3u8') ? playlist() : '<html>Denied</html>') }), /expected MPEG-TS/);
    await assert.rejects(downloadEpisodeHls({ ...options, fetchFn: fixtureFetch, maxBytes: 1024 }), /memory limit/);
});

test('master playlists honor the selected download quality', async () => {
    const requests = [];
    await downloadEpisodeHls({ ...options, stream: { ...options.stream, quality: '360' }, fetchFn: async url => {
        requests.push(url);
        if (requests.length === 1) return new Response('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=100,RESOLUTION=640x360\nlow/index.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=200,RESOLUTION=1280x720\nhigh/index.m3u8');
        return fixtureFetch(url);
    } });
    assert.ok(requests[1].includes('/low/'));
});

test('abort interrupts a pending segment reader and releases its lock', async () => {
    const controller = new AbortController();
    let cancelled = false;
    const body = new ReadableStream({ cancel() { cancelled = true; } });
    const pending = downloadEpisodeHls({ ...options, signal: controller.signal, fetchFn: async url =>
        new Response(url.endsWith('.m3u8') ? playlist() : body) });
    await new Promise(resolve => setImmediate(resolve));
    controller.abort();
    await assert.rejects(pending, { name: 'AbortError' });
    assert.equal(cancelled, true);
    assert.equal(body.locked, false);
});

test('fMP4 uses its initialization once and validates byte-range responses', async () => {
    const mp4 = new Uint8Array(await (await downloadEpisodeHls({ ...options, fetchFn: fixtureFetch })).blob.arrayBuffer());
    let offset = 0;
    while (String.fromCharCode(...mp4.slice(offset + 4, offset + 8)) !== 'moof') {
        offset += new DataView(mp4.buffer).getUint32(offset);
        assert.ok(offset < mp4.length);
    }
    const init = mp4.slice(0, offset), fragment = mp4.slice(offset);
    const manifest = playlist(`#EXT-X-MAP:URI="init.mp4",BYTERANGE="${init.length}@0"`);
    const fetchFn = async url => {
        if (url.endsWith('.m3u8')) return new Response(manifest);
        if (url.endsWith('init.mp4')) return new Response(init, { status: 206, headers: { 'content-range': `bytes 0-${init.length - 1}/${init.length}` } });
        return new Response(fragment);
    };
    const result = await downloadEpisodeHls({ ...options, fetchFn });
    assert.deepEqual(new Uint8Array(await result.blob.arrayBuffer()), mp4);
    await assert.rejects(downloadEpisodeHls({ ...options, fetchFn: async url => url.endsWith('init.mp4') ? new Response(init) : fetchFn(url) }), /byte range/);
});

test('circular playlists and HTTP failures stop without returning a file', async () => {
    await assert.rejects(downloadEpisodeHls({ ...options, fetchFn: async () => new Response('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nindex.m3u8') }), /Circular/);
    await assert.rejects(downloadEpisodeHls({ ...options, fetchFn: async () => new Response('No', { status: 503 }) }), /HTTP 503/);
});

test('concurrent segment fetches download out-of-order but assemble in correct sequential order', async () => {
    const multiSegmentPlaylist = `#EXTM3U\n#EXT-X-TARGETDURATION:10\n#EXTINF:10,\nseg0.bin\n#EXTINF:10,\nseg1.bin\n#EXTINF:10,\nseg2.bin\n#EXT-X-ENDLIST\n`;
    const requestedUrls = [];
    let resolveSeg0;
    const seg0Promise = new Promise(r => { resolveSeg0 = r; });

    const fetchFn = async (url) => {
        if (url.endsWith('.m3u8')) return new Response(multiSegmentPlaylist);
        requestedUrls.push(url);
        if (url.endsWith('seg0.bin')) {
            await seg0Promise;
            return new Response(tsSegment);
        }
        return new Response(tsSegment);
    };

    const progressList = [];
    const downloadPromise = downloadEpisodeHls({
        ...options,
        fetchFn,
        concurrency: 3,
        onProgress: p => progressList.push({ ...p }),
    });

    for (let i = 0; i < 50; i++) {
        if (requestedUrls.includes('https://media.example/episode/seg1.bin')) break;
        await new Promise(r => setImmediate(r));
    }
    assert.ok(requestedUrls.includes('https://media.example/episode/seg0.bin'));
    assert.ok(requestedUrls.includes('https://media.example/episode/seg1.bin'));
    assert.equal(progressList.length, 0);

    resolveSeg0();

    const result = await downloadPromise;
    assert.equal(result.blob.type, 'video/mp4');
    assert.ok(result.size > 0);
    assert.equal(progressList.at(-1).completedSegments, 3);
    assert.equal(progressList.at(-1).percent, 100);
});

test('concurrency adheres to sliding lookahead window and avoids unbound buffer growth', async () => {
    const manySegmentsPlaylist = `#EXTM3U\n#EXT-X-TARGETDURATION:10\n` +
        Array.from({ length: 15 }, (_, i) => `#EXTINF:10,\nseg${i}.bin\n`).join('') +
        `#EXT-X-ENDLIST\n`;

    const allRequested = [];
    let resolveSeg0;
    const seg0Promise = new Promise(r => { resolveSeg0 = r; });

    const fetchFn = async (url) => {
        if (url.endsWith('.m3u8')) return new Response(manySegmentsPlaylist);
        allRequested.push(url);
        if (url.endsWith('seg0.bin')) {
            await seg0Promise;
            return new Response(tsSegment);
        }
        return new Response(tsSegment);
    };

    const downloadPromise = downloadEpisodeHls({
        ...options,
        fetchFn,
        concurrency: 3,
    });

    for (let i = 0; i < 50; i++) {
        if (allRequested.length >= 6) break;
        await new Promise(r => setImmediate(r));
    }

    assert.ok(allRequested.length <= 6, `Issued ${allRequested.length} requests, expected at most 6 due to lookahead`);
    assert.ok(!allRequested.some(u => u.includes('seg7.bin')), 'seg7 should not be fetched before seg0 resolves');

    resolveSeg0();
    const result = await downloadPromise;
    assert.ok(result.size > 0);
});

test('failure in one concurrent segment aborts all active fetches', async () => {
    const playlist3 = `#EXTM3U\n#EXT-X-TARGETDURATION:10\n#EXTINF:10,\nseg0.bin\n#EXTINF:10,\nseg1.bin\n#EXT-X-ENDLIST\n`;
    let seg1Cancelled = false;
    const seg1Body = new ReadableStream({
        cancel() { seg1Cancelled = true; },
    });

    const fetchFn = async (url) => {
        if (url.endsWith('.m3u8')) return new Response(playlist3);
        if (url.endsWith('seg0.bin')) {
            return new Response('Server Error', { status: 500 });
        }
        return new Response(seg1Body);
    };

    await assert.rejects(downloadEpisodeHls({ ...options, fetchFn, concurrency: 2 }), /HTTP 500/);
    assert.equal(seg1Cancelled, true);
});

