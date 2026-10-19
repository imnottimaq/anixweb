import { useLayoutEffect, useRef } from 'react';
import { useLocation, useNavigate, useNavigationType } from 'react-router-dom';
import { useUser } from './contexts/userContext';
import { trailOf, positions, remember } from './feedNavigationState';
import { activateFeedMemory } from './feedPageMemory';

export function useFeedMemoryKey(scope: string) {
    const { userToken } = useUser();
    const { key } = useLocation();
    activateFeedMemory(userToken);
    return `${userToken}:${key}:${scope}`;
}

/** Saving replaces an editor rather than adding it to the reader's Back stack. */
export function useFeedSavedNavigation() {
    const location = useLocation(), navigate = useNavigate();
    return (to: string) => {
        const trail = trailOf(location.state), parent = trail.at(-1);
        const index: unknown = window.history.state?.idx;
        if (parent?.to === to && parent.index !== null && typeof index === 'number' && index === parent.index + 1) navigate(-1);
        else navigate(to, { replace: true, state: { feedTrail: trail } });
    };
}

/** Restore after cached list data renders, and adjust for images loading above the saved position. */
export function useFeedPosition(ready = true) {
    const location = useLocation(), navigation = useNavigationType();
    const lastY = useRef(0);
    useLayoutEffect(() => {
        if (!ready) return;
        const previousMode = window.history.scrollRestoration;
        window.history.scrollRestoration = 'manual';
        const saved = navigation === 'POP' ? positions.get(location.key) : undefined;
        let restoring = true;
        const restore = () => {
            if (location.hash) return;
            const target = saved ?? 0;
            window.scrollTo(0, target);
            lastY.current = window.scrollY;
        };
        restore();
        const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => { if (restoring) restore(); }) : null;
        observer?.observe(document.body);
        const finish = () => { restoring = false; observer?.disconnect(); };
        const timer = window.setTimeout(finish, 2500);
        const record = () => { lastY.current = window.scrollY; remember(location.key, lastY.current); };
        const interrupt = () => finish();
        window.addEventListener('scroll', record, { passive: true });
        window.addEventListener('wheel', interrupt, { passive: true });
        window.addEventListener('touchstart', interrupt, { passive: true });
        window.addEventListener('keydown', interrupt);
        return () => {
            remember(location.key, lastY.current);
            window.clearTimeout(timer); observer?.disconnect();
            window.removeEventListener('scroll', record); window.removeEventListener('wheel', interrupt);
            window.removeEventListener('touchstart', interrupt); window.removeEventListener('keydown', interrupt);
            window.history.scrollRestoration = previousMode;
        };
    }, [location.key, location.hash, navigation, ready]);
}
