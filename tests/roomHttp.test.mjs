import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { parseRoomSession } from '../src/shared/roomSession.ts';

// Execute the actual HTTP adapter with boundary doubles, including old Worker
// text404 responses. Permanent failures must preserve their HTTP classification.
const source = readFileSync(new URL('../src/shared/watchRoom.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('watchRoom.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const body = ast.statements.filter(node => !ts.isImportDeclaration(node) && !ts.isExportDeclaration(node))
    .map(node => node.getText(ast)).join('\n').replaceAll('import.meta.env.VITE_ROOM_SERVER_URL', '"http://room.test"');
const code = ts.transpileModule(body, { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext } }).outputText
    .replaceAll('export ', '');

function adapter(fetch, options = {}) {
    let currentToken = options.token ?? 'fixture-account-token';
    let currentCandidateId = options.candidateId !== undefined ? options.candidateId : 1;
    const getToken = typeof options.getToken === 'function' ? options.getToken : () => currentToken;
    const getCandidate = typeof options.getCandidate === 'function' ? options.getCandidate : () => currentCandidateId;
    const resolveCandidate = typeof options.resolveCandidate === 'function' ? options.resolveCandidate : async () => currentCandidateId;

    return new Function(
        'getStoredUserToken',
        'parseRoomSession',
        'getCandidateProfileId',
        'resolveCandidateProfileId',
        'fetch',
        code + '\nreturn { joinWatchRoom, createWatchRoom, getAuthenticatedRoomProfile, authenticate };'
    )(
        getToken,
        parseRoomSession,
        getCandidate,
        resolveCandidate,
        fetch,
    );
}

for (const status of [400, 401, 403, 404, 410, 503]) test(`non-JSON ${status} preserves status for reconnect decisions`, async () => {
    const http = adapter(async () => new Response('Old backend or gateway error', { status }));
    await assert.rejects(http.joinWatchRoom('room'), error => error.status === status && error.message === `HTTP ${status}`);
});

test('JSON API failures preserve explicit server codes', async () => {
    const http = adapter(async () => Response.json({ code: 'AUTH_UNAVAILABLE' }, { status: 503 }));
    await assert.rejects(http.joinWatchRoom('room'), error => error.status === 503 && error.message === 'AUTH_UNAVAILABLE');
});

test('POST payload sends validated candidate profileId and token to /api/v2/session', async () => {
    const calls = [];
    const validSession = {
        session: 'signed.session.token',
        expiresAt: Date.now() + 900_000,
        profile: { profileId: 42, login: 'VerifiedUser', avatar: null },
    };

    const http = adapter(async (url, init) => {
        calls.push({ url: String(url), method: init?.method, headers: init?.headers, body: init?.body ? JSON.parse(init.body) : null });
        if (String(url).endsWith('/api/v2/session')) {
            return Response.json(validSession);
        }
        if (String(url).endsWith('/api/v2/rooms/join')) {
            return Response.json({ roomId: 'test-room', ticket: 'valid-ticket' });
        }
        return new Response('Not found', { status: 404 });
    }, { candidateId: 42, token: 'user-token-abc' });

    const result = await http.joinWatchRoom('test-room');
    assert.equal(result.ticket, 'valid-ticket');

    const sessionCall = calls.find(c => c.url.endsWith('/api/v2/session'));
    assert.ok(sessionCall, 'Expected call to /api/v2/session');
    assert.equal(sessionCall.method, 'POST');
    assert.deepEqual(sessionCall.body, { token: 'user-token-abc', profileId: 42 });
});

test('missing identity surfaces actionable ROOM_IDENTITY_REQUIRED error, not 503', async () => {
    let fetchCalled = false;
    const http = adapter(async () => {
        fetchCalled = true;
        return new Response('Unexpected fetch', { status: 500 });
    }, { candidateId: null });

    await assert.rejects(http.joinWatchRoom('room'), error => error.message === 'ROOM_IDENTITY_REQUIRED');
    assert.equal(fetchCalled, false, 'Fetch should not be attempted when candidate identity is missing');
});

test('missing token surfaces actionable ROOM_SIGN_IN error', async () => {
    let fetchCalled = false;
    const http = adapter(async () => {
        fetchCalled = true;
        return new Response('Unexpected fetch', { status: 500 });
    }, { token: '' });

    await assert.rejects(http.joinWatchRoom('room'), error => error.message === 'ROOM_SIGN_IN');
    assert.equal(fetchCalled, false);
});

test('singleflight deduplicates concurrent session requests', async () => {
    let sessionFetchCount = 0;
    const validSession = {
        session: 'singleflight.session',
        expiresAt: Date.now() + 900_000,
        profile: { profileId: 10, login: 'SingleflightUser', avatar: null },
    };

    const http = adapter(async (url) => {
        if (String(url).endsWith('/api/v2/session')) {
            sessionFetchCount++;
            await new Promise(r => setTimeout(r, 20));
            return Response.json(validSession);
        }
        if (String(url).endsWith('/api/v2/rooms/join')) {
            return Response.json({ roomId: 'room1', ticket: 'ticket1' });
        }
        return new Response('Not found', { status: 404 });
    }, { candidateId: 10, token: 'token-10' });

    // Launch concurrent join calls sharing the same unauthenticated state
    const [res1, res2] = await Promise.all([
        http.joinWatchRoom('room1'),
        http.joinWatchRoom('room1'),
    ]);

    assert.equal(res1.ticket, 'ticket1');
    assert.equal(res2.ticket, 'ticket1');
    assert.equal(sessionFetchCount, 1, 'Concurrent calls must share single in-flight session request');
});

test('account switching while session request in-flight rejects with ROOM_ACCOUNT_CHANGED', async () => {
    let activeToken = 'initial-token';
    let activeCandidateId = 1;
    const validSession = {
        session: 'account.session',
        expiresAt: Date.now() + 900_000,
        profile: { profileId: 1, login: 'User1', avatar: null },
    };

    const http = adapter(async (url) => {
        if (String(url).endsWith('/api/v2/session')) {
            // User logs into another account while the session request is in flight
            activeToken = 'new-account-token';
            activeCandidateId = 2;
            return Response.json(validSession);
        }
        return Response.json({ roomId: 'room', ticket: 'ticket' });
    }, {
        getToken: () => activeToken,
        getCandidate: () => activeCandidateId,
        resolveCandidate: async () => activeCandidateId,
    });

    await assert.rejects(http.joinWatchRoom('room'), error => error.message === 'ROOM_ACCOUNT_CHANGED');
});
