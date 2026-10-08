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
function adapter(fetch) {
    return new Function('getStoredUserToken', 'parseRoomSession', 'fetch', code + '\nreturn { joinWatchRoom };')(
        () => 'fixture-account-token', parseRoomSession, fetch,
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
