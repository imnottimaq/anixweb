import assert from 'node:assert/strict';
import test from 'node:test';
import {
    isOpfsSupported,
    saveDownloadedEpisode,
    getDownloadedEpisodes,
    getDownloadedEpisodeBlob,
    deleteDownloadedEpisode,
    clearAllDownloads,
    getStorageEstimate,
} from '../src/shared/storage/opfsStorage.ts';

test('isOpfsSupported returns a boolean', () => {
    const supported = isOpfsSupported();
    assert.equal(typeof supported, 'boolean');
});

test('saveDownloadedEpisode stores video and metadata, and getDownloadedEpisodes retrieves it', async () => {
    await clearAllDownloads();

    const sampleBlob = new Blob(['sample-mp4-video-content-here'], { type: 'video/mp4' });
    const meta = await saveDownloadedEpisode({
        releaseId: 42,
        releaseTitle: 'Test Anime',
        episodeNumber: 1,
        episodeName: 'The Beginning',
        quality: '720',
        filename: 'Test_Anime_01.mp4',
        blob: sampleBlob,
    });

    assert.ok(meta.id.startsWith('dl_42_ep1_'));
    assert.equal(meta.releaseId, 42);
    assert.equal(meta.releaseTitle, 'Test Anime');
    assert.equal(meta.episodeNumber, 1);
    assert.equal(meta.episodeName, 'The Beginning');
    assert.equal(meta.quality, '720');
    assert.equal(meta.fileSize, sampleBlob.size);

    const list = await getDownloadedEpisodes();
    assert.equal(list.length, 1);
    assert.equal(list[0].id, meta.id);
    assert.equal(list[0].releaseTitle, 'Test Anime');

    // Retrieve blob
    const retrievedBlob = await getDownloadedEpisodeBlob(meta.id);
    assert.ok(retrievedBlob);
    const text = await retrievedBlob.text();
    assert.equal(text, 'sample-mp4-video-content-here');

    // Storage estimate
    const estimate = await getStorageEstimate();
    assert.ok(estimate);
    assert.ok(estimate.usage >= sampleBlob.size);

    // Delete episode
    const deleted = await deleteDownloadedEpisode(meta.id);
    assert.equal(deleted, true);

    const emptyList = await getDownloadedEpisodes();
    assert.equal(emptyList.length, 0);

    const missingBlob = await getDownloadedEpisodeBlob(meta.id);
    assert.equal(missingBlob, null);
});

test('clearAllDownloads removes all saved episodes', async () => {
    await clearAllDownloads();

    const blob1 = new Blob(['video-1'], { type: 'video/mp4' });
    const blob2 = new Blob(['video-2'], { type: 'video/mp4' });

    await saveDownloadedEpisode({
        releaseId: 100,
        releaseTitle: 'Show A',
        episodeNumber: 1,
        filename: 'show_a_1.mp4',
        blob: blob1,
    });

    await saveDownloadedEpisode({
        releaseId: 200,
        releaseTitle: 'Show B',
        episodeNumber: 5,
        filename: 'show_b_5.mp4',
        blob: blob2,
    });

    let list = await getDownloadedEpisodes();
    assert.equal(list.length, 2);

    await clearAllDownloads();

    list = await getDownloadedEpisodes();
    assert.equal(list.length, 0);
});
