import test from 'node:test';
import assert from 'node:assert/strict';

import {
    mapMalStatusToAnixart,
    mapAnixartStatusToMal,
    mapAnixartStatusToShikimori,
    mapMalScoreToAnixart,
    mapAnixartScoreToMal,
} from '../src/shared/listTransfer/statusMapper.ts';

import {
    parseMalXml,
    assertSafeXml,
    XmlSecurityError,
    XmlParseError,
    MAX_XML_FILE_BYTES,
} from '../src/shared/listTransfer/xmlParser.ts';

import {
    serializeToMalXml,
} from '../src/shared/listTransfer/xmlSerializer.ts';

import {
    parseShikimoriJson,
} from '../src/shared/listTransfer/jsonParser.ts';

import {
    serializeToShikimoriJson,
} from '../src/shared/listTransfer/jsonSerializer.ts';

import {
    normalizeTitle,
    areTitlesEquivalent,
    matchItem,
} from '../src/shared/listTransfer/matcher.ts';

import {
    runImport,
} from '../src/shared/listTransfer/transferRunner.ts';

import {
    triggerDownload,
} from '../src/shared/listTransfer/exporter.ts';

test('statusMapper: correctly converts between MAL strings/numbers and Anixart status IDs', () => {
    // MAL string -> Anixart
    assert.equal(mapMalStatusToAnixart('Watching'), 1);
    assert.equal(mapMalStatusToAnixart('currently watching'), 1);
    assert.equal(mapMalStatusToAnixart('Plan to Watch'), 2);
    assert.equal(mapMalStatusToAnixart('plantowatch'), 2);
    assert.equal(mapMalStatusToAnixart('planned'), 2);
    assert.equal(mapMalStatusToAnixart('Completed'), 3);
    assert.equal(mapMalStatusToAnixart('watched'), 3);
    assert.equal(mapMalStatusToAnixart('On-Hold'), 4);
    assert.equal(mapMalStatusToAnixart('on hold'), 4);
    assert.equal(mapMalStatusToAnixart('hold_on'), 4);
    assert.equal(mapMalStatusToAnixart('Dropped'), 5);

    // MAL numeric codes -> Anixart
    // 1 watching -> Anixart 1
    // 2 completed -> Anixart 3
    // 3 on-hold -> Anixart 4
    // 4 dropped -> Anixart 5
    // 6 planned -> Anixart 2
    assert.equal(mapMalStatusToAnixart(1), 1);
    assert.equal(mapMalStatusToAnixart('1'), 1);
    assert.equal(mapMalStatusToAnixart(2), 3);
    assert.equal(mapMalStatusToAnixart('2'), 3);
    assert.equal(mapMalStatusToAnixart(3), 4);
    assert.equal(mapMalStatusToAnixart('3'), 4);
    assert.equal(mapMalStatusToAnixart(4), 5);
    assert.equal(mapMalStatusToAnixart('4'), 5);
    assert.equal(mapMalStatusToAnixart(6), 2);
    assert.equal(mapMalStatusToAnixart('6'), 2);

    assert.equal(mapMalStatusToAnixart('unknown_status'), null);
    assert.equal(mapMalStatusToAnixart(null), null);
    assert.equal(mapMalStatusToAnixart(undefined), null);

    // Anixart -> MAL
    assert.equal(mapAnixartStatusToMal(1), 'Watching');
    assert.equal(mapAnixartStatusToMal(2), 'Plan to Watch');
    assert.equal(mapAnixartStatusToMal(3), 'Completed');
    assert.equal(mapAnixartStatusToMal(4), 'On-Hold');
    assert.equal(mapAnixartStatusToMal(5), 'Dropped');

    // Anixart -> Shikimori JSON string
    assert.equal(mapAnixartStatusToShikimori(1), 'watching');
    assert.equal(mapAnixartStatusToShikimori(2), 'planned');
    assert.equal(mapAnixartStatusToShikimori(3), 'completed');
    assert.equal(mapAnixartStatusToShikimori(4), 'on_hold');
    assert.equal(mapAnixartStatusToShikimori(5), 'dropped');
});

