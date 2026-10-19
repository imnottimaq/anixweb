import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import {
    isHlsStream,
    isDirectMp4Stream,
    sanitizeFilename,
    formatBytes,
    getDownloadStreamOptions,
    downloadEpisodeDirect,
    triggerBrowserFileDownload,
} from '../src/shared/player/download.ts';

test('isHlsStream correctly identifies HLS playlists and manifests', () => {
    assert.equal(isHlsStream({ src: 'https://cdn.example.com/stream.m3u8', type: 'application/x-mpegURL' }), true);
    assert.equal(isHlsStream({ src: 'https://cdn.example.com/playlist.m3u8?token=xyz' }), true);
    assert.equal(isHlsStream({ src: 'https://cdn.example.com/:hls:master.m3u8' }), true);
    assert.equal(isHlsStream({ src: 'https://cdn.example.com/video.mp4', type: 'video/mp4' }), false);
    assert.equal(isHlsStream({ src: 'https://cdn.example.com/signed-endpoint', type: 'application/vnd.apple.mpegurl; charset=utf-8' }), true);
    assert.equal(isHlsStream({ src: 'https://cdn.example.com/PLAYLIST.M3U8' }), true);
});

test('isDirectMp4Stream identifies genuine MP4 files and rejects HLS', () => {
    assert.equal(isDirectMp4Stream({ src: 'https://cdn.example.com/ep1.mp4', type: 'video/mp4' }), true);
    assert.equal(isDirectMp4Stream({ src: 'https://cdn.example.com/video.mp4?auth=123' }), true);
    assert.equal(isDirectMp4Stream({ src: 'https://cdn.example.com/stream.m3u8', type: 'video/mp4' }), false, 'm3u8 named mp4 must not be treated as direct mp4');
    assert.equal(isDirectMp4Stream({ src: 'https://cdn.example.com/stream.m3u8' }), false);
});

test('sanitizeFilename removes illegal filesystem characters', () => {
    assert.equal(sanitizeFilename('Attack on Titan / Shingeki: Special? *yes* <raw> | "dub"'), 'Attack on Titan _ Shingeki_ Special_ _yes_ _raw_ _ _dub_');
    assert.equal(sanitizeFilename('  Clean   Anime  Title  '), 'Clean Anime Title');
});

test('formatBytes formats file sizes correctly', () => {
    assert.equal(formatBytes(0), '0 B');
    assert.equal(formatBytes(512), '512 B');
    assert.equal(formatBytes(1024 * 500), '500 KB');
    assert.equal(formatBytes(1024 * 1024 * 25.5), '25.5 MB');
    assert.equal(formatBytes(1024 * 1024 * 1024 * 1.5), '1.5 GB');
});

test('getDownloadStreamOptions sorts qualities and identifies formats', () => {
    const sources = {
        '720': [{ src: 'https://cdn.example.com/720.mp4', type: 'video/mp4' }],
        '1080': [{ src: 'https://cdn.example.com/1080.m3u8', type: 'application/x-mpegURL' }],
        '480': [{ src: 'https://cdn.example.com/480.mp4', type: 'video/mp4' }],
    };
    const options = getDownloadStreamOptions(sources);
    assert.equal(options.length, 3);
    assert.equal(options[0].quality, '1080');
    assert.equal(options[0].isHls, true);
    assert.equal(options[0].isDirectMp4, false);

    assert.equal(options[1].quality, '720');
    assert.equal(options[1].isHls, false);
    assert.equal(options[1].isDirectMp4, true);

    assert.equal(options[2].quality, '480');
    assert.equal(options[2].isDirectMp4, true);
});

test('downloadEpisodeDirect refuses to download HLS streams as fake MP4', async () => {
    const stream = { src: 'https://cdn.example.com/stream.m3u8', type: 'application/x-mpegURL' };
    await assert.rejects(
        downloadEpisodeDirect({ stream, filename: 'test.mp4' }),
        /HLS streams cannot be saved as direct MP4/
    );
});

test('download options find MP4 alternatives behind HLS or empty entries', () => {
    const options = getDownloadStreamOptions({
        '1080': [
            {src: 'https://cdn.example.com/high.m3u8', type: 'application/x-mpegurl'},
            {src: 'https://cdn.example.com/high.mp4', type: 'video/mp4'},
        ],
        '720': [{src: '', type: 'video/mp4'}, {src: 'https://cdn.example.com/low.mp4', type: 'video/mp4'}],
        '480': [],
    });
    assert.equal(options[0].src, 'https://cdn.example.com/high.mp4');
    assert.equal(options[0].isDirectMp4, true);
    assert.equal(options[1].src, 'https://cdn.example.com/low.mp4');
    assert.equal(options[2].isDirectMp4, false);
});

