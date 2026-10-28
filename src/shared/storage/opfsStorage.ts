import { formatBytes } from '../player/download.ts';

export interface StoredEpisodeMetadata {
    id: string;
    releaseId: number;
    releaseTitle: string;
    releaseTitleRu?: string;
    episodeNumber: number;
    episodeName?: string;
    quality?: string;
    filename: string;
    fileSize: number;
    downloadedAt: number;
    posterUrl?: string;
    duration?: number;
}

export interface SaveEpisodeParams {
    id?: string;
    releaseId: number;
    releaseTitle: string;
    releaseTitleRu?: string;
    episodeNumber: number;
    episodeName?: string;
    quality?: string;
    filename: string;
    blob: Blob;
    size?: number;
    posterUrl?: string;
    duration?: number;
    fetchFn?: typeof fetch;
}

export interface StorageEstimateResult {
    usage: number;
    quota: number;
    formattedUsage: string;
    formattedQuota: string;
    percentUsed: number;
}

const OPFS_DIR_NAME = 'anix_downloads';
const METADATA_FILE_NAME = 'metadata.json';
const LOCAL_STORAGE_KEY = 'anix_downloads_meta_v1';
const IDB_DB_NAME = 'anix_downloads_db';
const IDB_VERSION = 1;

// In-memory fallback for test environments or restricted browsers
const memoryBlobs = new Map<string, Blob>();
let memoryMetadata: StoredEpisodeMetadata[] = [];

export function isOpfsSupported(): boolean {
    return typeof navigator !== 'undefined'
        && Boolean(navigator.storage)
        && typeof navigator.storage.getDirectory === 'function';
}

async function getOpfsDirectory(): Promise<FileSystemDirectoryHandle | null> {
    if (!isOpfsSupported()) return null;
    try {
        const root = await navigator.storage.getDirectory();
        return await root.getDirectoryHandle(OPFS_DIR_NAME, { create: true });
    } catch {
        return null;
    }
}

// IndexedDB Fallback
function openIdb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        if (typeof indexedDB === 'undefined') {
            reject(new Error('IndexedDB is not available'));
            return;
        }
        const request = indexedDB.open(IDB_DB_NAME, IDB_VERSION);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains('episodes')) {
                db.createObjectStore('episodes');
            }
            if (!db.objectStoreNames.contains('metadata')) {
                db.createObjectStore('metadata', { keyPath: 'id' });
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function saveToIdb(id: string, blob: Blob, meta: StoredEpisodeMetadata): Promise<void> {
    const db = await openIdb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(['episodes', 'metadata'], 'readwrite');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.objectStore('episodes').put(blob, id);
        tx.objectStore('metadata').put(meta);
    });
}

async function getBlobFromIdb(id: string): Promise<Blob | null> {
    try {
        const db = await openIdb();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('episodes', 'readonly');
            const req = tx.objectStore('episodes').get(id);
            req.onsuccess = () => resolve((req.result as Blob) || null);
            req.onerror = () => reject(req.error);
        });
    } catch {
        return null;
    }
}

async function getAllFromIdb(): Promise<StoredEpisodeMetadata[]> {
    try {
        const db = await openIdb();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('metadata', 'readonly');
            const req = tx.objectStore('metadata').getAll();
            req.onsuccess = () => resolve((req.result as StoredEpisodeMetadata[]) || []);
            req.onerror = () => reject(req.error);
        });
    } catch {
        return [];
    }
}

async function deleteFromIdb(id: string): Promise<void> {
    try {
        const db = await openIdb();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(['episodes', 'metadata'], 'readwrite');
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
            tx.objectStore('episodes').delete(id);
            tx.objectStore('metadata').delete(id);
        });
    } catch {
        // Ignore delete errors
    }
}

