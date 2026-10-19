export function normalizeTabOrder<T extends string>(value: unknown, defaults: readonly T[]): T[] {
    const known = new Set<string>(defaults);
    const saved = Array.isArray(value) ? value.filter((key): key is T => typeof key === 'string' && known.has(key)) : [];
    return [...new Set([...saved, ...defaults])];
}

export function moveTab<T extends string>(order: readonly T[], from: T, to: T): T[] {
    const source = order.indexOf(from), target = order.indexOf(to);
    if (source < 0 || target < 0 || source === target) return [...order];
    const next = [...order];
    next.splice(source, 1);
    next.splice(target, 0, from);
    return next;
}