test('downloadEpisodeDirect streams real MP4 bytes with progress and completes', async () => {
    const chunk1 = new Uint8Array([0, 0, 0, 8]);
    const chunk2 = new Uint8Array([102, 116, 121, 112]);
    const totalSize = 8;
    const progressReports = [];

    const mockFetch = async () => {
        const stream = new ReadableStream({
            start(controller) {
                controller.enqueue(chunk1);
                controller.enqueue(chunk2);
                controller.close();
            },
        });
        return new Response(stream, {
            status: 200,
            headers: { 'Content-Length': String(totalSize) },
        });
    };

    const result = await downloadEpisodeDirect({
        stream: { src: 'https://cdn.example.com/ep.mp4', type: 'video/mp4' },
        filename: 'episode-01.mp4',
        onProgress: p => progressReports.push({ ...p }),
        fetchFn: mockFetch,
    });

    assert.equal(result.size, 8);
    assert.equal(result.filename, 'episode-01.mp4');
    assert.equal(result.blob.type, 'video/mp4');
    assert.equal(result.blob.size, 8);

    assert.ok(progressReports.length >= 2);
    assert.equal(progressReports[0].loaded, 4);
    assert.equal(progressReports[0].percent, 50);
    assert.equal(progressReports[progressReports.length - 1].loaded, 8);
    assert.equal(progressReports[progressReports.length - 1].percent, 100);

    const buffer = await result.blob.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    assert.deepEqual(Array.from(bytes), [0, 0, 0, 8, 102, 116, 121, 112]);
});

test('downloadEpisodeDirect respects AbortSignal and cancels cleanly', async () => {
    const controller = new AbortController();
    let readerCancelled = false;

    const mockFetch = async () => {
        const stream = new ReadableStream({
            start(c) {
                c.enqueue(new Uint8Array([1, 2]));
            },
            cancel() {
                readerCancelled = true;
            },
        });
        return new Response(stream, {
            status: 200,
            headers: { 'Content-Length': '100' },
        });
    };

    const downloadPromise = downloadEpisodeDirect({
        stream: { src: 'https://cdn.example.com/ep.mp4', type: 'video/mp4' },
        filename: 'cancel-test.mp4',
        signal: controller.signal,
        onProgress: () => {
            controller.abort();
        },
        fetchFn: mockFetch,
    });

    await assert.rejects(downloadPromise, { name: 'AbortError' });
    assert.equal(readerCancelled, true, 'underlying stream reader must be cancelled on abort');
});

test('downloadEpisodeDirect rejects on HTTP error status', async () => {
    const mockFetch = async () => new Response('Not Found', { status: 404, statusText: 'Not Found' });
    await assert.rejects(
        downloadEpisodeDirect({
            stream: { src: 'https://cdn.example.com/missing.mp4', type: 'video/mp4' },
            filename: 'fail.mp4',
            fetchFn: mockFetch,
        }),
        /HTTP error 404/
    );
});

test('triggerBrowserFileDownload creates anchor and triggers browser download', () => {
    const clicks = [];
    const createdElements = [];
    const revokedUrls = [];

    const origWindow = globalThis.window;
    const origDocument = globalThis.document;
    const origUrl = globalThis.URL;

    try {
        globalThis.window = {
            setTimeout: (fn) => { fn(); return 1; },
        };
        globalThis.URL.createObjectURL = () => 'blob:http://localhost/fake-uuid';
        globalThis.URL.revokeObjectURL = (u) => revokedUrls.push(u);

        const mockBody = {
            appendChild: (el) => createdElements.push(el),
            removeChild: (el) => {
                const idx = createdElements.indexOf(el);
                if (idx !== -1) createdElements.splice(idx, 1);
            },
        };

        globalThis.document = {
            body: mockBody,
            createElement: (tag) => {
                if (tag === 'a') {
                    const el = {
                        tag: 'a',
                        href: '',
                        download: '',
                        style: {},
                        click: () => clicks.push(el.download),
                    };
                    return el;
                }
                return {};
            },
        };

        const fakeBlob = new Blob(['bytes'], { type: 'video/mp4' });
        triggerBrowserFileDownload(fakeBlob, 'test-download.mp4');

        assert.equal(clicks.length, 1);
        assert.equal(clicks[0], 'test-download.mp4');
        assert.equal(revokedUrls.length, 1);
        assert.equal(revokedUrls[0], 'blob:http://localhost/fake-uuid');
        assert.equal(createdElements.length, 0, 'anchor must be removed after click');
    } finally {
        globalThis.window = origWindow;
        globalThis.document = origDocument;
        globalThis.URL = origUrl;
    }
});

test('downloadEpisodeDirect rejects HTML error responses and empty streams', async () => {
    const htmlFetch = async () => ({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
        body: null,
        arrayBuffer: async () => new TextEncoder().encode('<html><body>Cloudflare Block</body></html>').buffer,
    });

    await assert.rejects(
        downloadEpisodeDirect({
            stream: { src: 'https://cdn.example.com/stream.mp4', type: 'video/mp4' },
            filename: 'test.mp4',
            fetchFn: htmlFetch,
        }),
        /Received HTML response/
    );

    const emptyFetch = async () => ({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'video/mp4' }),
        body: null,
        arrayBuffer: async () => new Uint8Array(0).buffer,
    });

    await assert.rejects(
        downloadEpisodeDirect({
            stream: { src: 'https://cdn.example.com/stream.mp4', type: 'video/mp4' },
            filename: 'test.mp4',
            fetchFn: emptyFetch,
        }),
        /Received empty video stream/
    );
});

