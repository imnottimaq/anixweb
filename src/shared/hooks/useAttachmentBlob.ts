import { useEffect, useRef, useState, useCallback } from 'react';
import { getRoomAttachment } from '../watchRoom';
import { useUser } from '../contexts/userContext';

const activeAllocatedUrls = new Set<string>();
const roomAllocatedUrls = new Map<string, Set<string>>();

function revokeAllocatedUrl(url: string | null | undefined): void {
    if (!url) return;
    try {
        URL.revokeObjectURL(url);
    } catch {
        // Ignore
    }
    activeAllocatedUrls.delete(url);
    for (const [room, set] of roomAllocatedUrls) {
        set.delete(url);
        if (!set.size) roomAllocatedUrls.delete(room);
    }
}

function registerAllocatedUrl(url: string, roomId?: string): void {
    activeAllocatedUrls.add(url);
    if (roomId) {
        let set = roomAllocatedUrls.get(roomId);
        if (!set) {
            set = new Set();
            roomAllocatedUrls.set(roomId, set);
        }
        set.add(url);
    }
}

export function clearAllAttachmentBlobs(): void {
    for (const url of Array.from(activeAllocatedUrls)) {
        try {
            URL.revokeObjectURL(url);
        } catch {
            // Ignore
        }
    }
    activeAllocatedUrls.clear();
    roomAllocatedUrls.clear();
}

export function clearRoomAttachmentBlobs(roomId: string): void {
    const set = roomAllocatedUrls.get(roomId);
    if (set) {
        for (const url of Array.from(set)) {
            try {
                URL.revokeObjectURL(url);
            } catch {
                // Ignore
            }
            activeAllocatedUrls.delete(url);
        }
        roomAllocatedUrls.delete(roomId);
    }
}

export function useAttachmentBlob(
    roomId: string | undefined,
    attachmentId: string | undefined,
    options: { lazy?: boolean } = {}
) {
    const { userToken } = useUser();
    const [resolved, setResolved] = useState<{url: string; roomId: string; attachmentId: string; userToken: string} | null>(null);
    const [loading, setLoading] = useState<boolean>(!options.lazy && Boolean(roomId && attachmentId));
    const [error, setError] = useState<string | null>(null);
    const [triggered, setTriggered] = useState<boolean>(!options.lazy);

    const abortControllerRef = useRef<AbortController | null>(null);
    const currentUrlRef = useRef<string | null>(null);

    const trigger = useCallback(() => {
        setTriggered(true);
    }, []);

    const performFetch = useCallback(async (signal?: AbortSignal) => {
        if (!roomId || !attachmentId) {
            setResolved(null);
            setLoading(false);
            return;
        }

        setLoading(true);
        setError(null);

        try {
            const blob = await getRoomAttachment(roomId, attachmentId, signal);
            if (signal?.aborted) return;
            const newUrl = URL.createObjectURL(blob);
            registerAllocatedUrl(newUrl, roomId);

            if (currentUrlRef.current && currentUrlRef.current !== newUrl) {
                revokeAllocatedUrl(currentUrlRef.current);
            }
            currentUrlRef.current = newUrl;
            setResolved({url: newUrl, roomId, attachmentId, userToken});
            setLoading(false);
        } catch (err: unknown) {
            if (signal?.aborted) return;
            setLoading(false);
            const msg = err instanceof Error ? err.message : 'FAILED_TO_LOAD';
            setError(msg);
        }
    }, [roomId, attachmentId, userToken]);

    const retry = useCallback(async () => {
        abortControllerRef.current?.abort();
        const ac = new AbortController();
        abortControllerRef.current = ac;
        await performFetch(ac.signal);
    }, [performFetch]);

    useEffect(() => {
        if (!triggered || !roomId || !attachmentId) {
            return;
        }

        abortControllerRef.current?.abort();
        const ac = new AbortController();
        abortControllerRef.current = ac;

        void Promise.resolve().then(() => {
            if (!ac.signal.aborted) {
                return performFetch(ac.signal);
            }
        });

        const urlRef = currentUrlRef;
        return () => {
            ac.abort();
            abortControllerRef.current?.abort();
            if (urlRef.current) {
                revokeAllocatedUrl(urlRef.current);
                urlRef.current = null;
            }
        };
    }, [triggered, roomId, attachmentId, userToken, performFetch]);

    return {
        url: resolved && resolved.roomId === roomId && resolved.attachmentId === attachmentId && resolved.userToken === userToken ? resolved.url : null,
        loading,
        error,
        trigger,
        retry,
    };
}
