import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, rmSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import {
    DEFAULT_PROXY_SERVER_URL,
    DEFAULT_MEDIA_PROXY_URL,
    SERVER_PROXY_ALLOWLIST,
    normalizeTrailingSlashes,
    getProxyServerUrl,
    getMediaProxyUrl,
    cleanTargetUrl,
    isAllowedServerProxyHost,
    getAgentProxyUrl,
    getCorsProxyUrl,
} from '../src/shared/proxy.ts';
import {
    getApiUrl,
    apiGetViaAgent,
    apiPostViaAgent,
    apiPostFormViaAgent,
} from '../src/shared/apiClient.ts';

// Extract CorsFallbackFragmentLoader from PlayerScreen.tsx
const playerSource = readFileSync(new URL('../src/pages/PlayerScreen.tsx', import.meta.url), 'utf8');
const playerAst = ts.createSourceFile('PlayerScreen.tsx', playerSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const loaderClassNode = playerAst.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'CorsFallbackFragmentLoader');
const loaderCode = ts.transpileModule(loaderClassNode.getText(playerAst), { compilerOptions: { target: ts.ScriptTarget.ES2023 } }).outputText;

function createLoaderHarness() {
    const loads = [];
    class MockXhrLoader {
        load(context, config, callbacks) {
            loads.push({ context, config, callbacks });
        }
    }
    const LoaderClass = new Function('XhrLoader', 'getCorsProxyUrl', loaderCode + '\nreturn CorsFallbackFragmentLoader;')(MockXhrLoader, getCorsProxyUrl);
    return { loader: new LoaderClass(), loads };
}

// Extract postAnonymousForm and uploadAvatarRequest from EditAccountScreen.tsx
const editAccountSource = readFileSync(new URL('../src/pages/EditAccountScreen.tsx', import.meta.url), 'utf8');
const editAccountAst = ts.createSourceFile('EditAccountScreen.tsx', editAccountSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const postAnonNode = editAccountAst.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'postAnonymousForm');
const uploadAvatarNode = editAccountAst.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'uploadAvatarRequest');

const postAnonCode = ts.transpileModule(postAnonNode.getText(editAccountAst), { compilerOptions: { target: ts.ScriptTarget.ES2023 } }).outputText;
const uploadAvatarCode = ts.transpileModule(uploadAvatarNode.getText(editAccountAst), { compilerOptions: { target: ts.ScriptTarget.ES2023 } }).outputText;

function getEditAccountHelpers(fetchImpl) {
    const fn = new Function('fetch', 'getAgentProxyUrl', `${postAnonCode}\n${uploadAvatarCode}\nreturn { postAnonymousForm, uploadAvatarRequest };`);
    return fn(fetchImpl, getAgentProxyUrl);
}

