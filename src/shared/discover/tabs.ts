import type { KeyboardEvent } from 'react';

export function moveTab<T extends string>(event: KeyboardEvent<HTMLButtonElement>, ids: readonly T[], current: T, select: (id: T) => void, orientation: 'horizontal' | 'vertical' = 'horizontal') {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || ids.length === 0) return;
    const index = ids.indexOf(current);
    const forward = orientation === 'vertical' ? 'ArrowDown' : 'ArrowRight';
    const backward = orientation === 'vertical' ? 'ArrowUp' : 'ArrowLeft';
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? ids.length - 1
        : event.key === forward ? (index + 1) % ids.length
            : event.key === backward ? (index - 1 + ids.length) % ids.length : null;
    if (next === null) return;
    event.preventDefault();
    select(ids[next]);
    event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
}