test('statusMapper: correctly converts between 10-point MAL and 5-point Anixart scores', () => {
    // 10-point -> 5-point
    assert.equal(mapMalScoreToAnixart(0), 0);
    assert.equal(mapMalScoreToAnixart(-1), 0);
    assert.equal(mapMalScoreToAnixart(1), 1);
    assert.equal(mapMalScoreToAnixart(2), 1);
    assert.equal(mapMalScoreToAnixart(3), 2);
    assert.equal(mapMalScoreToAnixart(4), 2);
    assert.equal(mapMalScoreToAnixart(5), 3);
    assert.equal(mapMalScoreToAnixart(6), 3);
    assert.equal(mapMalScoreToAnixart(7), 4);
    assert.equal(mapMalScoreToAnixart(8), 4);
    assert.equal(mapMalScoreToAnixart(9), 5);
    assert.equal(mapMalScoreToAnixart(10), 5);

    // 5-point -> 10-point
    assert.equal(mapAnixartScoreToMal(0), 0);
    assert.equal(mapAnixartScoreToMal(-1), 0);
    assert.equal(mapAnixartScoreToMal(1), 2);
    assert.equal(mapAnixartScoreToMal(2), 4);
    assert.equal(mapAnixartScoreToMal(3), 6);
    assert.equal(mapAnixartScoreToMal(4), 8);
    assert.equal(mapAnixartScoreToMal(5), 10);
});

test('xmlParser: rejects DTD declarations and entity expansions for XXE safety', () => {
    const maliciousDtdXml = `<?xml version="1.0"?>
    <!DOCTYPE foo [<!ENTITY xxe SYSTEM "http://malicious.example.com/evil">]>
    <myanimelist><anime><series_title>&xxe;</series_title></anime></myanimelist>`;

    assert.throws(() => assertSafeXml(maliciousDtdXml), XmlSecurityError);
    assert.throws(() => parseMalXml(maliciousDtdXml), XmlSecurityError);

    const billionLaughs = `<?xml version="1.0"?>
    <!DOCTYPE lolz [
      <!ENTITY lol "lol">
      <!ENTITY lol2 "&lol;&lol;">
    ]>
    <myanimelist></myanimelist>`;

    assert.throws(() => assertSafeXml(billionLaughs), XmlSecurityError);
    assert.throws(() => parseMalXml(billionLaughs), XmlSecurityError);
});

test('xmlParser: rejects empty content or content exceeding size limit', () => {
    assert.throws(() => assertSafeXml(''), XmlParseError);
    // @ts-expect-error test invalid types
    assert.throws(() => assertSafeXml(null), XmlParseError);

    const hugeContent = 'a'.repeat(MAX_XML_FILE_BYTES + 10);
    assert.throws(() => assertSafeXml(hugeContent), XmlParseError);
});