test('base URLs and trailing slashes normalization', () => {
    const originalProxy = process.env.VITE_PROXY_SERVER_URL;
    const originalRoom = process.env.VITE_ROOM_SERVER_URL;
    const originalMedia = process.env.VITE_MEDIA_PROXY_URL;

    try {
        // Defaults
        delete process.env.VITE_PROXY_SERVER_URL;
        delete process.env.VITE_ROOM_SERVER_URL;
        delete process.env.VITE_MEDIA_PROXY_URL;
        assert.equal(getProxyServerUrl(), DEFAULT_PROXY_SERVER_URL);
        assert.equal(getMediaProxyUrl(), DEFAULT_MEDIA_PROXY_URL);
        assert.equal(normalizeTrailingSlashes('http://test///'), 'http://test');
        assert.ok(SERVER_PROXY_ALLOWLIST.has('kodikplayer.com'));
        assert.equal(getApiUrl('/test', 'token1'), 'https://api-s.anixsekai.com/test?token=token1');

        // Fallback to VITE_ROOM_SERVER_URL when VITE_PROXY_SERVER_URL is unset
        process.env.VITE_ROOM_SERVER_URL = 'http://room-server:8787/';
        assert.equal(getProxyServerUrl(), 'http://room-server:8787');
        assert.equal(getMediaProxyUrl(), 'http://room-server:8787');

        // Multiple trailing slashes
        process.env.VITE_ROOM_SERVER_URL = 'http://room-server:8787///';
        assert.equal(getProxyServerUrl(), 'http://room-server:8787');
        assert.equal(getMediaProxyUrl(), 'http://room-server:8787');

        // Explicit VITE_PROXY_SERVER_URL overrides VITE_ROOM_SERVER_URL
        process.env.VITE_PROXY_SERVER_URL = 'http://proxy-server:9000//';
        assert.equal(getProxyServerUrl(), 'http://proxy-server:9000');
        assert.equal(getMediaProxyUrl(), 'http://proxy-server:9000');

        // Media proxy trailing slashes
        process.env.VITE_MEDIA_PROXY_URL = 'https://custom-media.example.com///';
        assert.equal(getMediaProxyUrl(), 'https://custom-media.example.com');
    } finally {
        if (originalProxy !== undefined) process.env.VITE_PROXY_SERVER_URL = originalProxy; else delete process.env.VITE_PROXY_SERVER_URL;
        if (originalRoom !== undefined) process.env.VITE_ROOM_SERVER_URL = originalRoom; else delete process.env.VITE_ROOM_SERVER_URL;
        if (originalMedia !== undefined) process.env.VITE_MEDIA_PROXY_URL = originalMedia; else delete process.env.VITE_MEDIA_PROXY_URL;
    }
});

test('proxy helpers safely fall back to default URLs without throwing when process is undefined', () => {
    const originalProcess = globalThis.process;
    try {
        globalThis.process = undefined;
        assert.equal(getProxyServerUrl(), DEFAULT_PROXY_SERVER_URL);
        assert.equal(getMediaProxyUrl(), DEFAULT_MEDIA_PROXY_URL);
        assert.equal(getAgentProxyUrl('https://api-s.anixsekai.com/test'), `${DEFAULT_PROXY_SERVER_URL}/agentproxy?url=https%3A%2F%2Fapi-s.anixsekai.com%2Ftest`);
        assert.equal(getCorsProxyUrl('https://kodikplayer.com/ftor'), `${DEFAULT_PROXY_SERVER_URL}/corsproxy?url=https%3A%2F%2Fkodikplayer.com%2Fftor`);
    } finally {
        globalThis.process = originalProcess;
    }
});

test('double encoding prevention', () => {
    const target = 'https://api-s.anixsekai.com/profile/123?token=abc%20def';
    const proxyUrl = getAgentProxyUrl(target);
    assert.ok(proxyUrl.includes('url=https%3A%2F%2Fapi-s.anixsekai.com%2Fprofile%2F123'));
    assert.ok(!proxyUrl.includes('%253A'), 'No double encoded scheme');
    assert.ok(!proxyUrl.includes('%252F'), 'No double encoded slashes');

    // Passing already percent-encoded scheme does not double encode
    const preEncoded = 'https%3A%2F%2Fapi-s.anixsekai.com%2Fprofile%2F123';
    const cleanUrl = cleanTargetUrl(preEncoded);
    assert.equal(cleanUrl, 'https://api-s.anixsekai.com/profile/123');

    const proxyFromPreEncoded = getAgentProxyUrl(preEncoded);
    assert.ok(!proxyFromPreEncoded.includes('%253A'));
    assert.ok(!proxyFromPreEncoded.includes('%252F'));

    const corsFromPreEncoded = getCorsProxyUrl('https%3A%2F%2Fkodikplayer.com%2Fftor');
    assert.ok(!corsFromPreEncoded.includes('%253A'));
    assert.ok(!corsFromPreEncoded.includes('%252F'));
});

