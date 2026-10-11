import test from 'node:test';
import assert from 'node:assert/strict';
import {
    SibnetParser,
    VKVideoParser,
    OKParser,
    RutubeParser,
    KodikParser,
    extractVideoLinks,
    getUpstreamUrl,
    resolvePlaylistEntry,
} from '../src/utils/LinkParser.ts';

// Helper to construct mock Response with custom url and headers
function createMockResponse(body, init = {}) {
    const status = init.status ?? 200;
    const ok = status >= 200 && status < 300;
    const headers = new Headers(init.headers ?? {});
    const respUrl = init.url ?? 'http://localhost:8787/corsproxy?url=mock';

    return {
        status,
        statusText: init.statusText ?? (ok ? 'OK' : 'Error'),
        ok,
        url: respUrl,
        headers,
        text: async () => String(body),
        json: async () => JSON.parse(String(body)),
    };
}

test('getUpstreamUrl: extracts X-Upstream-URL header or falls back to target URL', () => {
    const resWithHeader = createMockResponse('ok', {
        headers: { 'x-upstream-url': 'https://dv.sibnet.ru/v/final.mp4' },
        url: 'http://localhost:8787/corsproxy?url=target',
    });
    assert.equal(getUpstreamUrl(resWithHeader, 'https://video.sibnet.ru/shell.php'), 'https://dv.sibnet.ru/v/final.mp4');

    const resWithoutHeader = createMockResponse('ok', {
        url: 'http://localhost:8787/corsproxy?url=target',
    });
    assert.equal(getUpstreamUrl(resWithoutHeader, 'https://video.sibnet.ru/shell.php'), 'https://video.sibnet.ru/shell.php');
});

test('resolvePlaylistEntry: correctly resolves relative and absolute playlist URLs against upstream CDN', () => {
    const baseCdn = 'https://vkvd123.vkuservideo.net/hls/master.m3u8';

    // Relative without leading slash
    assert.equal(
        resolvePlaylistEntry('index-720.m3u8', baseCdn),
        'https://vkvd123.vkuservideo.net/hls/index-720.m3u8'
    );

    // Relative with leading slash
    assert.equal(
        resolvePlaylistEntry('/streams/720/index.m3u8', baseCdn),
        'https://vkvd123.vkuservideo.net/streams/720/index.m3u8'
    );

    // Absolute URL
    assert.equal(
        resolvePlaylistEntry('https://cdn2.vkuservideo.net/files/720.m3u8', baseCdn),
        'https://cdn2.vkuservideo.net/files/720.m3u8'
    );
});