test('xmlParser: rejects malformed root, unexpected elements, invalid entities, and excessive limits', () => {
    // 1. Malformed root tag
    const badRoot = '<animelist><anime><series_title>Test</series_title></anime></animelist>';
    assert.throws(() => parseMalXml(badRoot), XmlParseError);

    // 2. Stray root text
    const strayRootText = '<myanimelist>stray text<anime><series_title>Test</series_title></anime></myanimelist>';
    assert.throws(() => parseMalXml(strayRootText), XmlParseError);

    // 3. Unexpected root element (not anime or myinfo)
    const unexpectedTag = '<myanimelist><settings><foo>bar</foo></settings></myanimelist>';
    assert.throws(() => parseMalXml(unexpectedTag), XmlParseError);

    // 4. Undefined / unknown entity
    const unknownEntity = '<myanimelist><anime><series_title>Test &customEntity; Title</series_title></anime></myanimelist>';
    assert.throws(() => parseMalXml(unknownEntity), XmlParseError);

    // 5. Invalid numeric entity
    const badNumEntity = '<myanimelist><anime><series_title>Test &#0; Title</series_title></anime></myanimelist>';
    assert.throws(() => parseMalXml(badNumEntity), XmlParseError);

    // 6. Malformed comment (double hyphen)
    const badComment = '<myanimelist><!-- invalid -- comment --><anime><series_title>Test</series_title></anime></myanimelist>';
    assert.throws(() => parseMalXml(badComment), XmlParseError);

    // 7. Unclosed CDATA
    const unclosedCdata = '<myanimelist><anime><series_title><![CDATA[Unclosed</series_title></anime></myanimelist>';
    assert.throws(() => parseMalXml(unclosedCdata), XmlParseError);

    // 8. Mismatched closing tag
    const mismatchedTag = '<myanimelist><anime><series_title>Test</mismatched></anime></myanimelist>';
    assert.throws(() => parseMalXml(mismatchedTag), XmlParseError);

    // 9. Invalid XML character (e.g. null byte)
    const controlChar = '<myanimelist><anime><series_title>Test\x00Title</series_title></anime></myanimelist>';
    assert.throws(() => assertSafeXml(controlChar), XmlParseError);
    assert.throws(() => parseMalXml(controlChar), XmlParseError);

    // 10. Excessive nesting depth (> 4 levels)
    const deepNesting = '<myanimelist><anime><series_title><a><b><c><d>Deep</d></c></b></a></series_title></anime></myanimelist>';
    assert.throws(() => parseMalXml(deepNesting), XmlParseError);

    // 11. Exceeding max rows limit (> 2000 entries)
    const rowXml = '<anime><series_title>A</series_title></anime>';
    const tooManyRows = `<myanimelist>${rowXml.repeat(2001)}</myanimelist>`;
    assert.throws(() => parseMalXml(tooManyRows), XmlParseError);
});

test('xmlParser: rejects malformed anime rows, duplicate fields, invalid IDs, and invalid scores', () => {
    // 1. Stray text inside <anime> outside tags
    const strayAnimeText = '<myanimelist><anime>stray text<series_title>Test</series_title></anime></myanimelist>';
    assert.throws(() => parseMalXml(strayAnimeText), XmlParseError);

    // 2. Duplicate field in <anime>
    const dupField = '<myanimelist><anime><series_title>Title 1</series_title><series_title>Title 2</series_title></anime></myanimelist>';
    assert.throws(() => parseMalXml(dupField), XmlParseError);

    // 3. Nested child element inside field
    const nestedInField = '<myanimelist><anime><series_title><span>Nested</span></series_title></anime></myanimelist>';
    assert.throws(() => parseMalXml(nestedInField), XmlParseError);

    // 4. Missing anime identity (no title, titleRu, or sourceId)
    const missingIdentity = '<myanimelist><anime><my_score>8</my_score></anime></myanimelist>';
    assert.throws(() => parseMalXml(missingIdentity), XmlParseError);

    // 5. Title excessively long (> 1000 characters)
    const hugeTitle = `<myanimelist><anime><series_title>${'x'.repeat(1001)}</series_title></anime></myanimelist>`;
    assert.throws(() => parseMalXml(hugeTitle), XmlParseError);

    // 6. Invalid series_animedb_id (negative or non-numeric)
    for (const badId of ['-1', 'abc', '0', '12.5']) {
        const badSourceIdXml = `<myanimelist><anime><series_animedb_id>${badId}</series_animedb_id><series_title>Test</series_title></anime></myanimelist>`;
        assert.throws(() => parseMalXml(badSourceIdXml), XmlParseError);
    }

    // 7. Invalid explicit anixart_id (malformed string, float, negative, zero)
    for (const badAnixartId of ['42junk', '42.9', '-1', '0', 'notanid']) {
        const badAnixartIdXml = `<myanimelist><anime><series_title>Test</series_title><anixart_id>${badAnixartId}</anixart_id></anime></myanimelist>`;
        assert.throws(() => parseMalXml(badAnixartIdXml), XmlParseError);
    }

    // 8. Invalid score (> 10, negative, non-numeric)
    for (const badScore of ['11', '-1', 'good', '8.5']) {
        const badScoreXml = `<myanimelist><anime><series_title>Test</series_title><my_score>${badScore}</my_score></anime></myanimelist>`;
        assert.throws(() => parseMalXml(badScoreXml), XmlParseError);
    }

    // 9. Invalid watched episodes (negative, non-numeric)
    for (const badEps of ['-1', 'twelve', '1.5']) {
        const badEpsXml = `<myanimelist><anime><series_title>Test</series_title><my_watched_episodes>${badEps}</my_watched_episodes></anime></myanimelist>`;
        assert.throws(() => parseMalXml(badEpsXml), XmlParseError);
    }
});

