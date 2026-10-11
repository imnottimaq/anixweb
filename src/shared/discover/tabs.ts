import type { KeyboardEvent } from 'react';

export function moveTab<T extends string>(event: KeyboardEvent<HTMLButtonElement>, ids: readonly T[], current: T, select: (id: T) => void) {
    const index = ids.indexOf(current);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? ids.length - 1
        : event.key === 'ArrowRight' ? (index + 1) % ids.length
            : event.key === 'ArrowLeft' ? (index - 1 + ids.length) % ids.length : null;
    if (next === null) return;
    event.preventDefault();
    select(ids[next]);
    event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
}
