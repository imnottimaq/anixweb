import { useEffect, useState, type SetStateAction, type Dispatch } from 'react';
import { useFeedMemoryKey } from './useFeedNavigation';

const drafts = new Map<string, { value: unknown; savedAt: number }>();
/** Keep unsaved form state when Back returns from another feed screen; never persist it to storage. */
export function useFeedDraftState<T>(scope: string, initial: T | (() => T)): [T, Dispatch<SetStateAction<T>>] {
    const key = useFeedMemoryKey(`draft:${scope}`);
    const [value, setValue] = useState<T>(() => {
        const saved = drafts.get(key);
        return saved && Date.now() - saved.savedAt < 10 * 60 * 1000 ? saved.value as T : typeof initial === 'function' ? (initial as () => T)() : initial;
    });
    useEffect(() => {
        drafts.set(key, { value, savedAt: Date.now() });
        if (drafts.size > 60) drafts.delete(drafts.keys().next().value!);
    }, [key, value]);
    return [value, setValue];
}
