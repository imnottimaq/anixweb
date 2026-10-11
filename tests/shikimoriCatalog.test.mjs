import test from 'node:test';
import assert from 'node:assert/strict';
import { searchShikimoriCatalog, parseShikimoriId } from '../src/shared/shikimoriCatalog.ts';

test('manual external mapping accepts exact safe IDs and Shikimori anime links only', () => {
    for (const input of ['1', ' 1 ', 'https://shikimori.one/animes/1', 'https://shikimori.io/animes/z1-cowboy-bebop']) {
        assert.equal(parseShikimoriId(input), 1);
    }
    for (const input of ['0', '-1', '1.5', '1junk', '9007199254740992',
        'https://example.test/animes/1', 'https://shikimori.one/mangas/1', 'https://shikimori.one/animes/1/other']) {
        assert.equal(parseShikimoriId(input), undefined);
    }
});

test('external mapping suggestions use the Shikimori catalog and its actual IDs', async () => {
    const controller = new AbortController();
    const candidates = await searchShikimoriCatalog(' Cowboy Bebop ', controller.signal, async (url, init) => {
        assert.equal(url.origin, 'https://shikimori.one');
        assert.equal(url.pathname, '/api/animes');
        assert.equal(url.searchParams.get('search'), 'Cowboy Bebop');
        assert.equal(url.searchParams.get('limit'), '5');
        assert.equal(url.searchParams.has('token'), false);
        assert.equal(init.signal, controller.signal);
        assert.equal(init.credentials, 'omit');
        return Response.json([{ id: 1, name: 'Cowboy Bebop', russian: 'Bebop', aired_on: '1998-04-03', kind: 'tv' }]);
    });
    assert.deepEqual(candidates, [{ id: 1, title: 'Cowboy Bebop', titleRu: 'Bebop', year: '1998', kind: 'tv', url: 'https://shikimori.one/animes/1' }]);
});

test('catalog mapping rejects Anixart-shaped results and malformed IDs', async () => {
    for (const row of [{ id: 42001, title_original: 'Cowboy Bebop' },
        { id: '1junk', name: 'Cowboy Bebop' }, { id: Number.MAX_SAFE_INTEGER + 1, name: 'Cowboy Bebop' }]) {
        await assert.rejects(() => searchShikimoriCatalog('Cowboy Bebop', undefined, async () => Response.json([row])));
    }
});

test('catalog outages and cancellation remain errors rather than empty successful suggestions', async () => {
    await assert.rejects(() => searchShikimoriCatalog('Cowboy Bebop', undefined, async () => new Response('', { status: 503 })));
    const controller = new AbortController(); controller.abort();
    await assert.rejects(() => searchShikimoriCatalog('Cowboy Bebop', controller.signal, async (_url, { signal }) => {
        signal.throwIfAborted();
    }), { name: 'AbortError' });
});
