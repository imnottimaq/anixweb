import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { PlaybackBridge, roomPlaybackPosition } from '../src/shared/playbackBridge.ts';

function setup() {
    let now = 10_000;
    const commands = [], errors = [];
    const video = {
        currentTime: 10, duration: 1500, readyState: 4, seeking: false, paused: true,
        playbackRate: 1, buffered: { length: 1, start: () => 0, end: () => 1500 },
        playCalls: 0, play() { this.paused = false; this.playCalls++; return Promise.resolve(); },
        pause() { this.paused = true; },
    };
    const state = {
        syncEpoch: 1, media: { releaseId: 1 },
        playback: { position: 10, rate: 1, updatedAt: 10_000, paused: false, intent: 'playing' },
    };
    const bridge = new PlaybackBridge(video, async payload => commands.push(payload), () => now, message => errors.push(message));
    bridge.loadedMetadata();
    return { video, state, bridge, commands, errors, setNow(value) { now = value; } };
}

test('anchor position accounts for elapsed server time and shared speed', () => {
    const h = setup(); h.state.playback.rate = 1.5;
    assert.equal(roomPlaybackPosition(h.state, 12_000), 13);
    h.state.playback.paused = true;
    assert.equal(roomPlaybackPosition(h.state, 12_000), 10);
});

test('correction ignores small drift, adjusts medium drift, seeks large drift', () => {
    const h = setup(); h.bridge.update(h.state, true);
    h.video.currentTime = 9.9; h.bridge.synchronize(); assert.equal(h.video.playbackRate, 1);
    h.video.currentTime = 9.5; h.bridge.synchronize(); assert.equal(h.video.playbackRate, 1.05);
    h.video.currentTime = 10.5; h.bridge.synchronize(); assert.equal(h.video.playbackRate, .95);
    h.video.currentTime = 8; h.bridge.synchronize(); assert.equal(h.video.currentTime, 10);
    h.video.currentTime = 10; h.bridge.synchronize(); assert.equal(h.video.playbackRate, 1);
});

test('new seek epoch is immediate even for medium drift and pauses remain authoritative', () => {
    const h = setup(); h.bridge.update(h.state, true);
    h.state.syncEpoch++; h.state.playback.position = 10.4; h.state.playback.paused = true;
    h.bridge.update(h.state, true);
    assert.equal(h.video.currentTime, 10.4); assert.equal(h.video.paused, true);
    assert.ok(h.commands.every(command => !['play', 'pause', 'seek'].includes(command.type)));
});

test('ready is sent once per epoch only after seek and target buffering finish', () => {
    const h = setup(); h.video.seeking = true; h.bridge.update(h.state, true);
    assert.deepEqual(h.commands, []);
    h.video.seeking = false; h.video.readyState = 2; h.bridge.synchronize();
    assert.deepEqual(h.commands, []);
    h.video.readyState = 4; h.video.buffered.end = () => 9; h.bridge.synchronize();
    assert.deepEqual(h.commands, []);
    h.video.buffered.end = () => 1500; h.bridge.synchronize(); h.bridge.synchronize();
    assert.deepEqual(h.commands, [{ type: 'ready', epoch: 1 }]);
});

test('late viewer catches moving anchor before ready and later stalls can report again', () => {
    const h = setup(); h.video.readyState = 2; h.bridge.update(h.state, true);
    h.bridge.buffering(); h.bridge.buffering(); assert.equal(h.commands.length, 1);
    h.setNow(17_000); h.video.readyState = 4; h.video.currentTime = 10;
    h.bridge.synchronize(); assert.equal(h.video.currentTime, 17);
    assert.deepEqual(h.commands[1], { type: 'ready', epoch: 1 });
    h.video.readyState = 2; h.bridge.buffering();
    assert.deepEqual(h.commands[2], { type: 'buffering', epoch: 1 });
});

test('disconnect and disposal pause playback and stop sending readiness', () => {
    const h = setup(); h.bridge.update(h.state, true); assert.equal(h.video.paused, false);
    h.bridge.update(h.state, false); assert.equal(h.video.paused, true);
    const count = h.commands.length; h.bridge.buffering(); h.bridge.error('failure');
    assert.equal(h.commands.length, count);
    h.bridge.dispose(); h.bridge.update(h.state, true); h.bridge.synchronize();
    assert.equal(h.video.paused, true); assert.equal(h.commands.length, count);
});

test('replacement source cannot report ready using old metadata', () => {
    const h = setup(); const commands = [];
    const bridge = new PlaybackBridge(h.video, async payload => commands.push(payload), () => 10_000, () => {});
    bridge.update(h.state, true); bridge.synchronize();
    assert.deepEqual(commands, []); assert.equal(h.video.playCalls, 0);
    bridge.loadedMetadata(); assert.deepEqual(commands, [{type:'ready',epoch:1}]);
});

test('ended video does not replay final frames while waiting for host', () => {
    const h = setup(); h.video.ended = true; h.video.currentTime = 1500;
    h.state.playback.position = 1500; h.bridge.update(h.state, true);
    assert.equal(h.video.currentTime, 1500); assert.equal(h.video.playCalls, 0);
    h.state.syncEpoch++; h.state.playback.position = 100;
    h.bridge.update(h.state, true); assert.equal(h.video.currentTime, 100);
});

function loadResolver(extract) {
    const source = readFileSync(new URL('../src/shared/mediaResolver.ts', import.meta.url), 'utf8');
    const body = source.replace(/^import .*;\r?\n/gm, '').replace('export async function', 'async function');
    const code = ts.transpileModule(body, { compilerOptions: { target: ts.ScriptTarget.ES2023 } }).outputText;
    return new Function('extractVideoLinks', code + '\nreturn resolveRoomMedia;')(extract);
}
const media = { releaseId: 1, releaseName: 'Anime', dubId: 3, sourceId: 4, episode: 2, episodeName: 'Two' };

test('resolver uses full media IDs, abort signal and upstream episode list', async () => {
    const signal = new AbortController().signal;
    const sources = { '720': [{ src: 'video.mp4' }] };
    const resolve = loadResolver(async (url, usedSignal) => { assert.equal(url, 'two'); assert.equal(usedSignal, signal); return sources; });
    const session = await resolve({ get: async (path, init) => {
        assert.equal(path, '/episode/1/3/4'); assert.equal(init.signal, signal);
        return { episodes: [{position: 1, name: 'One', url: 'one'}, {position: 2, name: 'Two', url: 'two'}] };
    } }, media, signal);
    assert.equal(session.dubId, 3); assert.equal(session.sourceId, 4); assert.equal(session.episodeNumber, 2);
    assert.equal(session.episodes.length, 2); assert.equal(session.sources, sources);
});

test('aborted extraction is discarded even if upstream ignores AbortSignal', async () => {
    const controller = new AbortController(); let complete;
    const resolve = loadResolver(() => new Promise(done => { complete = done; }));
    const task = resolve({get: async () => ({episodes:[{...media, position:2, name:'Two',url:'two'}]})}, media, controller.signal);
    await Promise.resolve(); controller.abort(); complete({'720':[{src:'video.mp4'}]});
    await assert.rejects(task, { name: 'AbortError' });
});

test('missing media never silently selects a different episode', async () => {
    const resolve = loadResolver(() => assert.fail('must not extract a missing episode'));
    await assert.rejects(resolve({get: async () => ({episodes:[]})}, media, new AbortController().signal));
});
