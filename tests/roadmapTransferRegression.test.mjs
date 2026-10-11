import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { mapMalStatusToAnixart } from '../src/shared/listTransfer/statusMapper.ts';
import { parseMalXml } from '../src/shared/listTransfer/xmlParser.ts';
import { matchItem } from '../src/shared/listTransfer/matcher.ts';
import { serializeToMalXml } from '../src/shared/listTransfer/xmlSerializer.ts';
import { exportUserListsToXml } from '../src/shared/listTransfer/exporter.ts';
import { runImport } from '../src/shared/listTransfer/transferRunner.ts';
import { parseShikimoriJson } from '../src/shared/listTransfer/jsonParser.ts';
import { serializeToShikimoriJson } from '../src/shared/listTransfer/jsonSerializer.ts';

// These tests exercise production helpers with isolated API fixtures. They assert
// transfer ownership and mutation outcomes rather than internal error wording.
const anime = {
    id: 42001, title_original: 'Example Season 1', title_ru: 'Example Season 1',
    profile_list_status: 0, my_vote: 0, your_vote: 0,
    episodes_total: 12, episodes_released: 12, category: { name: 'TV' },
};
function row(overrides = {}) {
    return {
        id: 'row-1', sourceId: 101, title: anime.title_original,
        episodesWatched: 0, rawScore: 0, anixartScore: 0,
        rawStatus: 'Watching', anixartStatus: 1,
        matchState: 'matched', matchedRelease: { ...anime },
        resolutionCandidates: [], currentListStatus: 0, currentVote: 0,
        hasConflict: false, isSkipped: false, ...overrides,
    };
}
const importOptions = { applyStatus: true, applyScore: true, overwriteStatusOnConflict: false };

for (const [mal, expected] of [[1, 1], [2, 3], [3, 4], [4, 5], [6, 2]]) {
    test(`MAL numeric status ${mal} maps to Anixart status ${expected}`, () => {
        assert.equal(mapMalStatusToAnixart(mal), expected);
        assert.equal(mapMalStatusToAnixart(String(mal)), expected);
    });
}

const genericXml = `<?xml version="1.0"?><myanimelist><anime>
    <series_animedb_id>101</series_animedb_id><series_title>Example Season 1</series_title>
    <my_id>42001</my_id><my_status>Watching</my_status><my_score>8</my_score>
</anime></myanimelist>`;

for (const browserParser of [false, true]) {
test(`generic MAL XML my_id is not an Anixart ID (${browserParser ? 'browser' : 'Node'} parser)`, () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'DOMParser');
    const dom = new JSDOM('');
    try {
        Object.defineProperty(globalThis, 'DOMParser', {
            configurable: true, value: browserParser ? dom.window.DOMParser : undefined,
        });
        const items = parseMalXml(genericXml);
        assert.equal(items.length, 1);
        assert.equal(items[0].anixartId, undefined);
        assert.equal(items[0].sourceId, 101);
    } finally {
        dom.window.close();
        if (original) Object.defineProperty(globalThis, 'DOMParser', original);
        else delete globalThis.DOMParser;
    }
});
}

test('another season remains a suggestion and never becomes an automatic import target', async () => {
    const result = await matchItem(row({
        title: 'Example Season 2', sourceId: 102, anixartId: undefined,
        matchedRelease: null, matchState: 'unmatched',
    }), {
        post: async () => ({ code: 0, content: [{ ...anime }] }),
        get: async () => { assert.fail('No verified Anixart ID was provided'); },
    });
    assert.equal(result.matchedRelease, null);
    assert.notEqual(result.matchState, 'matched');
});

test('export rejects unresolved external IDs instead of treating Anixart IDs as MAL IDs', () => {
    assert.throws(() => serializeToMalXml({ entries: [{ anime, status: 1 }] }));
});

test('export writes the verified external ID and retains the distinct Anixart ID', () => {
    const xml = serializeToMalXml({ entries: [{ anime, status: 1, externalId: 101 }] });
    assert.match(xml, /<series_animedb_id>101<\/series_animedb_id>/);
    assert.doesNotMatch(xml, /<series_animedb_id>42001<\/series_animedb_id>/);
    assert.match(xml, /<anixart_id>42001<\/anixart_id>/);
});

test('a cancelled export rejects instead of returning a successful empty file', async () => {
    const controller = new AbortController();
    controller.abort();
    let requests = 0;
    await assert.rejects(() => exportUserListsToXml({
        api: { get: async () => { requests++; return { code: 0, content: [] }; } },
        options: [{ id: 'watching', statusId: 1, labelKey: 'status.watching', enabled: true }],
        signal: controller.signal,
    }));
    assert.equal(requests, 0);
});

