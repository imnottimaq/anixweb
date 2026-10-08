import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { createUpscalerScope } from '../src/shared/upscalerScope.ts';
import { PlaybackBridge } from '../src/shared/playbackBridge.ts';

// Execute the actual component and its event/effect callbacks with deterministic
// hook, media and socket doubles. No DOM layout, CDN or GPU driver is simulated.
const source = readFileSync(new URL('../src/pages/PlayerScreen.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('player.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const component = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'PlayerContent');
const hookNames = { useState: [], useRef: [] };
function collect(node) {
    if (ts.isVariableDeclaration(node) && node.initializer && ts.isCallExpression(node.initializer)) {
        const name = node.initializer.expression.getText(ast);
        if (hookNames[name]) hookNames[name].push(ts.isArrayBindingPattern(node.name)
            ? node.name.elements[0].getText(ast) : node.name.getText(ast));
    }
    ts.forEachChild(node, collect);
}
collect(component);
const code = ts.transpileModule(component.getText(ast), {
    compilerOptions: { target: ts.ScriptTarget.ES2023, jsx: ts.JsxEmit.React },
}).outputText;
const sources = { '1080': [{ src: 'high.mp4', type: 'video/mp4' }], '720': [{ src: 'low.mp4', type: 'video/mp4' }] };
const media = { releaseId: 1, dubId: 3, sourceId: 4, episode: 1, releaseName: 'Anime', episodeName: 'One' };
const room = overrides => ({ roomId: 'room', hostId: 99, syncEpoch: 1, media, participants: [{profileId:7,canControl:true}], playback: { position: 0, paused: true, intent:'paused', rate: 1.5, updatedAt:0 }, ...overrides });

function harness(options = {}) {
    const state = {}, refs = {}, effects = [], navigation = [], sessions = [], saved = [], sockets = [];
    let stateIndex = 0, refIndex = 0, tree, sessionCleared = false;
    const video = {
        currentTime: 0, duration: 1500, videoWidth: 1920, videoHeight: 1080,
        paused: true, ended: false, seeking: false, buffered: {length:1,start:()=>0,end:()=>1500}, error: null, readyState: 0, playbackRate: 1, playCalls: 0,
        play() { this.paused = false; this.playCalls++; return Promise.resolve(); },
        pause() { this.paused = true; }, canPlayType() { return ''; },
        removeAttribute() {}, load() { this.currentTime = 0; this.paused = true; },
    };
    const settings = { player: { defaultQuality: 'auto', volume: 60, qualityUpgrade: false },
        content: { rememberEpisodeTime: true } };
    const props = { playerSession: { sources, animeId: 1, animeName: 'Anime', episodeNumber: 1,
        dubId: 3, sourceId: 4, episodes: [{ position: 1, name: 'One', url: 'one' }, { position: 2, name: 'Two', url: 'two' }] },
        onSessionChange: session => sessions.push(session), roomId: options.roomId ?? null };
    class Socket {
        constructor() { sockets.push(this); }
        connect(_id, _participant, onState) { this.onState = onState; }
        send() {} disconnect() {}
    }
    const env = {
        useState(initial) {
            const name = hookNames.useState[stateIndex++];
            if (!(name in state)) state[name] = typeof initial === 'function' ? initial() : initial;
            return [state[name], value => { state[name] = typeof value === 'function' ? value(state[name]) : value; }];
        },
        useRef(initial) {
            const name = hookNames.useRef[refIndex++];
            return refs[name] ??= { current: initial };
        },
        useMemo: fn => fn(), useCallback: fn => fn, useEffect: fn => effects.push(fn),
        useNavigate: () => path => navigation.push(path),
        useSettings: () => ({ settings, setSettings: fn => Object.assign(settings, fn(settings)) }),
        useTranslation: () => ({ t: key => key }), useUser: () => ({ userToken: '', userId: 7 }),
        useApi: () => ({ get: async () => ({ code: 0 }) }), useRoomPresence: () => ({ room: options.roomId ? (options.room ?? room()) : null, self: options.self ?? null, status: 'connected', send: async payload => sockets.push(payload), serverNow: () => 0 }),
        PlaybackBridge, RoomPanel: () => null,
        canUseAnime4KVideo: () => false, isSafariBrowser: () => false, WatchRoomSocket: Socket, getRoomParticipant: () => ({}),
        getWatchProgress: () => ({ '1': { '1': 120, '2': 90 } }),
        saveWatchProgress: (...args) => saved.push(args),
        clearPlayerSession: () => { sessionCleared = true; },
        extractVideoLinks: options.extract ?? (async () => sources),
        Hls: { isSupported: () => false }, HLS_MIME_TYPE: 'application/x-mpegURL',
        ASPECT_RATIOS: { original: null, '16:9': 16 / 9 }, PLAYBACK_RATES: [1, 1.5],
        defaultPlayerKeybindings: {}, styles: {}, formatTime: String,
        window: { innerWidth: 1280, innerHeight: 720, setInterval: () => 1, clearInterval() {}, setTimeout: () => 1 },
        React: { createElement: (tag, props, ...children) => ({ tag, props: { ...props, children } }) },
    };
    for (const name of ['Play','Pause','Prev','Next','Back','Skip','Expand','Compress','Settings','VolumeMax','VolumeMute']) env[name + 'Icon'] = name;
    // The component's imports are explicit test doubles; its body is unchanged.
    const run = new Function(...Object.keys(env), code + '\nreturn PlayerContent;')(...Object.values(env));
    function render() {
        stateIndex = refIndex = 0;
        effects.length = 0;
        tree = run(props);
        refs.videoRef.current = video;
        return tree;
    }
    function find(predicate, node) {
        if (arguments.length === 1) node = tree;
        if (!node || typeof node !== 'object') return;
        if (Array.isArray(node)) { for (const child of node) { const match = find(predicate, child); if (match) return match; } }
        else { if (predicate(node)) return node; if (node.props?.children) return find(predicate, node.props.children); }
    }
    const effect = text => {
        const fn = effects.find(fn => fn.toString().includes(text));
        assert.ok(fn, `effect containing ${text}`);
        return fn();
    };
    render();
    return { state, refs, video, settings, props, render, find, effect, effects, navigation, sessions, saved, sockets,
        get sessionCleared() { return sessionCleared; },
        event(name) { find(node => node.tag === 'video').props[name]({ currentTarget: video }); },
    };
}

test('saved progress waits for a decision through repeated canplay events', () => {
    const h = harness(); h.effect('setCurrentTime(0)');
    h.event('onLoadedMetadata'); h.event('onCanPlay'); h.event('onCanPlay');
    assert.equal(h.state.resumePromptTime, 120);
    assert.equal(h.video.playCalls, 0);
    h.render();
    h.find(node => node.tag === 'button' && node.props.children[0] === 'misc.continue').props.onClick();
    assert.equal(h.video.currentTime, 120);
    assert.equal(h.state.resumePromptTime, null);
    assert.equal(h.video.playCalls, 1);
});

test('initial playback starts once when no progress needs a decision', () => {
    const h = harness(); h.settings.content.rememberEpisodeTime = false;
    h.effect('setCurrentTime(0)'); h.event('onLoadedMetadata'); h.event('onCanPlay'); h.event('onCanPlay');
    assert.equal(h.video.playCalls, 1);
});

for (const paused of [true, false]) test(`manual quality change preserves time and paused=${paused}`, () => {
    const h = harness(); const cleanup = h.effect('setCurrentTime(0)');
    h.video.currentTime = 321; h.video.paused = paused;
    h.state.isPlayerSettingsOpen = true; h.render();
    h.find(node => node.tag === 'button' && node.props.children[0] === '720p').props.onClick();
    cleanup(); h.render(); h.effect('setCurrentTime(0)');
    h.event('onLoadedMetadata'); h.event('onCanPlay');
    assert.equal(h.video.currentTime, 321);
    assert.equal(h.video.paused, paused);
    h.video.play(); h.event('onCanPlay');
    assert.equal(h.video.paused, false, 'later canplay does not undo a user play action');
});

test('revisiting an episode offers its saved position again', () => {
    const h = harness(); h.effect('setCurrentTime(0)'); h.event('onLoadedMetadata');
    h.props.playerSession = { ...h.props.playerSession, episodeNumber: 2 }; h.render();
    h.effect('setCurrentTime(0)'); h.event('onLoadedMetadata'); assert.equal(h.state.resumePromptTime, 90);
    h.props.playerSession = { ...h.props.playerSession, episodeNumber: 1 }; h.render();
    h.effect('setCurrentTime(0)'); h.event('onLoadedMetadata'); assert.equal(h.state.resumePromptTime, 120);
});

test('native errors fall back, then show an error when qualities are exhausted', () => {
    const h = harness(); h.video.currentTime = 55; h.video.error = { code: 4 };
    h.event('onError'); assert.equal(h.state.fallbackQuality, '720');
    assert.equal(h.refs.fallbackPositionRef.current.time, 55);
    h.render(); h.event('onError'); assert.equal(h.state.streamError, 'player.streamUnavailable');
    assert.equal(h.state.isBuffering, false);
});

test('intentional media aborts do not switch quality', () => {
    const h = harness(); h.video.error = { code: 1 }; h.event('onError');
    assert.equal(h.state.fallbackQuality, null);
});

test('room speed remains synchronized in controls and after metadata loads', () => {
    const h = harness({ roomId: 'room' }); h.video.readyState = 3;
    h.effect('new PlaybackBridge');
    h.event('onLoadedMetadata');
    assert.equal(h.video.playbackRate, 1.5);
    h.render(); h.event('onLoadedMetadata'); h.event('onCanPlay');
    assert.equal(h.video.playbackRate, 1.5); assert.equal(h.video.paused, true);
    assert.equal(h.state.resumePromptTime, null);
});

test('native room playback events never send user commands', () => {
    const h = harness({ roomId: 'room' });
    h.event('onPlay'); h.event('onPause');
    assert.deepEqual(h.sockets, []);
});

test('controller can pause during a room loading barrier without local play', () => {
    const h = harness({roomId:'room', room:room({playback:{position:0,paused:true,intent:'playing',rate:1,updatedAt:0}})});
    const button = h.find(node => node.tag === 'button' && node.props['aria-label'] === 'player.pause');
    assert.equal(button.props.disabled, false); button.props.onClick();
    assert.deepEqual(h.sockets, [{type:'pause',position:0}]); assert.equal(h.video.playCalls, 0);
});

test('control checks use server verified identity rather than cached profile', () => {
    const h = harness({roomId:'room',self:{profileId:33,login:'Verified'},room:room({participants:[{profileId:33,canControl:true}]})});
    h.find(node => node.tag === 'button' && node.props['aria-label'] === 'player.play').props.onClick();
    assert.deepEqual(h.sockets, [{type:'play',position:0}]);
});

test('room back action is accessible and returns to management without leaving', () => {
    const h = harness({roomId:'room'});
    const back = h.find(node => node.tag === 'button' && node.props['aria-label'] === 'room.return');
    assert.equal(back.props.children[0].props.alt, ''); back.props.onClick();
    assert.deepEqual(h.navigation, ['/together/room']); assert.deepEqual(h.sockets, []);
});

test('viewing registration waits for confirmed member state and retries new media version', async () => {
    const outer = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'PlayerScreen');
    const body = outer.getText(ast).replace('export default ', '');
    const code = ts.transpileModule(body, {compilerOptions:{target:ts.ScriptTarget.ES2023,jsx:ts.JsxEmit.React}}).outputText;
    const values = [], refs = [], effects = [], requests = [], api = {};
    let si = 0, ri = 0;
    const presence = {room:null,activeRoomId:'room',status:'connected',self:{profileId:33},send:async command => {
        requests.push(command); throw new Error('STALE_MEDIA');
    }};
    const env = {
        useState: initial => { const id=si++; if (!(id in values)) values[id]=typeof initial==='function'?initial():initial; return [values[id],()=>{}]; },
        useRef: initial => refs[ri++] ??= {current:initial}, useEffect: fn=>effects.push(fn),useCallback:fn=>fn,
        getPlayerSession:()=>null,useSearchParams:()=>[new URLSearchParams('room=room')],useRoomPresence:()=>presence,
        useUser:()=>({userId:7}),useApi:()=>api,useNavigate:()=>()=>{},RoomPanel:()=>null,styles:{},
        React:{createElement:()=>({})},
    };
    const run = new Function(...Object.keys(env),code+'\nreturn PlayerScreen;')(...Object.values(env));
    const register = () => {
        si=ri=0;effects.length=0;run();
        effects.find(fn=>fn.toString().includes("viewing: true"))();
    };
    register(); assert.deepEqual(requests, []);
    presence.room={...room(),mediaVersion:1,participants:[{profileId:33,viewing:false}]};
    register(); assert.equal(requests.length,1);
    presence.room={...presence.room,mediaVersion:2};
    register(); assert.equal(requests.length,2);
    presence.room={...presence.room,participants:[{profileId:33,viewing:true}]};
    register(); assert.equal(requests.length,2,'existing viewer must not reset readiness');
    await Promise.resolve();
});