test('all media destinations route to unified server proxy and never to legacy proxy', () => {
    const originalProxy = process.env.VITE_PROXY_SERVER_URL;
    const originalMedia = process.env.VITE_MEDIA_PROXY_URL;
    process.env.VITE_PROXY_SERVER_URL = 'http://localhost:8787';
    delete process.env.VITE_MEDIA_PROXY_URL;

    try {
        const targets = [
            'https://kodikplayer.com/ftor',
            'https://KODIKPLAYER.COM/assets/player.js',
            '//kodikplayer.com/ftor',
            'https://api-s.anixsekai.com/episode/1/2/3',
            'https://api-s.anixsekai.com/profile/info',
            'https://video.sibnet.ru/shell.php?videoid=123',
            'https://rutube.ru/api/play/options/456',
            'https://vk.com/video_ext.php',
            'https://ok.ru/video/789',
            'https://cloud.kodik-storage.com/useruploads/1080.mp4',
            'https://solodcdn.com/manifest.m3u8',
            'https://test-streams.mux.dev/stream.m3u8',
        ];
        for (const target of targets) {
            assert.ok(isAllowedServerProxyHost(target), `Host for ${target} should be in server allowlist`);
            const url = getCorsProxyUrl(target);
            assert.ok(url.startsWith('http://localhost:8787/corsproxy?url='), `Expected unified server proxy for ${target}, got: ${url}`);
            assert.ok(!url.includes('kodik-proxy.imnottimaq.workers.dev'), 'Must not use legacy proxy worker');
            assert.ok(!url.includes('/api/v2'), 'Proxy path must not append /api/v2');
        }
    } finally {
        if (originalProxy !== undefined) process.env.VITE_PROXY_SERVER_URL = originalProxy; else delete process.env.VITE_PROXY_SERVER_URL;
        if (originalMedia !== undefined) process.env.VITE_MEDIA_PROXY_URL = originalMedia; else delete process.env.VITE_MEDIA_PROXY_URL;
    }
});