test('xmlParser: correctly parses valid Shikimori / MAL XML export', () => {
    const validXml = `<?xml version="1.0" encoding="UTF-8"?>
<myanimelist>
    <myinfo>
        <user_id>42</user_id>
        <user_name>TestUser</user_name>
        <user_export_type>1</user_export_type>
        <user_total_anime>3</user_total_anime>
    </myinfo>
    <anime>
        <series_animedb_id>16498</series_animedb_id>
        <series_title><![CDATA[Shingeki no Kyojin]]></series_title>
        <series_title_ru><![CDATA[Атака титанов]]></series_title_ru>
        <series_type>TV</series_type>
        <series_episodes>25</series_episodes>
        <my_watched_episodes>25</my_watched_episodes>
        <my_score>10</my_score>
        <my_status>Completed</my_status>
        <anixart_id>101</anixart_id>
    </anime>
    <anime>
        <series_animedb_id>5114</series_animedb_id>
        <series_title><![CDATA[Fullmetal Alchemist: Brotherhood]]></series_title>
        <series_type>TV</series_type>
        <series_episodes>64</series_episodes>
        <my_watched_episodes>12</my_watched_episodes>
        <my_score>8</my_score>
        <my_status>Watching</my_status>
    </anime>
    <anime>
        <series_animedb_id>9999</series_animedb_id>
        <series_title>Solo Leveling</series_title>
        <series_title_ru>Поднятие уровня в одиночку</series_title_ru>
        <series_type>TV</series_type>
        <series_episodes>12</series_episodes>
        <my_watched_episodes>0</my_watched_episodes>
        <my_score>0</my_score>
        <my_status>Plan to Watch</my_status>
    </anime>
</myanimelist>`;

    const items = parseMalXml(validXml);
    assert.equal(items.length, 3);

    // Item 1
    assert.equal(items[0].sourceId, 16498);
    assert.equal(items[0].title, 'Shingeki no Kyojin');
    assert.equal(items[0].titleRu, 'Атака титанов');
    assert.equal(items[0].episodesWatched, 25);
    assert.equal(items[0].episodesTotal, 25);
    assert.equal(items[0].rawScore, 10);
    assert.equal(items[0].anixartScore, 5); // 10 -> 5
    assert.equal(items[0].rawStatus, 'Completed');
    assert.equal(items[0].anixartStatus, 3);
    assert.equal(items[0].anixartId, 101);

    // Item 2
    assert.equal(items[1].sourceId, 5114);
    assert.equal(items[1].title, 'Fullmetal Alchemist: Brotherhood');
    assert.equal(items[1].titleRu, undefined);
    assert.equal(items[1].episodesWatched, 12);
    assert.equal(items[1].rawScore, 8);
    assert.equal(items[1].anixartScore, 4); // 8 -> 4
    assert.equal(items[1].anixartStatus, 1); // Watching -> 1

    // Item 3
    assert.equal(items[2].title, 'Solo Leveling');
    assert.equal(items[2].titleRu, 'Поднятие уровня в одиночку');
    assert.equal(items[2].rawScore, 0);
    assert.equal(items[2].anixartScore, 0);
    assert.equal(items[2].anixartStatus, 2); // Plan to Watch -> 2
});