test('read-only viewer controls cannot change room position or playback', () => {
    const h = harness({ roomId: 'room', room: room({participants:[]}) });
    const play = h.find(node => node.tag === 'button' && node.props['aria-label'] === 'player.play');
    assert.equal(play.props.disabled, true); play.props.onClick();
    assert.equal(h.video.playCalls, 0); assert.deepEqual(h.sockets, []);
    const slider = h.find(node => node.tag === 'input' && node.props.step === '0.1');
    assert.equal(slider.props.disabled, true); slider.props.onChange({currentTarget:{value:90}});
    assert.equal(h.video.currentTime, 0); assert.deepEqual(h.sockets, []);
});

test('closing during extraction cannot restore the session', async () => {
    let resolve;
    const h = harness({ extract: () => new Promise(done => { resolve = done; }) });
    const next = h.find(node => node.tag === 'button' && node.props.children[0]?.props?.src === 'Next');
    next.props.onClick();
    h.find(node => node.tag === 'button' && node.props.onClick?.toString().includes('saveEpisodeTime')).props.onClick();
    assert.equal(h.sessionCleared, true);
    resolve(sources); await new Promise(done => setImmediate(done));
    assert.deepEqual(h.sessions, []);
});

test('unmount during extraction discards its result', async () => {
    let resolve;
    const h = harness({ extract: () => new Promise(done => { resolve = done; }) });
    const cleanup = h.effect('playerClosedRef.current = false');
    h.find(node => node.tag === 'button' && node.props.children[0]?.props?.src === 'Next').props.onClick();
    cleanup(); resolve(sources); await new Promise(done => setImmediate(done));
    assert.deepEqual(h.sessions, []);
});