test('all agent methods route to new server proxy and never to legacy proxy', async () => {
    const originalProxy = process.env.VITE_PROXY_SERVER_URL;
    process.env.VITE_PROXY_SERVER_URL = 'http://server-proxy:8787';

    const recorded = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
        recorded.push({ url: String(url), init });
        return new Response(JSON.stringify({ code: 0, ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };

    try {
        // apiGetViaAgent
        await apiGetViaAgent('/profile/preference/my', 'token-123', { headers: { 'X-Test': '1' } });
        assert.equal(recorded.length, 1);
        assert.ok(recorded[0].url.startsWith('http://server-proxy:8787/agentproxy?url='));
        assert.ok(!recorded[0].url.includes('kodik-proxy.imnottimaq.workers.dev'));
        assert.ok(!recorded[0].url.includes('/api/v2'));

        // apiPostViaAgent
        await apiPostViaAgent('/profile/preference/status/edit', 'token-123', { status: 'hello' }, { 'Api-Version': 'v2' });
        assert.equal(recorded.length, 2);
        assert.ok(recorded[1].url.startsWith('http://server-proxy:8787/agentproxy?url='));
        assert.equal(recorded[1].init?.method, 'POST');
        assert.equal(recorded[1].init?.headers?.['Api-Version'], 'v2');
        assert.equal(recorded[1].init?.body, JSON.stringify({ status: 'hello' }));

        // apiPostFormViaAgent
        const form = new FormData();
        form.append('field', 'value');
        await apiPostFormViaAgent('/profile/form', 'token-123', form);
        assert.equal(recorded.length, 3);
        assert.ok(recorded[2].url.startsWith('http://server-proxy:8787/agentproxy?url='));
        assert.equal(recorded[2].init?.method, 'POST');
        assert.equal(recorded[2].init?.body, form);

        // Verify none called legacy proxy
        for (const req of recorded) {
            assert.ok(!req.url.includes('kodik-proxy.imnottimaq.workers.dev'), 'Agent API must never use legacy proxy');
        }
    } finally {
        globalThis.fetch = originalFetch;
        if (originalProxy !== undefined) process.env.VITE_PROXY_SERVER_URL = originalProxy; else delete process.env.VITE_PROXY_SERVER_URL;
    }
});

test('avatar callers route through server agentproxy and never fallback to legacy proxy', async () => {
    const originalProxy = process.env.VITE_PROXY_SERVER_URL;
    process.env.VITE_PROXY_SERVER_URL = 'http://server-proxy:8787';

    try {
        // postAnonymousForm fallback to agentproxy on failure
        const recordedAnon = [];
        const mockFetchAnon = async (url, init) => {
            recordedAnon.push({ url: String(url), init });
            if (url.startsWith('https://api-s.anixsekai.com')) {
                // Direct request fails with network error, triggering fallback
                throw new TypeError('Failed to fetch (CORS/network)');
            }
            // Proxied request succeeds
            return new Response(JSON.stringify({ code: 0, hash: 'test-hash' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        };
        const { postAnonymousForm } = getEditAccountHelpers(mockFetchAnon);

        const anonRes = await postAnonymousForm('/auth/restore', { data: 'testuser' });
        assert.equal(anonRes.hash, 'test-hash');
        assert.equal(recordedAnon.length, 2);
        assert.ok(recordedAnon[0].url.startsWith('https://api-s.anixsekai.com/auth/restore'));
        assert.ok(recordedAnon[1].url.startsWith('http://server-proxy:8787/agentproxy?url='));
        assert.ok(!recordedAnon[1].url.includes('kodik-proxy.imnottimaq.workers.dev'));

        // uploadAvatarRequest (multipart upload)
        const recordedAvatar = [];
        const mockFetchAvatar = async (url, init) => {
            recordedAvatar.push({ url: String(url), init });
            return new Response(JSON.stringify({ code: 0, avatar: 'avatar.jpg' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        };
        const helpers2 = getEditAccountHelpers(mockFetchAvatar);
        const dummyFile = new File([new Uint8Array([1, 2, 3])], 'avatar.jpg', { type: 'image/jpeg' });
        const avatarRes = await helpers2.uploadAvatarRequest(dummyFile, 'user-token-xyz');
        assert.equal(avatarRes.avatar, 'avatar.jpg');
        assert.equal(recordedAvatar.length, 1);
        assert.ok(recordedAvatar[0].url.startsWith('http://server-proxy:8787/agentproxy?url='));
        assert.ok(!recordedAvatar[0].url.includes('kodik-proxy.imnottimaq.workers.dev'));
        assert.equal(recordedAvatar[0].init?.method, 'POST');
    } finally {
        if (originalProxy !== undefined) process.env.VITE_PROXY_SERVER_URL = originalProxy; else delete process.env.VITE_PROXY_SERVER_URL;
    }
});

test('CorsFallbackFragmentLoader: fallback once on network error 0', () => {
    const { loader, loads } = createLoaderHarness();
    const callbacks = {
        onSuccess: (response, stats, context) => { callbacks.successResult = { response, context }; },
        onError: (error, context) => { callbacks.errorResult = { error, context }; },
        onTimeout: () => {},
    };

    const initialContext = { url: 'https://cdn.example.com/segment-1.ts', rangeStart: 0, rangeEnd: 500 };
    loader.load(initialContext, {}, callbacks);

    // Initial load attempted with original context URL
    assert.equal(loads.length, 1);
    assert.equal(loads[0].context.url, 'https://cdn.example.com/segment-1.ts');

    // Trigger error with status/code === 0 (CORS / network error)
    loads[0].callbacks.onError({ code: 0, text: 'Network Error' }, loads[0].context, {}, {});

    // Retried through proxy once!
    assert.equal(loads.length, 2);
    assert.ok(loads[1].context.url.includes('/corsproxy?url='), 'Retried with corsproxy URL');
    assert.equal(loads[1].context.rangeStart, 0, 'Range start preserved');
    assert.equal(loads[1].context.rangeEnd, 500, 'Range end preserved');

    // Simulate success on retried request: original callback URL must be preserved
    const mockResponse = { url: loads[1].context.url, data: new ArrayBuffer(500) };
    loads[1].callbacks.onSuccess(mockResponse, {}, loads[1].context, {});
    assert.equal(callbacks.successResult.response.url, 'https://cdn.example.com/segment-1.ts', 'Original URL preserved in response');
    assert.equal(callbacks.successResult.context.url, 'https://cdn.example.com/segment-1.ts', 'Original context passed to success callback');
});

test('CorsFallbackFragmentLoader: does not retry more than once and does not retry non-0 errors', () => {
    // 1. Double error with code 0 should NOT loop
    const { loader: loader1, loads: loads1 } = createLoaderHarness();
    let errorCalled = 0;
    const callbacks1 = {
        onSuccess: () => {},
        onError: (err) => { errorCalled++; callbacks1.lastError = err; },
        onTimeout: () => {},
    };
    loader1.load({ url: 'https://cdn.example.com/seg.ts' }, {}, callbacks1);
    assert.equal(loads1.length, 1);
    // First failure (code 0) -> retries
    loads1[0].callbacks.onError({ code: 0 }, loads1[0].context, {}, {});
    assert.equal(loads1.length, 2);
    assert.equal(errorCalled, 0, 'Error not called yet on first network error');

    // Second failure on the proxy retry (code 0) -> must NOT retry again!
    loads1[1].callbacks.onError({ code: 0 }, loads1[1].context, {}, {});
    assert.equal(loads1.length, 2, 'No third load call attempted');
    assert.equal(errorCalled, 1, 'Final error reported to callbacks.onError');

    // 2. Non-zero error (e.g. 404 or 500) does not retry
    const { loader: loader2, loads: loads2 } = createLoaderHarness();
    let errorCalled2 = 0;
    const callbacks2 = {
        onSuccess: () => {},
        onError: () => { errorCalled2++; },
        onTimeout: () => {},
    };
    loader2.load({ url: 'https://cdn.example.com/seg.ts' }, {}, callbacks2);
    assert.equal(loads2.length, 1);
    loads2[0].callbacks.onError({ code: 404, text: 'Not Found' }, loads2[0].context, {}, {});
    assert.equal(loads2.length, 1, '404 must not trigger proxy retry');
    assert.equal(errorCalled2, 1, 'Error immediately forwarded');
});

test('forwarding of Api-Version, Range, and abort signal', async () => {
    // 1. Api-Version and abort signal in agent methods
    const calls = [];
    const mockFetch = async (url, init) => {
        if (init?.signal?.aborted) {
            throw new DOMException('This operation was aborted', 'AbortError');
        }
        calls.push({ url, init });
        return new Response(JSON.stringify({ code: 0 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch;

    try {
        await apiPostViaAgent('/test', 'tok', { a: 1 }, { 'Api-Version': 'v2', 'Custom-Header': 'xyz' });
        assert.equal(calls[0].init.headers['Api-Version'], 'v2');
        assert.equal(calls[0].init.headers['Custom-Header'], 'xyz');

        // Abort signal forwarding
        const controller = new AbortController();
        controller.abort();
        await assert.rejects(
            () => apiGetViaAgent('/test', 'tok', { signal: controller.signal }),
            err => err.name === 'AbortError'
        );
    } finally {
        globalThis.fetch = originalFetch;
    }

    // 2. Range forwarding in CorsFallbackFragmentLoader
    const { loader, loads } = createLoaderHarness();
    loader.load({ url: 'https://cdn.example.com/seg.ts', rangeStart: 100, rangeEnd: 500, headers: { Range: 'bytes=100-500' } }, {}, {
        onError: () => {},
        onSuccess: () => {},
        onTimeout: () => {},
    });
    // Trigger network error 0
    loads[0].callbacks.onError({ code: 0 }, loads[0].context, {}, {});
    assert.equal(loads.length, 2);
    assert.equal(loads[1].context.rangeStart, 100);
    assert.equal(loads[1].context.rangeEnd, 500);
    assert.equal(loads[1].context.headers?.Range, 'bytes=100-500');
});

test('compiled production Vite bundle preserves production worker URLs in browser without process', { timeout: 60000 }, async () => {
    const testOutDir = 'test-results/dist-proxy-prod';
    const prodRoomUrl = 'https://anixweb-server.imnottimaq.workers.dev/';
    const prodBasePath = '/anixweb';

    try {
        // Build actual production bundle with production BASE_PATH and VITE_ROOM_SERVER_URL
        execSync(`npx vite build --outDir ${testOutDir}`, {
            env: {
                ...process.env,
                BASE_PATH: prodBasePath,
                VITE_ROOM_SERVER_URL: prodRoomUrl,
            },
            stdio: 'pipe',
        });

        const assetsDir = join(testOutDir, 'assets');
        const assetFiles = readdirSync(assetsDir);

        // 1. Verify apiClient chunk in the compiled production bundle
        const apiClientFile = assetFiles.find(f => f.startsWith('apiClient-') && f.endsWith('.js'));
        assert.ok(apiClientFile, 'Production build must emit apiClient chunk');

        const apiClientCode = readFileSync(join(assetsDir, apiClientFile), 'utf8');
        assert.ok(
            apiClientCode.includes('anixweb-server.imnottimaq.workers.dev'),
            'Production apiClient bundle must contain statically injected worker URL'
        );

        // Simulate browser environment where globalThis.process is undefined
        const originalProcess = globalThis.process;
        try {
            globalThis.process = undefined;
            const chunkUrl = `${pathToFileURL(resolve(join(assetsDir, apiClientFile))).href}?t=${Date.now()}`;
            const apiClientMod = await import(chunkUrl);

            // Vite assigns export aliases across the whole module graph, so unrelated
            // UI imports can change them. Identify the exported production helpers by
            // their distinctive environment property or route, never by alias order.
            const exportedHelper = (marker, name) => {
                const matches = Object.values(apiClientMod).filter(value => typeof value === 'function'
                    && Function.prototype.toString.call(value).includes(marker));
                assert.equal(matches.length, 1, `Expected one exported ${name} helper containing ${marker}`);
                return matches[0];
            };
            const compiledGetProxyServerUrl = exportedHelper('VITE_PROXY_SERVER_URL', 'getProxyServerUrl');
            const compiledGetAgentProxyUrl = exportedHelper('/agentproxy?url=', 'getAgentProxyUrl');
            const compiledGetCorsProxyUrl = exportedHelper('/corsproxy?url=', 'getCorsProxyUrl');
            assert.equal(compiledGetProxyServerUrl.length, 0, 'Proxy base getter takes no target URL');
            const proxyBase = compiledGetProxyServerUrl();
            assert.equal(
                proxyBase,
                'https://anixweb-server.imnottimaq.workers.dev',
                'getProxyServerUrl must evaluate to production worker URL, not localhost'
            );
            assert.notEqual(proxyBase, 'http://localhost:8787', 'getProxyServerUrl must not fallback to localhost');

            const agentUrl = compiledGetAgentProxyUrl('https://api-s.anixsekai.com/profile/1');
            assert.ok(
                agentUrl.startsWith('https://anixweb-server.imnottimaq.workers.dev/agentproxy?url='),
                `Agent proxy URL must use production worker: ${agentUrl}`
            );
            assert.ok(!agentUrl.includes('localhost'), 'Agent proxy URL must not contain localhost');

            const corsUrl = compiledGetCorsProxyUrl('https://kodikplayer.com/ftor');
            assert.ok(
                corsUrl.startsWith('https://anixweb-server.imnottimaq.workers.dev/corsproxy?url='),
                `CORS proxy / media helper URL must use production worker: ${corsUrl}`
            );
            assert.ok(!corsUrl.includes('localhost'), 'CORS proxy URL must not contain localhost');
        } finally {
            globalThis.process = originalProcess;
        }

        // 2. The room module may be split out of the entry chunk by Vite.
        const indexFile = assetFiles.find(f => f.startsWith('watchRoom-') && f.endsWith('.js'))
            ?? assetFiles.find(f => f.startsWith('index-') && f.endsWith('.js'));
        assert.ok(indexFile, 'Production build must include the room session module');
        const indexCode = readFileSync(join(assetsDir, indexFile), 'utf8');
        assert.ok(
            indexCode.includes('anixweb-server.imnottimaq.workers.dev'),
            'Production room module must include worker domain for watchRoom'
        );
        assert.ok(
            !indexCode.includes("`http://localhost:8787`.replace"),
            'watchRoom BASE URL must not default to localhost in production build'
        );
    } finally {
        rmSync(testOutDir, { recursive: true, force: true });
    }
});
