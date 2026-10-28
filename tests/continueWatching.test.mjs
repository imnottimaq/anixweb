import assert from 'node:assert/strict';
import test from 'node:test';
import {
    getContinueWatchingList,
    saveContinueWatchingItem,
    removeContinueWatchingItem,
} from '../src/shared/watchProgress.ts';

function createMockStorage() {
    let store = {};
    return {
        getItem: key => store[key] ?? null,
        setItem: (key, value) => { store[key] = String(value); },
        removeItem: key => { delete store[key]; },
        clear: () => { store = {}; },
    };
}

test('continue watching: save, retrieve, update, and remove items', () => {
    const mock = createMockStorage();
    globalThis.localStorage = mock;

    // Initially empty
    assert.deepEqual(getContinueWatchingList(), []);

    // Ignore items under 5 seconds
    saveContinueWatchingItem({
        animeId: 101,
        title: 'Attack on Titan',
        image: 'https://example.com/aot.jpg',
        episodeNumber: 1,
        episodeName: 'To You, in 2000 Years',
        seconds: 3,
        duration: 1400,
    });
    assert.deepEqual(getContinueWatchingList(), []);

    // Save valid item
    saveContinueWatchingItem({
        animeId: 101,
        title: 'Attack on Titan',
        image: 'https://example.com/aot.jpg',
        episodeNumber: 1,
        episodeName: 'To You, in 2000 Years',
        seconds: 300,
        duration: 1400,
    });

    let list = getContinueWatchingList();
    assert.equal(list.length, 1);
    assert.equal(list[0].animeId, 101);
    assert.equal(list[0].seconds, 300);
    assert.equal(list[0].image, 'https://example.com/aot.jpg');

    // Add another anime
    saveContinueWatchingItem({
        animeId: 102,
        title: 'Frieren',
        image: 'https://example.com/frieren.jpg',
        episodeNumber: 3,
        episodeName: 'The End of the Journey',
        seconds: 450,
        duration: 1420,
    });

    list = getContinueWatchingList();
    assert.equal(list.length, 2);
    // Newest is first
    assert.equal(list[0].animeId, 102);
    assert.equal(list[1].animeId, 101);

    // Updating existing anime preserves image if omitted and moves to top
    saveContinueWatchingItem({
        animeId: 101,
        title: 'Attack on Titan',
        episodeNumber: 2,
        seconds: 600,
        duration: 1400,
    });

    list = getContinueWatchingList();
    assert.equal(list.length, 2);
    assert.equal(list[0].animeId, 101);
    assert.equal(list[0].image, 'https://example.com/aot.jpg');
    assert.equal(list[0].seconds, 600);
    assert.equal(list[0].episodeNumber, 2);

    // Finished item (>= 95% duration) is automatically removed
    saveContinueWatchingItem({
        animeId: 101,
        title: 'Attack on Titan',
        seconds: 1350,
        duration: 1400,
    });
    list = getContinueWatchingList();
    assert.equal(list.length, 1);
    assert.equal(list[0].animeId, 102);

    // Explicit remove
    removeContinueWatchingItem(102);
    assert.deepEqual(getContinueWatchingList(), []);
});
