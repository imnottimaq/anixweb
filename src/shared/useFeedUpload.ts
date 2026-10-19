import { useEffect, useRef } from 'react';
import { useFeedAction } from './useFeedAction';

export function useFeedUpload() {
    const action = useFeedAction();
    const active = useRef<AbortController | null>(null);
    useEffect(() => () => active.current?.abort(), []);
    function run<T>(operation: (signal: AbortSignal) => Promise<T>, success: (result: T) => void) {
        return action.run(async () => {
            const controller = new AbortController(); active.current = controller;
            const result = await operation(controller.signal);
            controller.signal.throwIfAborted();
            return result;
        }, success);
    }
    return { ...action, run };
}