test('xmlSerializer: serializes entries into official Shikimori / MAL XML and preserves data on roundtrip', () => {
    const mockAnime1 = {
        id: 101,
        image: 'https://example.com/poster.jpg',
        title_ru: 'Атака титанов',
        title_original: 'Shingeki no Kyojin',
        episodes_released: 25,
        episodes_total: 25,
        grade: 4.8,
        description: 'Test description',
        favorites_count: 500,
        duration: 24,
        country: 'Япония',
        season: 1,
        year: '2013',
        aired_on_date: 1365260400,
        genres: 'Экшен, Драма',
        studio: 'Wit Studio',
        author: '',
        director: '',
        category: { name: 'TV' },
        status: { name: 'Вышел' },
        age_rating: 18,
        related_releases: [],
        recommended_releases: [],
        profile_list_status: 3,
        vote_1_count: 0,
        vote_2_count: 0,
        vote_3_count: 0,
        vote_4_count: 0,
        vote_5_count: 10,
        vote_count: 10,
        screenshot_images: [],
        comments: [],
        note: '',
        watching_count: 100,
        plan_count: 50,
        completed_count: 200,
        hold_on_count: 10,
        dropped_count: 5,
        is_favorite: true,
        my_vote: 5, // 5 out of 5
        comment_per_day_count: 2,
    };

    // Serializer rejects unmapped external IDs
    assert.throws(() => serializeToMalXml({
        profile: { id: 777, login: 'Tymofii' },
        // @ts-expect-error test missing externalId
        entries: [{ anime: mockAnime1, status: 3 }],
    }));

    const xml = serializeToMalXml({
        profile: { id: 777, login: 'Tymofii' },
        entries: [
            { anime: mockAnime1, status: 3, externalId: 16498 }, // Completed with verified external ID
        ],
    });

    assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
    assert.ok(xml.includes('<user_name>Tymofii</user_name>'));
    assert.ok(xml.includes('<user_total_anime>1</user_total_anime>'));
    assert.ok(xml.includes('<series_animedb_id>16498</series_animedb_id>'));
    assert.ok(!xml.includes('<series_animedb_id>101</series_animedb_id>'));
    assert.ok(xml.includes('<series_title><![CDATA[Shingeki no Kyojin]]></series_title>'));
    assert.ok(xml.includes('<series_title_ru><![CDATA[Атака титанов]]></series_title_ru>'));
    assert.ok(xml.includes('<my_score>10</my_score>')); // 5 stars -> 10 MAL score
    assert.ok(xml.includes('<my_status>Completed</my_status>'));
    assert.ok(xml.includes('<anixart_id>101</anixart_id>'));
    assert.ok(xml.includes('<update_on_import>1</update_on_import>'));

    // Roundtrip test
    const parsed = parseMalXml(xml);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].sourceId, 16498);
    assert.equal(parsed[0].anixartId, 101);
    assert.equal(parsed[0].title, 'Shingeki no Kyojin');
    assert.equal(parsed[0].titleRu, 'Атака титанов');
    assert.equal(parsed[0].anixartScore, 5);
    assert.equal(parsed[0].anixartStatus, 3);
});

