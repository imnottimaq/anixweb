import { useEffect, useRef, useState } from 'react';

export function useFeedAction() {
    const [pending, setPending] = useState(false);
    const [error, setError] = useState(false);
    const alive = useRef(true), lock = useRef(false);
    useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
    async function run<T>(operation: () => Promise<T>, success?: (result: T) => void) {
        if (lock.current) return;
        lock.current = true; setPending(true); setError(false);
        try { const result = await operation(); if (alive.current) success?.(result); }
        catch { if (alive.current) setError(true); }
        finally { lock.current = false; if (alive.current) setPending(false); }
    }
    return { pending, error, run };
}