const mp4Bytes = new Uint8Array([0, 0, 0, 12, 102, 116, 121, 112, 109, 112, 52, 50]);
const direct = {src:'https://cdn.example.com/video.mp4',type:'video/mp4'};

test('unknown-length downloads enforce a cap before retaining excess bytes and release the reader', async () => {
    let cancelled = false;
    const body = new ReadableStream({start(c) { c.enqueue(mp4Bytes); }, cancel() {cancelled=true;}});
    await assert.rejects(downloadEpisodeDirect({stream:direct,filename:'x.mp4',maxBytes:8,fetchFn:async () => new Response(body)}), /maximum supported limit/);
    assert.equal(cancelled,true); assert.equal(body.locked,false);
});

test('cancellation interrupts an outstanding read and releases its lock', async () => {
    const controller = new AbortController(); let cancelled = false;
    const body = new ReadableStream({cancel() {cancelled=true;}});
    const job = downloadEpisodeDirect({stream:direct,filename:'x.mp4',signal:controller.signal,fetchFn:async () => new Response(body)});
    await new Promise(done => setImmediate(done)); controller.abort();
    await assert.rejects(job,{name:'AbortError'});
    assert.equal(cancelled,true); assert.equal(body.locked,false);
});

test('HTTP 200 JSON payloads and truncated MP4 bytes cannot become saved files', async () => {
    await assert.rejects(downloadEpisodeDirect({stream:direct,filename:'x.mp4',fetchFn:async () => new Response('{"error":"denied"}')}), /invalid MP4 payload/);
    await assert.rejects(downloadEpisodeDirect({stream:direct,filename:'x.mp4',fetchFn:async () => new Response(mp4Bytes,{headers:{'content-length':'100'}})}), /truncated/);
});

test('actual download hook prevents cancelled jobs overwriting a replacement or saving a stale file', async () => {
    const source = readFileSync(new URL('../src/shared/player/download.ts',import.meta.url),'utf8');
    const ast = ts.createSourceFile('download.ts',source,ts.ScriptTarget.Latest,true);
    const hook = ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='useEpisodeDownload');
    const code = ts.transpileModule(hook.getText(ast).replace('export ',''),{compilerOptions:{target:ts.ScriptTarget.ES2023}}).outputText;
    const states = [], refs = [], saves = [], effects = []; let si=0,ri=0;
    const env = {
        useState:initial=>{const id=si++;states[id]=initial;return [initial,value=>{states[id]=value;}];},
        useRef:initial=>refs[ri++]??={current:initial}, useCallback:fn=>fn,useEffect:fn=>effects.push(fn),
        isHlsStream,isDirectMp4Stream,downloadEpisodeDirect,triggerBrowserFileDownload:(_blob,name)=>saves.push(name),
    };
    const hookResult = new Function(...Object.keys(env),code+'\nreturn useEpisodeDownload();')(...Object.values(env));
    let resolveA,resolveB;
    const first = hookResult.startDownload({stream:direct,filename:'first.mp4',fetchFn:()=>new Promise(done=>{resolveA=done;})});
    const second = hookResult.startDownload({stream:direct,filename:'second.mp4',fetchFn:()=>new Promise(done=>{resolveB=done;})});
    resolveA(new Response(mp4Bytes)); await first;
    assert.equal(states[0],'downloading'); assert.deepEqual(saves,[]);
    resolveB(new Response(mp4Bytes)); await second;
    assert.equal(states[0],'completed'); assert.deepEqual(saves,['second.mp4']);
    effects[0]()();
});

test('downloadEpisodeDirect slices chunks into genuine ArrayBuffer-backed owned buffers compatible with Blob', async () => {
    const largeBuffer = new ArrayBuffer(32);
    const view = new Uint8Array(largeBuffer, 8, 12);
    view.set([0, 0, 0, 12, 102, 116, 121, 112, 109, 112, 52, 50]);

    const mockFetch = async () => new Response(new ReadableStream({
        start(c) {
            c.enqueue(view);
            c.close();
        },
    }), { headers: { 'Content-Length': '12' } });

    const result = await downloadEpisodeDirect({
        stream: { src: 'https://cdn.example.com/video.mp4', type: 'video/mp4' },
        filename: 'owned-chunks.mp4',
        fetchFn: mockFetch,
    });

    assert.equal(result.size, 12);
    assert.ok(result.blob instanceof Blob);
    const arrayBuf = await result.blob.arrayBuffer();
    assert.ok(arrayBuf instanceof ArrayBuffer);
    assert.equal(arrayBuf.byteLength, 12);
});

