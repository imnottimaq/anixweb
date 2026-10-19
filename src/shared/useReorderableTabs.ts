import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent, type MouseEvent } from 'react';
import { moveTab } from './tabOrder';
import { useTranslation } from './useTranslation';
import styles from '../components/TabDragHandle.module.css';

export function useReorderableTabs<T extends string>(order: T[], onChange: (order: T[]) => void, label: (key: T) => string) {
    const group = useId();
    const { t } = useTranslation();
    const gesture = useRef<{ key: T; pointer: number; x: number; y: number; dragging: boolean; target?: T } | null>(null);
    const skipClick = useRef(false);
    const clickTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const [drag, setDrag] = useState<{ from: T; to?: T } | null>(null);
    const [announcement, setAnnouncement] = useState('');
    useEffect(() => () => clearTimeout(clickTimer.current), []);
    const cancel = () => { gesture.current = null; setDrag(null); };
    const commit = (from: T, to: T) => {
        if (from === to) return;
        const next = moveTab(order, from, to);
        onChange(next);
        setAnnouncement(t('tabMenu.moved', { tab: label(from), position: next.indexOf(from) + 1, count: next.length }));
    };
    const targetAt = (event: PointerEvent<HTMLButtonElement>): T | undefined => {
        const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-reorder-tab]');
        const key = target?.dataset.reorderTab as T | undefined;
        return target?.dataset.reorderGroup === group && key && order.includes(key) ? key : undefined;
    };
    return {
        tabClass: styles.tab, announcementClass: styles.announcement, announcement,
        onKeyDown(event: KeyboardEvent<HTMLButtonElement>, key: T) {
            if (event.key === 'Escape' && gesture.current?.dragging) { event.preventDefault(); cancel(); return true; }
            if (!event.altKey || !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return false;
            event.preventDefault();
            const offset = event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1 : 1;
            const target = order[order.indexOf(key) + offset];
            if (target) { const button = event.currentTarget; commit(key, target); requestAnimationFrame(() => button.focus()); }
            return true;
        },
        props(key: T) {
            return {
                'data-reorder-tab': key,
                'data-reorder-group': group,
                'data-dragging': drag?.from === key || undefined,
                'data-drop-edge': drag?.to === key && drag.from !== key ? (order.indexOf(drag.from) < order.indexOf(key) ? 'after' : 'before') : undefined,
                'aria-description': t('tabMenu.dragHint'),
                onPointerDown(event: PointerEvent<HTMLButtonElement>) {
                    if (event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
                    // Touch users can scroll the tab bar normally; the grip starts a drag.
                    if (event.pointerType !== 'mouse' && !(event.target as HTMLElement).closest('[data-tab-grip]')) return;
                    gesture.current = { key, pointer: event.pointerId, x: event.clientX, y: event.clientY, dragging: false };
                },
                onPointerMove(event: PointerEvent<HTMLButtonElement>) {
                    const current = gesture.current;
                    if (!current || current.pointer !== event.pointerId) return;
                    if (!current.dragging && Math.hypot(event.clientX - current.x, event.clientY - current.y) < 6) return;
                    if (!current.dragging) { current.dragging = true; event.currentTarget.setPointerCapture(event.pointerId); }
                    event.preventDefault();
                    current.target = targetAt(event);
                    setDrag({ from: current.key, to: current.target });
                },
                onPointerUp(event: PointerEvent<HTMLButtonElement>) {
                    const current = gesture.current;
                    if (!current || current.pointer !== event.pointerId) return;
                    if (current.dragging) {
                        skipClick.current = true;
                        clearTimeout(clickTimer.current);
                        clickTimer.current = setTimeout(() => { skipClick.current = false; }, 0);
                        const target = targetAt(event);
                        if (target) commit(current.key, target);
                    }
                    cancel();
                },
                onPointerCancel: cancel,
                onLostPointerCapture(event: PointerEvent<HTMLButtonElement>) {
                    // Touch starts with implicit capture on the grip; transferring it to
                    // the button must not cancel the gesture when the grip loses capture.
                    if (event.target === event.currentTarget) cancel();
                },
                onClickCapture(event: MouseEvent<HTMLButtonElement>) {
                    if (skipClick.current) { event.preventDefault(); event.stopPropagation(); skipClick.current = false; }
                },
            };
        },
    };
}
