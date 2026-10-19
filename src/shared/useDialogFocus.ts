import { useEffect, useEffectEvent, type RefObject } from 'react';

const dialogs: HTMLElement[] = [];
let previousOverflow = '';
let previousRootOverflow = '';
let previousGutter = '';
let previousPaddingRight = '';

/** Shared focus, dismissal and scroll ownership for stacked dialogs. */
export function useDialogFocus(ref: RefObject<HTMLElement | null>, open: boolean, onClose: () => void, captureKeys = false) {
    const dismiss = useEffectEvent(onClose);
    useEffect(() => {
        const dialog = ref.current;
        if (!open || !dialog) return;
        const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        if (!dialogs.length) {
            const root = document.documentElement;
            const gutter = Math.max(0, window.innerWidth - root.clientWidth);
            previousOverflow = document.body.style.overflow;
            previousRootOverflow = root.style.overflow;
            previousGutter = root.style.scrollbarGutter;
            previousPaddingRight = document.body.style.paddingRight;
            // The root's stable gutter otherwise remains visible beside fullscreen overlays.
            // Preserve the page's original width while the overlay uses the whole viewport.
            if (gutter) document.body.style.paddingRight = `${(parseFloat(getComputedStyle(document.body).paddingRight) || 0) + gutter}px`;
            root.style.overflow = 'hidden';
            root.style.scrollbarGutter = 'auto';
            document.body.style.overflow = 'hidden';
        }
        dialogs.push(dialog);
        const isTop = () => dialogs.at(-1) === dialog;
        const controls = () => Array.from(dialog.querySelectorAll<HTMLElement>(
            'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]'
        )).filter(element => !element.closest('[hidden], [inert], [aria-hidden="true"]') && getComputedStyle(element).display !== 'none');
        const focusFirst = () => (controls()[0] ?? dialog).focus();
        if (!dialog.contains(document.activeElement)) focusFirst();
        const keydown = (event: KeyboardEvent) => {
            if (!isTop() || event.defaultPrevented) return;
            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopImmediatePropagation();
                dismiss();
            } else if (event.key === 'Tab') {
                const items = controls();
                const index = items.indexOf(document.activeElement as HTMLElement);
                if (!items.length) { event.preventDefault(); dialog.focus(); }
                else if (event.shiftKey && index <= 0) { event.preventDefault(); items.at(-1)?.focus(); }
                else if (!event.shiftKey && (index < 0 || index === items.length - 1)) { event.preventDefault(); items[0].focus(); }
            }
        };
        const containFocus = (event: FocusEvent) => {
            if (isTop() && !dialog.contains(event.target as Node)) focusFirst();
        };
        window.addEventListener('keydown', keydown, captureKeys);
        document.addEventListener('focusin', containFocus);
        return () => {
            const wasTop = isTop();
            dialogs.splice(dialogs.indexOf(dialog), 1);
            window.removeEventListener('keydown', keydown, captureKeys);
            document.removeEventListener('focusin', containFocus);
            if (!dialogs.length) {
                document.body.style.overflow = previousOverflow;
                document.body.style.paddingRight = previousPaddingRight;
                document.documentElement.style.overflow = previousRootOverflow;
                document.documentElement.style.scrollbarGutter = previousGutter;
            }
            if (wasTop && previousFocus?.isConnected) previousFocus.focus();
        };
    }, [open, ref, captureKeys]);
}
