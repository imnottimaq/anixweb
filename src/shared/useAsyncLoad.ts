import { useCallback, useEffect, useState, type DependencyList } from 'react';

type UseAsyncLoadOptions<T> = {
    enabled?: boolean;
    initialData?: T;
};

export function useAsyncLoad<T>(request: (signal: AbortSignal) => Promise<T>, dependencies: DependencyList, options: UseAsyncLoadOptions<T> = {}) {
    const { enabled = true, initialData } = options;
    const [data, setData] = useState<T | undefined>(initialData);
    const [error, setError] = useState<unknown>(null);
    const [isLoading, setIsLoading] = useState(enabled);
    const [reloadIndex, setReloadIndex] = useState(0);

    const reload = useCallback(() => setReloadIndex(index => index + 1), []);

    useEffect(() => {
        if (!enabled) return;

        let isCurrent = true;
        const controller = new AbortController();
        void Promise.resolve()
            .then(() => {
                if (isCurrent) {
                    setIsLoading(true);
                    setError(null);
                }
                return request(controller.signal);
            })
            .then(result => {
                if (isCurrent) setData(result);
            })
            .catch(requestError => {
                if (isCurrent && !controller.signal.aborted) setError(requestError);
            })
            .finally(() => {
                if (isCurrent) setIsLoading(false);
            });

        return () => {
            isCurrent = false;
            controller.abort();
        };
    // `request` intentionally receives its dependencies separately, so callers can use inline async functions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [...dependencies, enabled, reloadIndex]);

    return { data, error, isLoading: enabled && isLoading, reload };
}