test('jsonSerializer and jsonParser: supports native Shikimori JSON schema and roundtrips', () => {
    const mockAnime = {
        id: 202,
        title_ru: 'Человек-бензопила',
        title_original: 'Chainsaw Man',
        episodes_released: 12,
        episodes_total: 12,
        category: { name: 'TV' },
        your_vote: 4,
    };

    // Serializer rejects unmapped external IDs
    assert.throws(() => serializeToShikimoriJson({
        // @ts-expect-error missing externalId
        entries: [{ anime: mockAnime, status: 1 }],
    }));

    const jsonStr = serializeToShikimoriJson({
        // @ts-expect-error mock entry
        entries: [{ anime: mockAnime, status: 1, externalId: 44511 }],
    });

    const parsedArray = JSON.parse(jsonStr);
    assert.equal(parsedArray.length, 1);
    assert.equal(parsedArray[0].target_id, 44511);
    assert.equal(parsedArray[0].target_type, 'Anime');
    assert.equal(parsedArray[0].target_title, 'Chainsaw Man');
    assert.equal(parsedArray[0].target_title_ru, 'Человек-бензопила');
    assert.equal(parsedArray[0].status, 'watching');
    assert.equal(parsedArray[0].score, 8); // 4 stars -> 8 MAL/Shikimori score
    assert.equal(parsedArray[0].anixart_id, 202);

    // Parse back with jsonParser
    const items = parseShikimoriJson(jsonStr);
    assert.equal(items.length, 1);
    assert.equal(items[0].sourceId, 44511);
    assert.equal(items[0].anixartId, 202);
    assert.equal(items[0].title, 'Chainsaw Man');
    assert.equal(items[0].anixartStatus, 1);
    assert.equal(items[0].anixartScore, 4);
});

test('jsonParser: accepts empty notes from native Shikimori exports and rejects invalid note types', () => {
    const record = { target_title: 'Great Teacher Onizuka', target_title_ru: 'Крутой учитель Онидзука', target_id: 245, target_type: 'Anime', score: 0, status: 'watching', rewatches: 0, episodes: 0, text: null };
    const [item] = parseShikimoriJson(JSON.stringify([record]));
    assert.equal(item.title, record.target_title);
    assert.equal(item.sourceId, 245);
    assert.equal(item.anixartStatus, 1);
    assert.equal(item.anixartScore, 0);
    assert.equal(item.text, undefined);
    assert.equal(parseShikimoriJson(JSON.stringify([{ ...record, text: 'My note' }]))[0].text, 'My note');
    for (const text of [123, false, {}, []]) {
        assert.throws(() => parseShikimoriJson(JSON.stringify([{ ...record, text }])), /Invalid text/);
    }
});

test('matcher: normalizes titles while preserving season and type identity', () => {
    assert.equal(normalizeTitle('Shingeki no Kyojin (TV)'), 'shingeki no kyojin tv');
    assert.equal(normalizeTitle('Bleach: Thousand-Year Blood War - Season 2'), 'bleach thousand year blood war season 2');
    assert.ok(areTitlesEquivalent('Steins;Gate', 'steins gate'));
    assert.equal(areTitlesEquivalent('Spy x Family (TV)', 'Spy x Family'), false);
    assert.equal(areTitlesEquivalent('Example Season 2', 'Example Season 1'), false);
    assert.equal(areTitlesEquivalent('Naruto', 'One Piece'), false);
});

test('matcher: matchItem resolves explicit Anixart ID without guessing', async () => {
    const fakeAnime = {
        id: 555,
        title_ru: 'Врата Штейна',
        title_original: 'Steins;Gate',
        profile_list_status: 1, // Watching
        your_vote: 4,
    };

    const mockApi = {
        get: async (url) => {
            if (url === '/release/555') return { code: 0, release: fakeAnime };
            return { code: 1 };
        },
        post: async () => ({ code: 0, releases: [] }),
    };

    const parsedItem = {
        id: 'test_1',
        sourceId: 9253,
        title: 'Steins;Gate',
        titleRu: 'Врата Штейна',
        episodesWatched: 24,
        rawScore: 8,
        anixartScore: 4,
        rawStatus: 'Completed',
        anixartStatus: 3, // Target is Completed
        anixartId: 555,
    };

    // @ts-expect-error mock api
    const matched = await matchItem(parsedItem, mockApi);

    assert.equal(matched.matchState, 'matched');
    assert.equal(matched.matchedRelease?.id, 555);
    assert.equal(matched.currentListStatus, 1);
    assert.equal(matched.hasConflict, true); // Status in Anixart is 1, but XML says 3
});

