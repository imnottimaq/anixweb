import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const template = readFileSync('public/sw.js', 'utf8');
function worker({ scope = 'https://example.test/anixweb/', version = 'first', storage = new Map(), failAsset = false } = {}) {
    const handlers = {};
    let claims = 0;
    const key = value => new URL(typeof value === 'string' ? value : value.url, scope).href;
    const fetch = async request => {
        const url = key(request);
        return new Response(`${version}:${new URL(url).pathname}`, { status: failAsset && url.endsWith('.js') ? 503 : 200 });
    };
    const caches = {
        async open(name) {
            if (!storage.has(name)) storage.set(name, new Map());
            const entries = storage.get(name);
            return {
                async addAll(urls) {
                    for (const url of urls) {
                        const response = await fetch(url);
                        if (!response.ok) throw new Error('Asset unavailable');
                        entries.set(key(url), response);
                    }
                },
                async match(request) { return entries.get(key(request))?.clone(); },
            };
        },
        async keys() { return [...storage.keys()]; },
        async delete(name) { return storage.delete(name); },
    };
    vm.runInNewContext(template.replace('__BUILD_VERSION__', version).replace('const BUILD_ASSETS = [];', 'const BUILD_ASSETS = ["assets/app.js", "assets/app.css", "assets/lazy.js"];'), {
        URL, Set, caches, fetch,
        self: { registration: { scope }, clients: { async claim() { claims++; } }, addEventListener(name, handler) { handlers[name] = handler; } },
    });
    return {
        storage, get claims() { return claims; },
        async lifecycle(name) { let pending; handlers[name]({ waitUntil(promise) { pending = promise; } }); await pending; },
        request(path, mode = 'cors', method = 'GET') {
            let pending;
            handlers.fetch({ request: { url: key(path), method, mode }, respondWith(promise) { pending = promise; } });
            return pending;
        },
    };
}

test('failed precache installation rejects and removes the incomplete build', async () => {
    const instance = worker({ failAsset: true });
    await assert.rejects(instance.lifecycle('install'), /Asset unavailable/);
    assert.equal(instance.storage.size, 0);
    assert.equal(instance.claims, 0);
});

test('updates keep the old shell usable until activation, then only clean this scope', async () => {
    const storage = new Map([['other-app', new Map()], ['anixweb-v3-other-scope-old', new Map()], [`anixweb-v2-${encodeURIComponent('https://example.test/another/')}`, new Map()]]);
    const first = worker({ storage });
    await first.lifecycle('install');
    const next = worker({ storage, version: 'second' });
    await next.lifecycle('install');
    assert.equal(await (await first.request('settings', 'navigate')).text(), 'first:/anixweb/index.html');
    assert.equal(await (await first.request('assets/lazy.js')).text(), 'first:/anixweb/assets/lazy.js');
    await next.lifecycle('activate');
    assert.equal(await (await next.request('settings', 'navigate')).text(), 'second:/anixweb/index.html');
    assert.ok(![...storage.keys()].some(name => name.endsWith('-first')));
    assert.ok(storage.has('other-app'));
    assert.ok(storage.has('anixweb-v3-other-scope-old'));
    assert.ok(storage.has(`anixweb-v2-${encodeURIComponent('https://example.test/another/')}`));
    assert.equal(next.claims, 1);
});

test('only build-listed static assets and app navigations are intercepted', async () => {
    const instance = worker();
    await instance.lifecycle('install');
    for (const path of ['api/v2/user/settings', 'api/v2/session', 'corsproxy?url=x', 'agentproxy?url=x', 'private-data', 'episode.mp4', 'https://api.example.test/profile', '/another/assets/app.js']) {
        assert.equal(instance.request(path), undefined, path);
    }
    assert.equal(instance.request('assets/app.js', 'cors', 'POST'), undefined);
    assert.equal(instance.request('api/v2/session', 'navigate'), undefined);
    assert.equal((await instance.request('assets/app.css')).status, 200);
});