async function clearIdb(): Promise<void> {
    try {
        const db = await openIdb();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(['episodes', 'metadata'], 'readwrite');
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
            tx.objectStore('episodes').clear();
            tx.objectStore('metadata').clear();
        });
    } catch {
        // Ignore
    }
}

// LocalStorage mirror for instant metadata reading
function getLocalStorageMetadata(): StoredEpisodeMetadata[] {
    if (typeof localStorage === 'undefined') return memoryMetadata;
    try {
        const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function setLocalStorageMetadata(metadata: StoredEpisodeMetadata[]): void {
    if (typeof localStorage === 'undefined') {
        memoryMetadata = metadata;
        return;
    }
    try {
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(metadata));
    } catch {
        // Storage full or unavailable
    }
}

async function cachePosterAsDataUrl(url?: string, fetchFn: typeof fetch = fetch): Promise<string | undefined> {
    if (!url) return undefined;
    if (url.startsWith('data:')) return url;
    try {
        const res = await fetchFn(url);
        if (!res.ok) return undefined;
        const blob = await res.blob();
        return await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    } catch {
        return undefined;
    }
}

/**
 * Saves a downloaded video blob to OPFS (or fallback) along with episode metadata.
 */
export async function saveDownloadedEpisode(params: SaveEpisodeParams): Promise<StoredEpisodeMetadata> {
    const id = params.id || `dl_${params.releaseId}_ep${params.episodeNumber}_${Date.now()}`;
    const fileSize = params.size || params.blob.size;
    const downloadedAt = Date.now();

    // Cache poster as data URL for offline display
    let posterDataUrl = params.posterUrl;
    if (posterDataUrl && !posterDataUrl.startsWith('data:')) {
        const cached = await cachePosterAsDataUrl(posterDataUrl, params.fetchFn);
        if (cached) posterDataUrl = cached;
    }

    const meta: StoredEpisodeMetadata = {
        id,
        releaseId: params.releaseId,
        releaseTitle: params.releaseTitle,
        releaseTitleRu: params.releaseTitleRu,
        episodeNumber: params.episodeNumber,
        episodeName: params.episodeName,
        quality: params.quality,
        filename: params.filename,
        fileSize,
        downloadedAt,
        posterUrl: posterDataUrl,
        duration: params.duration,
    };

    let saved = false;
    const dir = await getOpfsDirectory();
    if (dir) {
        try {
            const videoFileName = `${id}.mp4`;
            const fileHandle = await dir.getFileHandle(videoFileName, { create: true });
            if (typeof fileHandle.createWritable === 'function') {
                const writable = await fileHandle.createWritable();
                await writable.write(params.blob);
                await writable.close();
                saved = true;
            }
        } catch (err) {
            console.warn('OPFS write failed, attempting IndexedDB fallback:', err);
        }
    }

    if (!saved) {
        try {
            await saveToIdb(id, params.blob, meta);
            saved = true;
        } catch {
            // Memory fallback for tests
            memoryBlobs.set(id, params.blob);
        }
    }

    // Update metadata list
    const existing = await getDownloadedEpisodes();
    const updated = [meta, ...existing.filter(e => e.id !== id)];
    setLocalStorageMetadata(updated);

    // Also persist metadata.json in OPFS
    if (dir) {
        try {
            const metaFile = await dir.getFileHandle(METADATA_FILE_NAME, { create: true });
            if (typeof metaFile.createWritable === 'function') {
                const writable = await metaFile.createWritable();
                await writable.write(JSON.stringify(updated));
                await writable.close();
            }
        } catch {
            // Ignore metadata file error
        }
    }

    return meta;
}

/**
 * Returns all downloaded episodes from OPFS / localStorage mirror.
 */
export async function getDownloadedEpisodes(): Promise<StoredEpisodeMetadata[]> {
    const cached = getLocalStorageMetadata();
    if (cached.length > 0) return cached;

    // Check OPFS metadata.json
    const dir = await getOpfsDirectory();
    if (dir) {
        try {
            const metaFile = await dir.getFileHandle(METADATA_FILE_NAME);
            const file = await metaFile.getFile();
            const text = await file.text();
            const parsed = JSON.parse(text);
            if (Array.isArray(parsed)) {
                setLocalStorageMetadata(parsed);
                return parsed;
            }
        } catch {
            // No metadata file yet
        }
    }

    // Check IndexedDB
    const fromIdb = await getAllFromIdb();
    if (fromIdb.length > 0) {
        setLocalStorageMetadata(fromIdb);
        return fromIdb;
    }

    return memoryMetadata;
}

/**
 * Loads the episode video Blob from OPFS (or fallback) for playback.
 */
export async function getDownloadedEpisodeBlob(id: string): Promise<Blob | null> {
    const dir = await getOpfsDirectory();
    if (dir) {
        try {
            const videoFileName = `${id}.mp4`;
            const fileHandle = await dir.getFileHandle(videoFileName);
            return await fileHandle.getFile();
        } catch {
            // Not in OPFS, try IndexedDB
        }
    }

    const fromIdb = await getBlobFromIdb(id);
    if (fromIdb) return fromIdb;

    return memoryBlobs.get(id) || null;
}

/**
 * Deletes a downloaded episode from OPFS and removes its metadata.
 */
export async function deleteDownloadedEpisode(id: string): Promise<boolean> {
    const dir = await getOpfsDirectory();
    if (dir) {
        try {
            const videoFileName = `${id}.mp4`;
            await dir.removeEntry(videoFileName);
        } catch {
            // Ignore entry removal failure
        }
    }

    await deleteFromIdb(id);
    memoryBlobs.delete(id);

    // Update metadata
    const existing = await getDownloadedEpisodes();
    const updated = existing.filter(e => e.id !== id);
    setLocalStorageMetadata(updated);

    if (dir) {
        try {
            const metaFile = await dir.getFileHandle(METADATA_FILE_NAME, { create: true });
            if (typeof metaFile.createWritable === 'function') {
                const writable = await metaFile.createWritable();
                await writable.write(JSON.stringify(updated));
                await writable.close();
            }
        } catch {
            // Ignore
        }
    }

    return true;
}

/**
 * Removes all downloaded episodes and metadata from device storage.
 */
export async function clearAllDownloads(): Promise<void> {
    const dir = await getOpfsDirectory();
    if (dir) {
        try {
            const entries: string[] = [];
            for await (const entry of (dir as unknown as { values(): AsyncIterable<{ name: string }> }).values()) {
                entries.push(entry.name);
            }
            for (const name of entries) {
                await dir.removeEntry(name).catch(() => {});
            }
        } catch {
            // Ignore
        }
    }

    await clearIdb();
    memoryBlobs.clear();
    memoryMetadata = [];
    setLocalStorageMetadata([]);
}

/**
 * Queries storage quota and usage.
 */
export async function getStorageEstimate(): Promise<StorageEstimateResult | null> {
    if (typeof navigator === 'undefined' || !navigator.storage || typeof navigator.storage.estimate !== 'function') {
        const episodes = await getDownloadedEpisodes();
        const totalSize = episodes.reduce((acc, curr) => acc + (curr.fileSize || 0), 0);
        return {
            usage: totalSize,
            quota: 10 * 1024 * 1024 * 1024,
            formattedUsage: formatBytes(totalSize),
            formattedQuota: formatBytes(10 * 1024 * 1024 * 1024),
            percentUsed: 0,
        };
    }

    try {
        const estimate = await navigator.storage.estimate();
        const usage = estimate.usage || 0;
        const quota = estimate.quota || 1;
        const percentUsed = Math.min(100, Math.round((usage / quota) * 100));
        return {
            usage,
            quota,
            formattedUsage: formatBytes(usage),
            formattedQuota: formatBytes(quota),
            percentUsed,
        };
    } catch {
        return null;
    }
}
