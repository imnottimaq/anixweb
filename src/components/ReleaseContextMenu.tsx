import { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation } from 'react-router-dom';
import { useUser } from '../shared/contexts/userContext';
import { ReleaseActionsContext, type ReleasePatch } from '../shared/contexts/releaseActionsContext';
import { useApi } from '../shared/apiClient';
import { useTranslation } from '../shared/useTranslation';
import type { Anime } from '../shared/types/api';
import styles from './ReleaseContextMenu.module.css';
import ActionIcon from './ActionIcon';

type MenuTarget = {id: number; name: string; x: number; y: number; trigger: HTMLAnchorElement; serial: number; initial: ReleasePatch | null};
const STATUS_KEYS = ['releaseMenu.removeList', 'status.watching', 'status.planned', 'status.watched', 'status.hold_on', 'status.dropped'] as const;
export default function ReleaseActionsProvider({children}: {children: ReactNode}) {
    const {userToken} = useUser();
    return <ReleaseActionsSession key={userToken}>{children}</ReleaseActionsSession>;
}
function ReleaseActionsSession({children}: {children: ReactNode}) {
    const location = useLocation();
    const [routeKey, setRouteKey] = useState(location.key);
    const [menu, setMenu] = useState<MenuTarget | null>(null);
    const [patches, setPatches] = useState<Record<number, ReleasePatch>>({});
    const pendingRef = useRef(new Set<number>());
    const [pending, setPending] = useState<ReadonlySet<number>>(new Set());
    const listeners = useRef(new Set<() => void>());
    const mounted = useRef(false);
    const serial = useRef(0);
    useEffect(() => {mounted.current = true; return () => {mounted.current = false;};}, []);
    if (routeKey !== location.key) {setRouteKey(location.key); setMenu(null); setPatches({});}
    const publish = useCallback((id: number, patch: ReleasePatch, changed = false) => {
        if (!mounted.current) return;
        setPatches(previous => ({...previous, [id]: patch}));
        if (changed) for (const listener of listeners.current) listener();
    }, []);
    const subscribe = useCallback((listener: () => void) => {
        listeners.current.add(listener); return () => {listeners.current.delete(listener);};
    }, []);
    const begin = useCallback((id: number) => {
        if (!mounted.current || pendingRef.current.has(id)) return false;
        pendingRef.current.add(id); setPending(new Set(pendingRef.current)); return true;
    }, []);
    const finish = useCallback((id: number) => {
        pendingRef.current.delete(id);
        if (mounted.current) setPending(new Set(pendingRef.current));
    }, []);
    const closeMenu = useCallback(() => setMenu(null), []);
    const value = useMemo(() => ({patches, pending, begin, finish, publish, subscribe}), [patches, pending, begin, finish, publish, subscribe]);
    const open = (target: EventTarget | null, x?: number, y?: number) => {
        const link = target instanceof Element ? target.closest<HTMLAnchorElement>('a[href]') : null;
        if (!link || link.origin !== window.location.origin) return false;
        const match = link.pathname.match(/\/anime\/([1-9]\d*)\/?$/);
        if (!match) return false;
        const id = Number(match[1]);
        if (!Number.isSafeInteger(id)) return false;
        const status = link.dataset.releaseListStatus;
        const favorite = link.dataset.releaseFavorite;
        const parsedStatus = status === undefined ? NaN : Number(status);
        const initial = patches[id] ?? (Number.isInteger(parsedStatus) && parsedStatus >= 0 && parsedStatus <= 5 && (favorite === 'true' || favorite === 'false')
            ? {profile_list_status: parsedStatus, is_favorite: favorite === 'true'} : null);
        const rect = link.getBoundingClientRect();
        setMenu({id, name: link.querySelector<HTMLImageElement>('img[alt]')?.alt || link.textContent?.trim() || String(id), x: x || rect.left + 20, y: y || rect.top + 20, trigger: link, serial: ++serial.current, initial});
        return true;
    };
    return <ReleaseActionsContext.Provider value={value}>
        <div style={{display:'contents'}} onContextMenu={event => {
            if (!event.defaultPrevented && open(event.target, event.clientX, event.clientY)) {event.preventDefault(); event.stopPropagation();}
        }} onKeyDown={event => {
            if ((event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) && open(event.target)) {event.preventDefault(); event.stopPropagation();}
        }}>
            {children}
            {menu && createPortal(<ReleaseContextMenu key={menu.serial} target={menu} onClose={closeMenu}/>, document.body)}
        </div>
    </ReleaseActionsContext.Provider>;
}
function ReleaseContextMenu({target, onClose}: {target: MenuTarget; onClose: () => void}) {
    const {userToken} = useUser();
    const api = useApi();
    const {t} = useTranslation();
    const {patches, publish, pending, begin, finish} = useContext(ReleaseActionsContext)!;
    const locked = pending.has(target.id);
    const root = useRef<HTMLDivElement>(null);
    const moveButton = useRef<HTMLButtonElement>(null);
    const alive = useRef(false);
    const inFlight = useRef(false);
    const [loaded, setLoaded] = useState<ReleasePatch | null>(target.initial);
    const data = patches[target.id] ?? loaded;
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<'load' | 'save' | null>(null);
    const [attempt, setAttempt] = useState(0);
    const [expanded, setExpanded] = useState(false);
    const needsLoad = Boolean(userToken && !data);
    const loading = needsLoad && error !== 'load';
    const close = () => {onClose(); if (target.trigger.isConnected) target.trigger.focus();};
    useEffect(() => {
        alive.current = true;
        const onPointerDown = (event: PointerEvent) => {if (!root.current?.contains(event.target as Node)) onClose();};
        const onScroll = (event: Event) => {if (!root.current?.contains(event.target as Node)) onClose();};
        window.addEventListener('pointerdown', onPointerDown, true);
        window.addEventListener('scroll', onScroll, true);
        window.addEventListener('resize', onClose);
        return () => {alive.current = false; window.removeEventListener('pointerdown', onPointerDown, true); window.removeEventListener('scroll', onScroll, true); window.removeEventListener('resize', onClose);};
    }, [onClose]);
    useEffect(() => {
        if (!needsLoad || locked) return;
        const controller = new AbortController();
        // Defer the fallback until effect replay has finished. StrictMode's
        // cancelled first setup must never issue a request or publish an error.
        void Promise.resolve().then(() => {
            if (controller.signal.aborted) return;
            return api.get<{release: Anime}>(`/release/${target.id}`, {signal:controller.signal, cache:'no-store'});
        }).then(result => {
            if (controller.signal.aborted || !result) return;
            const release = result.release;
            if (!release || release.id !== target.id || typeof release.is_favorite !== 'boolean' || !Number.isInteger(release.profile_list_status) || release.profile_list_status < 0 || release.profile_list_status > 5) throw new Error('INVALID_RELEASE');
            const patch = {profile_list_status:release.profile_list_status, is_favorite:release.is_favorite};
            setLoaded(patch); publish(target.id,patch); setError(previous => previous === 'save' ? previous : null);
        }).catch(() => {if (!controller.signal.aborted) setError('load');});
        return () => controller.abort();
    }, [api, needsLoad, target.id, attempt, publish, locked]);
    useLayoutEffect(() => {
        const element = root.current;
        if (!element) return;
        const rect = element.getBoundingClientRect();
        element.style.left = `${Math.max(8, Math.min(target.x, document.documentElement.clientWidth - rect.width - 8))}px`;
        element.style.top = `${Math.max(8, Math.min(target.y, window.innerHeight - rect.height - 8))}px`;
        if (!element.contains(document.activeElement)) element.focus();
        if (document.activeElement === element) element.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')?.focus();
    }, [target.x, target.y, loading, expanded, error]);
    const mutate = async (status?: number) => {
        if (!data || loading || !userToken || inFlight.current || !begin(target.id)) return;
        inFlight.current = true; setBusy(true); setError(null);
        const next = status === undefined ? {...data, is_favorite:!data.is_favorite} : {...data, profile_list_status:status};
        try {
            await api.get(status === undefined ? `/favorite/${data.is_favorite ? 'delete' : 'add'}/${target.id}` : `/profile/list/add/${status}/${target.id}`, {cache:'no-store'});
            publish(target.id, next, true);
            if (alive.current) close();
        } catch {if (alive.current) setError('save');}
        finally {inFlight.current = false; finish(target.id); if (alive.current) setBusy(false);}
    };
    const keyboard = (event: KeyboardEvent<HTMLDivElement>) => {
        event.stopPropagation();
        if (event.key === 'Escape' || event.key === 'ArrowLeft') {
            event.preventDefault();
            if (expanded) {setExpanded(false); moveButton.current?.focus();} else if (event.key === 'Escape') close();
            return;
        }
        if (event.key === 'Tab') {close(); return;}
        const activeMenu = (event.target as Element).closest('[role="menu"]');
        if (!activeMenu || !['ArrowDown','ArrowUp','Home','End'].includes(event.key)) return;
        event.preventDefault();
        const items = Array.from(activeMenu.querySelectorAll<HTMLElement>('[role="menuitem"], [role="menuitemradio"]')).filter(item => item.closest('[role="menu"]') === activeMenu && !(item instanceof HTMLButtonElement && item.disabled));
        const index = items.indexOf(document.activeElement as HTMLElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length-1 : event.key === 'ArrowDown' ? (index+1)%items.length : (index-1+items.length)%items.length;
        items[next]?.focus();
    };
    const disabled = loading || busy || locked || !data || !userToken;
    return <div ref={root} className={styles.menu} role="menu" aria-label={t('releaseMenu.title')} aria-busy={loading || busy || locked} tabIndex={-1} onKeyDown={keyboard} onContextMenu={event=>{event.preventDefault();event.stopPropagation();}}>
        <p className={styles.title}>{target.name}</p>
        <button ref={moveButton} type="button" role="menuitem" aria-haspopup="menu" aria-expanded={expanded} disabled={disabled} onClick={() => setExpanded(value=>!value)} onKeyDown={event=>{
            if (event.key==='ArrowRight') {event.preventDefault(); event.stopPropagation(); setExpanded(true);}
        }}>{t('releaseMenu.move')} <ActionIcon name="chevron" /></button>
        {expanded && <div className={styles.submenu} role="menu" aria-label={t('releaseMenu.move')} ref={element => {if (element) element.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();}}>
            {STATUS_KEYS.map((key,status)=><button type="button" key={key} role="menuitemradio" aria-checked={data?.profile_list_status===status} disabled={disabled} onClick={()=>void mutate(status)}><span aria-hidden="true">{data?.profile_list_status===status && <ActionIcon name="check" />}</span>{t(key)}</button>)}
        </div>}
        <button type="button" role="menuitem" disabled={disabled} onClick={()=>void mutate()}>{t(data?.is_favorite ? 'releaseMenu.removeFavorite' : 'release.addToFavorites')}</button>
        {!userToken && <Link role="menuitem" to="/account/login" onClick={onClose}>{t('release.loginToChangeStatus')}</Link>}
        {(loading || busy || locked) && <p className={styles.note} role="status">{t('misc.loading')}</p>}
        {error && <div className={styles.error} role="alert">{t(error==='load' ? 'releaseMenu.loadError' : 'releaseMenu.saveError')}{error==='load' && <button type="button" role="menuitem" onClick={()=>{setError(null);setAttempt(value=>value+1);}}>{t('releaseMenu.retry')}</button>}</div>}
    </div>;
}
