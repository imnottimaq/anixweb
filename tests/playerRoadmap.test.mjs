import assert from 'node:assert/strict';
import test from 'node:test';
import {
    isHlsStream,
    isDirectMp4Stream,
    sanitizeFilename,
    getDownloadStreamOptions,
    downloadEpisodeDirect,
} from '../src/shared/player/download.ts';

// Fullscreen and focus behavior execute actual PlayerContent in player.test.mjs.

test('episode downloading: strictly prohibits fake .mp4 from .m3u8 HLS playlist', async () => {
    const fakeStream = {
        src: 'https://video.provider.com/manifest/master.m3u8?token=secure',
        type: 'application/x-mpegURL',
    };

    assert.equal(isHlsStream(fakeStream), true);
    assert.equal(isDirectMp4Stream(fakeStream), false);

    await assert.rejects(
        downloadEpisodeDirect({
            stream: fakeStream,
            filename: 'fake-download.mp4',
        }),
        /HLS streams cannot be saved as direct MP4/,
        'Renaming m3u8 playlist text to .mp4 is strictly forbidden'
    );
});

test('episode downloading: downloads real MP4 chunks, reports progress and cleans up', async () => {
    const chunkA = new Uint8Array([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]); // mp4 ftyp header
    const chunkB = new Uint8Array([0x6D, 0x70, 0x34, 0x32, 0x00, 0x00, 0x00, 0x00]);
    const progressList = [];

    const mockFetch = async () => {
        const stream = new ReadableStream({
            start(c) {
                c.enqueue(chunkA);
                c.enqueue(chunkB);
                c.close();
            },
        });
        return new Response(stream, {
            status: 200,
            headers: { 'Content-Length': '16' },
        });
    };

    const result = await downloadEpisodeDirect({
        stream: { src: 'https://cdn.example.com/anime-ep1.mp4', type: 'video/mp4' },
        filename: 'Naruto - Ep 1 (1080p).mp4',
        onProgress: p => progressList.push(p.percent),
        fetchFn: mockFetch,
    });

    assert.equal(result.size, 16);
    assert.equal(result.blob.type, 'video/mp4');
    assert.equal(result.filename, 'Naruto - Ep 1 (1080p).mp4');
    assert.ok(progressList.includes(100));

    const bytes = new Uint8Array(await result.blob.arrayBuffer());
    assert.equal(bytes.length, 16);
    assert.equal(bytes[0], 0x00);
    assert.equal(bytes[4], 0x66); // 'f'
});

test('episode downloading: abort signal terminates reader and prevents partial file leak', async () => {
    const controller = new AbortController();
    let readerCancelled = false;

    const mockFetch = async () => {
        const stream = new ReadableStream({
            start(c) {
                c.enqueue(new Uint8Array([1, 2, 3]));
            },
            cancel() {
                readerCancelled = true;
            },
        });
        return new Response(stream, {
            status: 200,
            headers: { 'Content-Length': '1024' },
        });
    };

    const task = downloadEpisodeDirect({
        stream: { src: 'https://cdn.example.com/test.mp4', type: 'video/mp4' },
        filename: 'cancel.mp4',
        signal: controller.signal,
        onProgress: () => {
            controller.abort();
        },
        fetchFn: mockFetch,
    });

    await assert.rejects(task, { name: 'AbortError' });
    assert.equal(readerCancelled, true);
});

test('episode downloading: sanitizeFilename strips forbidden filesystem symbols', () => {
    const raw = 'Frieren: Beyond Journey\'s End / Episode 28? [1080p] *final* <raw> | "sub"';
    const clean = sanitizeFilename(raw);
    assert.ok(!clean.includes(':'));
    assert.ok(!clean.includes('/'));
    assert.ok(!clean.includes('?'));
    assert.ok(!clean.includes('*'));
    assert.ok(!clean.includes('<'));
    assert.ok(!clean.includes('>'));
    assert.ok(!clean.includes('|'));
    assert.ok(!clean.includes('"'));
});

test('getDownloadStreamOptions differentiates direct MP4 and provider-limited HLS', () => {
    const sources = {
        '1080': [{ src: 'https://cdn.example.com/master.m3u8', type: 'application/x-mpegURL' }],
        '720': [{ src: 'https://cdn.example.com/video720.mp4', type: 'video/mp4' }],
        '480': [{ src: 'https://cdn.example.com/video480.mp4', type: 'video/mp4' }],
    };

    const options = getDownloadStreamOptions(sources);
    assert.equal(options.length, 3);
    assert.equal(options[0].quality, '1080');
    assert.equal(options[0].isDirectMp4, false);
    assert.equal(options[0].isHls, true);

    assert.equal(options[1].quality, '720');
    assert.equal(options[1].isDirectMp4, true);
    assert.equal(options[1].isHls, false);
});
