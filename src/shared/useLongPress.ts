import { useRef, useCallback, useEffect } from 'react';

export interface UseLongPressOptions<T extends HTMLElement = HTMLElement> {
    onLongPress: (target: T, coords: { x: number; y: number }) => boolean | void;
    filterTarget?: (target: EventTarget | null) => T | null;
    threshold?: number;
    moveTolerance?: number;
    disabled?: boolean;
}

export function useLongPress<E extends HTMLElement = HTMLElement, T extends HTMLElement = HTMLElement>({
    onLongPress,
    filterTarget,
    threshold = 500,
    moveTolerance = 10,
    disabled = false,
}: UseLongPressOptions<T>) {
    const touchStartRef = useRef<{
        x: number;
        y: number;
        target: T;
        timer: ReturnType<typeof setTimeout> | null;
    } | null>(null);
    const suppressClickRef = useRef(false);
    const suppressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const cancel = useCallback(() => {
        if (touchStartRef.current?.timer) {
            clearTimeout(touchStartRef.current.timer);
        }
        touchStartRef.current = null;
    }, []);

    const suppressNextClick = useCallback(() => {
        suppressClickRef.current = true;
        if (suppressTimerRef.current) clearTimeout(suppressTimerRef.current);

        const onWindowClick = (event: MouseEvent) => {
            event.preventDefault();
            event.stopPropagation();
            window.removeEventListener('click', onWindowClick, true);
        };
        window.addEventListener('click', onWindowClick, true);

        suppressTimerRef.current = setTimeout(() => {
            suppressClickRef.current = false;
            window.removeEventListener('click', onWindowClick, true);
        }, 600);
    }, []);

    useEffect(() => {
        return () => {
            if (touchStartRef.current?.timer) clearTimeout(touchStartRef.current.timer);
            if (suppressTimerRef.current) clearTimeout(suppressTimerRef.current);
        };
    }, []);

    const onTouchStart = useCallback((event: React.TouchEvent<E>) => {
        if (disabled || event.touches.length !== 1) {
            cancel();
            return;
        }
        const resolvedTarget = filterTarget
            ? filterTarget(event.target)
            : (event.currentTarget as unknown as T);

        if (!resolvedTarget) {
            cancel();
            return;
        }

        const touch = event.touches[0];
        const x = touch.clientX;
        const y = touch.clientY;

        cancel();
        const timer = setTimeout(() => {
            const result = onLongPress(resolvedTarget, { x, y });
            if (result !== false) {
                try {
                    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
                        navigator.vibrate(30);
                    }
                } catch {
                    // Ignore vibration errors
                }
                suppressNextClick();
            }
            touchStartRef.current = null;
        }, threshold);

        touchStartRef.current = { x, y, target: resolvedTarget, timer };
    }, [disabled, filterTarget, cancel, onLongPress, threshold, suppressNextClick]);

    const onTouchMove = useCallback((event: React.TouchEvent<E>) => {
        if (!touchStartRef.current) return;
        const touch = event.touches[0];
        if (!touch) {
            cancel();
            return;
        }
        const dx = touch.clientX - touchStartRef.current.x;
        const dy = touch.clientY - touchStartRef.current.y;
        if (dx * dx + dy * dy > moveTolerance * moveTolerance) {
            cancel();
        }
    }, [cancel, moveTolerance]);

    const onTouchEnd = useCallback(() => {
        cancel();
    }, [cancel]);

    const onTouchCancel = useCallback(() => {
        cancel();
    }, [cancel]);

    const onClickCapture = useCallback((event: React.MouseEvent<E>) => {
        if (suppressClickRef.current) {
            event.preventDefault();
            event.stopPropagation();
            suppressClickRef.current = false;
            if (suppressTimerRef.current) {
                clearTimeout(suppressTimerRef.current);
                suppressTimerRef.current = null;
            }
        }
    }, []);

    const handlers = {
        onTouchStart,
        onTouchMove,
        onTouchEnd,
        onTouchCancel,
        onClickCapture,
    };

    return {
        ...handlers,
        handlers,
        suppressNextClick,
        cancel,
    };
}