test('matcher: matchItem detects ambiguous candidates and flags as candidate (no blind match)', async () => {
    const candidates = [
        { id: 1, title_ru: 'Магическая битва', title_original: 'Jujutsu Kaisen' },
        { id: 2, title_ru: 'Магическая битва', title_original: 'Jujutsu Kaisen' },
    ];

    const mockApi = {
        get: async () => ({ code: 1 }),
        post: async () => ({ code: 0, releases: candidates }),
    };

    const parsedItem = {
        id: 'test_2',
        sourceId: 40748,
        title: 'Jujutsu Kaisen',
        episodesWatched: 24,
        rawScore: 9,
        anixartScore: 5,
        rawStatus: 'Completed',
        anixartStatus: 3,
    };

    // @ts-expect-error mock api
    const result = await matchItem(parsedItem, mockApi);

    // Ambiguous candidates flag as 'candidate' for user confirmation (no blind match)
    assert.equal(result.matchState, 'candidate');
    assert.equal(result.matchedRelease, null);
    assert.equal(result.resolutionCandidates.length, 2);
});

test('transferRunner: executes bounded sequential updates with progress and rate limits', async () => {
    const calls = [];
    const mockApi = {
        get: async (url) => {
            calls.push(url);
            return { code: 0 };
        },
    };

    const items = [
        {
            id: 'row_1',
            sourceId: 1,
            title: 'Anime 1',
            episodesWatched: 12,
            rawScore: 10,
            anixartScore: 5,
            rawStatus: 'Completed',
            anixartStatus: 3,
            matchState: 'matched',
            matchedRelease: { id: 101, title_ru: 'Аниме 1', profile_list_status: 0 },
            resolutionCandidates: [],
            isSkipped: false,
        },
        {
            id: 'row_2',
            sourceId: 2,
            title: 'Anime 2',
            episodesWatched: 0,
            rawScore: 0,
            anixartScore: 0,
            rawStatus: 'Plan to Watch',
            anixartStatus: 2,
            matchState: 'matched',
            matchedRelease: { id: 102, title_ru: 'Аниме 2', profile_list_status: 0 },
            resolutionCandidates: [],
            isSkipped: false,
        },
        {
            id: 'row_3',
            sourceId: 3,
            title: 'Anime 3',
            episodesWatched: 0,
            rawScore: 0,
            anixartScore: 0,
            rawStatus: 'Plan to Watch',
            anixartStatus: 2,
            matchState: 'matched',
            matchedRelease: { id: 103, title_ru: 'Аниме 3', profile_list_status: 0 },
            resolutionCandidates: [],
            isSkipped: true, // Should be skipped!
        },
    ];

    const progressReports = [];

    // @ts-expect-error mock api
    const result = await runImport({
        // @ts-expect-error test items
        items,
        options: {
            applyStatus: true,
            applyScore: true,
            overwriteStatusOnConflict: false,
        },
        // @ts-expect-error mock api
        api: mockApi,
        onProgress: (p) => progressReports.push(p.processed),
    });

    assert.equal(result.total, 2); // 3 items minus 1 skipped
    assert.equal(result.succeeded, 2);
    assert.equal(result.failed, 0);

    // Verify calls made
    assert.ok(calls.includes('/profile/list/add/3/101'));
    assert.ok(calls.includes('/release/vote/add/101/5'));
    assert.ok(calls.includes('/profile/list/add/2/102'));
    assert.ok(!calls.some(c => c.includes('103'))); // Skipped item was not called
});

