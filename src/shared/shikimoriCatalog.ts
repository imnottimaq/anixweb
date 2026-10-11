export interface ShikimoriCatalogCandidate {
    id: number;
    title: string;
    titleRu?: string;
    year?: string;
    kind?: string;
    url: string;
}

export function parseShikimoriId(value: string): number | undefined {
    const text = value.trim();
    let digits = /^\d+$/.test(text) ? text : undefined;
    if (!digits) {
        try {
            const url = new URL(text);
            if (url.protocol !== 'https:' || !['shikimori.one', 'shikimori.io'].includes(url.hostname)
                || url.username || url.password || url.port) return undefined;
            digits = /^\/animes\/(?:[a-z])?(\d+)(?:-[^/]+)?\/?$/i.exec(url.pathname)?.[1];
        } catch { return undefined; }
    }
    const id = digits ? Number(digits) : NaN;
    return Number.isSafeInteger(id) && id > 0 ? id : undefined;
}

// Shikimori's own AnimesController/AnimeSerializer define this REST contract.
// These IDs belong to Shikimori; Anixart search results cannot be used here.
export async function searchShikimoriCatalog(
    query: string,
    signal?: AbortSignal,
    fetchFn: typeof fetch = fetch,
): Promise<ShikimoriCatalogCandidate[]> {
    if (!query.trim()) return [];
    const url = new URL('https://shikimori.one/api/animes');
    url.searchParams.set('search', query.trim());
    url.searchParams.set('limit', '5');
    const response = await fetchFn(url, { signal, credentials: 'omit' });
    if (!response.ok) throw new Error(`Shikimori search failed (${response.status})`);
    const data: unknown = await response.json();
    if (!Array.isArray(data)) throw new Error('Invalid Shikimori catalog response');
    return data.map((record: unknown) => {
        if (!record || typeof record !== 'object') throw new Error('Invalid Shikimori catalog entry');
        const item = record as Record<string, unknown>;
        const id = typeof item.id === 'number' ? item.id
            : typeof item.id === 'string' && /^\d+$/.test(item.id) ? Number(item.id) : NaN;
        if (!Number.isSafeInteger(id) || id <= 0 || typeof item.name !== 'string' || !item.name.trim()) {
            throw new Error('Invalid Shikimori catalog entry');
        }
        return {
            id, title: item.name.trim(),
            titleRu: typeof item.russian === 'string' ? item.russian.trim() || undefined : undefined,
            year: typeof item.aired_on === 'string' && /^\d{4}-/.test(item.aired_on) ? item.aired_on.slice(0, 4) : undefined,
            kind: typeof item.kind === 'string' ? item.kind : undefined,
            url: `https://shikimori.one/animes/${id}`,
        };
    });
}