test('a failed list fetch rejects the export instead of reporting a partial file as success', async () => {
    await assert.rejects(() => exportUserListsToXml({
        api: { get: async () => { throw new Error('Fixture upstream outage'); } },
        options: [{ id: 'watching', statusId: 1, labelKey: 'status.watching', enabled: true }],
    }));
});

test('score-only import can rate a matched row whose source status is unknown', async () => {
    const writes = [];
    const result = await runImport({
        items: [row({ rawStatus: 'Unknown', anixartStatus: null, anixartScore: 5 })],
        options: { ...importOptions, applyStatus: false },
        api: { get: async path => { writes.push(path); return { code: 0 }; } },
    });
    assert.deepEqual(writes, [`/release/vote/add/${anime.id}/5`]);
    assert.equal(result.succeeded, 1);
});

test('conflicting rows for the same destination cannot silently overwrite one another', async () => {
    const writes = [];
    let result;
    let rejection;
    try {
        result = await runImport({
            items: [row(), row({ id: 'row-2', anixartStatus: 3, rawStatus: 'Completed' })],
            options: { ...importOptions, applyScore: false },
            api: { get: async path => { writes.push(path); return { code: 0 }; } },
        });
    } catch (error) { rejection = error; }
    assert.deepEqual(writes, [], 'Ambiguous destination requires resolution before any mutation');
    assert.ok(rejection || result?.failed > 0 || result?.errors?.length > 0,
        'Conflicting destination rows must produce a visible rejection');
});

test('cancellation after the status mutation prevents the subsequent score mutation', async () => {
    const controller = new AbortController();
    const writes = [];
    await runImport({
        items: [row({ anixartScore: 5 })], options: importOptions, signal: controller.signal,
        api: { get: async path => {
            writes.push(path);
            controller.abort();
            return { code: 0 };
        } },
    });
    assert.deepEqual(writes, [`/profile/list/add/1/${anime.id}`]);
});

test('retrying a failed score does not repeat the status mutation that already succeeded', async () => {
    const item = row({ anixartScore: 5 });
    const writes = [];
    const statusPath = `/profile/list/add/1/${anime.id}`;
    const scorePath = `/release/vote/add/${anime.id}/5`;
    let rejectScore = true;
    const api = { get: async path => {
        writes.push(path);
        if (path === scorePath && rejectScore) throw new Error('Fixture score outage');
        return { code: 0 };
    } };
    const first = await runImport({ items: [item], options: importOptions, api });
    assert.equal(first.failed, 1);
    assert.deepEqual(writes, [statusPath, scorePath]);

    rejectScore = false;
    const retry = await runImport({ items: [item], options: importOptions, api });
    assert.equal(retry.succeeded, 1);
    assert.deepEqual(writes, [statusPath, scorePath, scorePath]);
});

test('a conflict-skipped status preserves the actual matched release status', async () => {
    const item = row({
        matchedRelease: { ...anime, profile_list_status: 3 },
        currentListStatus: 3, hasConflict: true, anixartStatus: 1,
    });
    const writes = [];
    await runImport({
        items: [item], options: { ...importOptions, applyScore: false },
        api: { get: async path => { writes.push(path); return { code: 0 }; } },
    });
    assert.deepEqual(writes, []);
    assert.equal(item.matchedRelease.profile_list_status, 3);
    assert.equal(item.currentListStatus, 3);
});

test('malformed explicit JSON IDs are rejected or unresolved without coercing another release ID', () => {
    for (const invalidId of ['42junk', '42.9', Number.MAX_SAFE_INTEGER + 1]) {
        let items;
        let rejected = false;
        try {
            items = parseShikimoriJson(JSON.stringify([{
                target_type: 'Anime', target_id: 101, target_title: 'Example',
                status: 'watching', anixart_id: invalidId,
            }]));
        } catch { rejected = true; }
        if (!rejected) {
            assert.equal(items.length, 1, 'Invalid rows must be rejected or visibly unresolved, not silently dropped');
            assert.equal(items[0].anixartId, undefined, `Invalid explicit ID ${invalidId} must not resolve`);
        }
    }
});

test('both export formats reject contradictory rows mapped to one external destination', () => {
    const entries = [
        { anime: { ...anime }, status: 1, externalId: 101 },
        { anime: { ...anime, id: anime.id + 1 }, status: 3, externalId: 101 },
    ];
    const rejected = [serializeToMalXml, serializeToShikimoriJson].map(serialize => {
        try { serialize({ entries }); return false; }
        catch { return true; }
    });
    assert.deepEqual(rejected, [true, true]);
});