test('waiting on the resume prompt does not overwrite saved progress', () => {
    const h = harness(); h.event('onLoadedMetadata');
    const cleanup = h.effect('window.setInterval(saveEpisodeTime'); cleanup();
    assert.deepEqual(h.saved, []);
});

test('upscaler cancels existing frames and restores the real video method', async () => {
    const pending = new Map(), cancelled = []; let next = 0;
    const video = { requestVideoFrameCallback: fn => { pending.set(++next, fn); return next; }, cancelVideoFrameCallback: id => cancelled.push(id) };
    const scope = createUpscalerScope(video);
    await scope.initialize(async () => video.requestVideoFrameCallback(() => assert.fail('disposed frame ran')));
    scope.dispose(); pending.get(1)(0, {});
    assert.deepEqual(cancelled, [1]);
    assert.equal(next, 1);
    video.requestVideoFrameCallback(() => {}); assert.equal(next, 2);
});

test('late GPU initialization is destroyed and cannot overtake the next renderer', async () => {
    let release, destroyed = 0, frames = 0; const order = [];
    const video = { requestVideoFrameCallback: () => ++frames, cancelVideoFrameCallback() {} };
    const scope = createUpscalerScope(video);
    const task = scope.initialize(async () => {
        await new Promise(done => { release = done; });
        order.push('old');
        assert.equal(video.requestVideoFrameCallback(() => {}), 0);
        scope.useDevice({ destroy: () => destroyed++ });
    });
    await Promise.resolve(); scope.dispose();
    const next = createUpscalerScope(video);
    const nextTask = next.initialize(async () => { order.push('new'); video.requestVideoFrameCallback(() => {}); });
    assert.deepEqual(order, []); release();
    await assert.rejects(task, /Upscaler disposed/);
    await nextTask;
    assert.deepEqual(order, ['old', 'new']); assert.equal(destroyed, 1); assert.equal(frames, 1);
    next.dispose();
});

test('active GPU devices are destroyed on disposal', () => {
    let destroyed = 0;
    const scope = createUpscalerScope({ requestVideoFrameCallback() {}, cancelVideoFrameCallback() {} });
    scope.useDevice({ destroy: () => destroyed++ });
    scope.dispose(); scope.dispose(); assert.equal(destroyed, 1);
});