test('transferRunner: isolates item failures without crashing queue and supports cancellation', async () => {
    const mockApi = {
        get: async (url) => {
            if (url.includes('101')) throw new Error('Network error on 101');
            return { code: 0 };
        },
    };

    const items = [
        {
            id: 'f_1',
            sourceId: 1,
            title: 'Failing Item',
            episodesWatched: 0,
            rawScore: 0,
            anixartScore: 0,
            rawStatus: 'Watching',
            anixartStatus: 1,
            matchState: 'matched',
            matchedRelease: { id: 101, title_ru: 'Fail' },
            resolutionCandidates: [],
            isSkipped: false,
        },
        {
            id: 'f_2',
            sourceId: 2,
            title: 'Succeeding Item',
            episodesWatched: 0,
            rawScore: 0,
            anixartScore: 0,
            rawStatus: 'Watching',
            anixartStatus: 1,
            matchState: 'matched',
            matchedRelease: { id: 102, title_ru: 'Success' },
            resolutionCandidates: [],
            isSkipped: false,
        },
    ];

    // @ts-expect-error mock api
    const result = await runImport({
        // @ts-expect-error test items
        items,
        options: {
            applyStatus: true,
            applyScore: false,
            overwriteStatusOnConflict: false,
        },
        // @ts-expect-error mock api
        api: mockApi,
    });

    assert.equal(result.total, 2);
    assert.equal(result.succeeded, 1);
    assert.equal(result.failed, 1);
    assert.equal(result.errors.length, 1);
    assert.equal(result.errors[0].id, 'f_1');
    assert.equal(result.errors[0].error, 'Network error on 101');
});

test('triggerDownload: creates anchor, removes anchor even on click failure, and defers URL revocation with bounded timer', () => {
    const clicks = [];
    const createdElements = [];
    const revokedUrls = [];
    const scheduledTimeouts = [];

    const origWindow = globalThis.window;
    const origDocument = globalThis.document;
    const origUrl = globalThis.URL;

    try {
        globalThis.window = {
            setTimeout: (fn, delay) => {
                scheduledTimeouts.push({ fn, delay });
                return scheduledTimeouts.length;
            },
        };
        globalThis.URL.createObjectURL = () => 'blob:http://localhost/fake-xml-uuid';
        globalThis.URL.revokeObjectURL = (u) => revokedUrls.push(u);

        const mockBody = {
            appendChild: (el) => {
                el.parentNode = mockBody;
                createdElements.push(el);
            },
            removeChild: (el) => {
                el.parentNode = null;
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
                        parentNode: null,
                        click: () => clicks.push(el.download),
                    };
                    return el;
                }
                return {};
            },
        };

        // 1. Normal successful download
        triggerDownload('<xml>test</xml>', 'export.xml', 'application/xml');

        assert.equal(clicks.length, 1);
        assert.equal(clicks[0], 'export.xml');
        assert.equal(createdElements.length, 0, 'anchor must be removed after click');
        assert.equal(revokedUrls.length, 0, 'URL revocation must be deferred, not synchronous');
        assert.equal(scheduledTimeouts.length, 1);
        assert.equal(scheduledTimeouts[0].delay, 60_000);

        // Fast-forward bounded timer
        scheduledTimeouts[0].fn();
        assert.equal(revokedUrls.length, 1);
        assert.equal(revokedUrls[0], 'blob:http://localhost/fake-xml-uuid');

        // 2. Failure case: click() throws
        const throwingAnchor = {
            tag: 'a',
            href: '',
            download: '',
            style: {},
            parentNode: null,
            click: () => { throw new Error('Simulated DOM click error'); },
        };
        globalThis.document.createElement = () => throwingAnchor;

        assert.throws(
            () => triggerDownload('<xml>error</xml>', 'error.xml', 'application/xml'),
            /Simulated DOM click error/
        );
        assert.equal(createdElements.length, 0, 'anchor must be removed even when click fails');
        assert.equal(scheduledTimeouts.length, 2, 'deferred cleanup must still be scheduled on failure');
        scheduledTimeouts[1].fn();
        assert.equal(revokedUrls.length, 2);
    } finally {
        globalThis.window = origWindow;
        globalThis.document = origDocument;
        globalThis.URL = origUrl;
    }
});