test('SibnetParser: returns upstream CDN video URL from redirect, not Worker proxy origin', async () => {
    const originalFetch = globalThis.fetch;
    const requestedUrls = [];

    globalThis.fetch = async (input, init) => {
        const urlStr = String(input);
        requestedUrls.push({ url: urlStr, init });

        if (urlStr.includes('video.sibnet.ru%2Fshell.php')) {
            // First request for embed shell returns HTML containing videofile path
            return createMockResponse('<html><body>src: "/shell/php/videofile.php?mid=45678"</body></html>', {
                status: 200,
                url: 'http://localhost:8787/corsproxy?url=https%3A%2F%2Fvideo.sibnet.ru%2Fshell.php%3Fvideoid%3D123',
                headers: { 'x-upstream-url': 'https://video.sibnet.ru/shell.php?videoid=123' },
            });
        }

        if (urlStr.includes('videofile.php')) {
            // Second request to videofile.php followed 302 redirect on proxy to dv.sibnet.ru CDN
            return createMockResponse('', {
                status: 200,
                // Worker proxy origin:
                url: 'http://localhost:8787/corsproxy?url=https%3A%2F%2Fvideo.sibnet.ru%2Fshell%2Fphp%2Fvideofile.php%3Fmid%3D45678',
                // Validated upstream header pointing to final CDN destination:
                headers: { 'x-upstream-url': 'https://dv.sibnet.ru/v/45678_resolved.mp4' },
            });
        }

        return createMockResponse('not found', { status: 404 });
    };

    try {
        const directLink = await SibnetParser.getDirectLink('https://video.sibnet.ru/shell.php?videoid=123');
        assert.equal(directLink, 'https://dv.sibnet.ru/v/45678_resolved.mp4');
        assert.ok(!directLink.includes('localhost'), 'Must not point to local proxy');
        assert.ok(!directLink.includes('corsproxy'), 'Must not point to corsproxy URL');
        assert.ok(!directLink.includes('videofile.php'), 'Must not point to shell PHP URL');

        // Test through extractVideoLinks
        const extracted = await extractVideoLinks('https://video.sibnet.ru/shell.php?videoid=123');
        assert.ok(extracted);
        assert.equal(extracted.default?.[0]?.src, 'https://dv.sibnet.ru/v/45678_resolved.mp4');
        assert.equal(extracted.default?.[0]?.type, 'video/mp4');
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('VKVideoParser: resolves relative and absolute playlist URLs to upstream CDN, not Worker origin', async () => {
    const originalFetch = globalThis.fetch;

    globalThis.fetch = async (input) => {
        const urlStr = String(input);

        if (urlStr.includes('oauth.vk.com')) {
            return createMockResponse(JSON.stringify({ token: 'mock-vk-token', expires_at: 9999999999 }), {
                headers: { 'Content-Type': 'application/json' },
            });
        }

        if (urlStr.includes('api.vk.com%2Fmethod%2Fvideo.get')) {
            return createMockResponse(JSON.stringify({
                response: {
                    items: [{
                        files: {
                            hls: 'https://vkvd99.vkuservideo.net/hls/master.m3u8?extra=1',
                        },
                    }],
                },
            }), {
                headers: { 'Content-Type': 'application/json' },
            });
        }

        if (urlStr.includes('vkvd99.vkuservideo.net')) {
            const masterM3u8 = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360
index-360.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=1500000,RESOLUTION=1280x720
/custom/path/index-720.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1920x1080
https://cdn-direct.vkuservideo.net/streams/index-1080.m3u8
`;
            return createMockResponse(masterM3u8, {
                status: 200,
                url: 'http://localhost:8787/corsproxy?url=https%3A%2F%2Fvkvd99.vkuservideo.net%2Fhls%2Fmaster.m3u8',
                headers: {
                    'Content-Type': 'application/vnd.apple.mpegurl',
                    'x-upstream-url': 'https://vkvd99.vkuservideo.net/hls/master.m3u8?extra=1',
                },
            });
        }

        return createMockResponse('not found', { status: 404 });
    };

    try {
        const links = await VKVideoParser.getDirectLinks('https://vk.com/video_ext.php?oid=123&id=456&hash=abcdef');
        assert.ok(links);

        // Relative path without slash
        assert.equal(links['360'], 'https://vkvd99.vkuservideo.net/hls/index-360.m3u8');
        // Relative path with slash
        assert.equal(links['720'], 'https://vkvd99.vkuservideo.net/custom/path/index-720.m3u8');
        // Absolute path
        assert.equal(links['1080'], 'https://cdn-direct.vkuservideo.net/streams/index-1080.m3u8');

        for (const [quality, streamUrl] of Object.entries(links)) {
            assert.ok(!streamUrl.includes('localhost'), `Quality ${quality} must not point to proxy origin`);
            assert.ok(!streamUrl.includes('corsproxy'), `Quality ${quality} must not point to corsproxy`);
            assert.ok(streamUrl.includes('vkuservideo.net'), `Quality ${quality} must point to CDN host`);
        }
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('OKParser: resolves relative and absolute playlist URLs to upstream CDN, not Worker origin', async () => {
    const originalFetch = globalThis.fetch;

    globalThis.fetch = async (input) => {
        const urlStr = String(input);

        if (urlStr.includes('ok.ru%2Fvideo')) {
            const metadata = JSON.stringify({
                provider: 'UPLOADED_ODKL',
                isLive: false,
                hlsManifestUrl: 'https://vd50.mycdn.me/video/manifest.m3u8',
            });
            const dataOptions = JSON.stringify({
                flashvars: { metadata },
            });
            const html = `<html><body><div data-options="${dataOptions.replace(/"/g, '&quot;')}"></div></body></html>`;
            return createMockResponse(html, {
                status: 200,
                headers: { 'Content-Type': 'text/html' },
            });
        }

        if (urlStr.includes('vd50.mycdn.me')) {
            const masterM3u8 = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=1000000,RESOLUTION=854x480
480.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1280x720
/cdn/720.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080
https://vd50-alt.mycdn.me/hls/1080.m3u8
`;
            return createMockResponse(masterM3u8, {
                status: 200,
                url: 'http://localhost:8787/corsproxy?url=https%3A%2F%2Fvd50.mycdn.me%2Fvideo%2Fmanifest.m3u8',
                headers: {
                    'Content-Type': 'application/vnd.apple.mpegurl',
                    'x-upstream-url': 'https://vd50.mycdn.me/video/manifest.m3u8',
                },
            });
        }

        return createMockResponse('not found', { status: 404 });
    };

    try {
        const links = await OKParser.getDirectLinks('https://ok.ru/video/777888');
        assert.ok(links);

        assert.equal(links['480'], 'https://vd50.mycdn.me/video/480.m3u8');
        assert.equal(links['720'], 'https://vd50.mycdn.me/cdn/720.m3u8');
        assert.equal(links['1080'], 'https://vd50-alt.mycdn.me/hls/1080.m3u8');

        for (const [quality, streamUrl] of Object.entries(links)) {
            assert.ok(!streamUrl.includes('localhost'), `Quality ${quality} must not point to proxy origin`);
            assert.ok(!streamUrl.includes('corsproxy'), `Quality ${quality} must not point to corsproxy`);
            assert.ok(streamUrl.includes('mycdn.me'), `Quality ${quality} must point to CDN host`);
        }
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('HTTP errors: parsers check response.ok and do not proceed on error statuses', async () => {
    const originalFetch = globalThis.fetch;

    globalThis.fetch = async () => {
        return createMockResponse('Upstream error', {
            status: 502,
            statusText: 'Bad Gateway',
            headers: { 'Content-Type': 'application/json' },
        });
    };

    try {
        const sibnet = await SibnetParser.getDirectLink('https://video.sibnet.ru/shell.php?videoid=123');
        assert.equal(sibnet, null);

        const vk = await VKVideoParser.getDirectLinks('https://vk.com/video_ext.php?oid=1&id=2&hash=3');
        assert.equal(vk, null);

        const ok = await OKParser.getDirectLinks('https://ok.ru/video/123');
        assert.equal(ok, null);

        const rutube = await RutubeParser.getDirectLinks('https://rutube.ru/play/embed/123');
        assert.equal(rutube, null);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('Host validation: parsers reject unsupported hosts with actionable errors', async () => {
    await assert.rejects(
        () => SibnetParser.getDirectLink('https://evil.example.com/video'),
        err => err.message.includes('Unsupported host') && err.message.includes('SibnetParser')
    );

    await assert.rejects(
        () => VKVideoParser.getDirectLinks('https://evil.example.com/video?oid=1&id=2&hash=3'),
        err => err.message.includes('Unsupported host') && err.message.includes('VKVideoParser')
    );

    await assert.rejects(
        () => OKParser.getDirectLinks('https://evil.example.com/video/123'),
        err => err.message.includes('Unsupported host') && err.message.includes('OKParser')
    );

    await assert.rejects(
        () => RutubeParser.getDirectLinks('https://evil.example.com/video'),
        err => err.message.includes('Unsupported host') && err.message.includes('RutubeParser')
    );

    await assert.rejects(
        () => KodikParser.getDirectLinks('https://evil.example.com/video'),
        err => err.message.includes('Unsupported host') && err.message.includes('KodikParser')
    );
});
