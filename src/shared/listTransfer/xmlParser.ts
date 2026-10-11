import type { ParsedAnimeItem } from './types.ts';
import { mapMalScoreToAnixart, mapMalStatusToAnixart } from './statusMapper.ts';
import { integerField, MAX_TRANSFER_BYTES, MAX_TRANSFER_ROWS, positiveId } from './validation.ts';

export const MAX_XML_FILE_BYTES = MAX_TRANSFER_BYTES;
export class XmlSecurityError extends Error {
    constructor(message: string) { super(message); this.name = 'XmlSecurityError'; }
}
export class XmlParseError extends Error {
    constructor(message: string) { super(message); this.name = 'XmlParseError'; }
}
export function assertSafeXml(value: string): void {
    if (typeof value !== 'string' || !value.trim()) throw new XmlParseError('Empty XML file');
    if (new TextEncoder().encode(value).length > MAX_XML_FILE_BYTES) throw new XmlParseError('Maximum file size is 10 MB');
    if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(value)) throw new XmlSecurityError('DTD and custom entities are forbidden');
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw new XmlParseError('Invalid XML character');
}

type Element = { name: string; text: string; children: Element[] };
function decodeText(value: string): string {
    return value.replace(/&([^;\s]*);|&/g, (entity, name: string | undefined) => {
        const standard: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
        if (name && standard[name] !== undefined) return standard[name];
        if (name && /^#(?:\d+|x[\da-f]+)$/i.test(name)) {
            const number = name[1].toLowerCase() === 'x' ? Number.parseInt(name.slice(2), 16) : Number(name.slice(1));
            if (number === 9 || number === 10 || number === 13 || (number >= 32 && number <= 0x10ffff && !(number >= 0xd800 && number <= 0xdfff))) return String.fromCodePoint(number);
        }
        throw new XmlParseError(`Invalid XML entity ${entity}`);
    });
}

/** Small bounded XML reader used equally in browsers and Node. No recovery or entity expansion. */
function readDocument(xml: string): Element {
    const document: Element = { name: '#document', text: '', children: [] };
    const stack = [document];
    let cursor = 0;
    let elements = 0;
    while (cursor < xml.length) {
        const rest = xml.slice(cursor);
        const parent = stack[stack.length - 1];
        if (rest.startsWith('<!--')) {
            const end = rest.indexOf('-->');
            if (end < 0 || rest.slice(4, end).includes('--')) throw new XmlParseError('Invalid XML comment');
            cursor += end + 3; continue;
        }
        if (rest.startsWith('<?')) {
            const declaration = /^<\?xml\s+[^?]*\?>/.exec(rest);
            if (!declaration || xml.slice(0, cursor).trim().replace(/^\uFEFF/, '') || stack.length !== 1) throw new XmlParseError('Invalid XML declaration');
            cursor += declaration[0].length; continue;
        }
        if (rest.startsWith('<![CDATA[')) {
            const end = rest.indexOf(']]>');
            if (end < 0 || stack.length === 1) throw new XmlParseError('Invalid CDATA');
            parent.text += rest.slice(9, end); cursor += end + 3; continue;
        }
        if (rest.startsWith('</')) {
            const close = /^<\/([A-Za-z_][\w.-]*)\s*>/.exec(rest);
            if (!close || stack.length <= 1 || close[1] !== parent.name) throw new XmlParseError('Mismatched XML closing tag');
            stack.pop(); cursor += close[0].length; continue;
        }
        if (rest.startsWith('<')) {
            const open = /^<([A-Za-z_][\w.-]*)(?:\s+[A-Za-z_][\w.:-]*\s*=\s*(?:"[^"<]*"|'[^'<]*'))*\s*\/?>/.exec(rest);
            if (!open || stack.length > 4 || ++elements > MAX_TRANSFER_ROWS * 100 + 100) throw new XmlParseError('Invalid or excessive XML nesting');
            const child: Element = { name: open[1], text: '', children: [] };
            parent.children.push(child);
            if (!open[0].endsWith('/>')) stack.push(child);
            cursor += open[0].length; continue;
        }
        const next = rest.indexOf('<');
        const text = next < 0 ? rest : rest.slice(0, next);
        if (text.includes(']]>')) throw new XmlParseError('Invalid XML text');
        parent.text += decodeText(text); cursor += text.length;
    }
    if (stack.length !== 1 || document.children.length !== 1 || document.text.trim()) throw new XmlParseError('Invalid XML document');
    return document.children[0];
}

/** A malformed row rejects the entire file; only explicit anixart_id establishes Anixart identity. */
export function parseMalXml(rawXml: string): ParsedAnimeItem[] {
    assertSafeXml(rawXml);
    const root = readDocument(rawXml.replace(/^\uFEFF/, ''));
    if (!['myanimelist', 'anime_list'].includes(root.name) || root.text.trim()) throw new XmlParseError('Expected MyAnimeList XML root');
    if (root.children.some(node => !['myinfo', 'anime'].includes(node.name))) throw new XmlParseError('Unexpected XML list element');
    const anime = root.children.filter(node => node.name === 'anime');
    if (anime.length > MAX_TRANSFER_ROWS) throw new XmlParseError(`Maximum ${MAX_TRANSFER_ROWS} entries per transfer`);
    return anime.map((node, index): ParsedAnimeItem => {
        try {
            if (node.text.trim()) throw new Error('Unexpected anime text');
            const fields = new Map<string, string>();
            for (const field of node.children) {
                if (fields.has(field.name) || field.children.length) throw new Error('Duplicate or nested anime field');
                fields.set(field.name, field.text.trim());
            }
            const sourceRaw = fields.get('series_animedb_id');
            const sourceId = sourceRaw ? positiveId(sourceRaw) : undefined;
            if (sourceRaw && !sourceId) throw new Error('Invalid series_animedb_id');
            const title = fields.get('series_title') ?? '';
            const titleRu = fields.get('series_title_ru') || undefined;
            if ((!title && !titleRu && !sourceId) || title.length > 1000) throw new Error('Missing anime identity');
            const rawStatus = fields.get('my_status') ?? '';
            const rawScore = integerField(fields.get('my_score') || 0, 'my_score', 10);
            const episodesWatched = integerField(fields.get('my_watched_episodes') || 0, 'my_watched_episodes');
            const total = fields.get('series_episodes');
            const episodesTotal = total ? integerField(total, 'series_episodes') : undefined;
            const ownIdRaw = fields.get('anixart_id');
            const anixartId = ownIdRaw === undefined ? undefined : positiveId(ownIdRaw);
            if (ownIdRaw !== undefined && !anixartId) throw new Error('Invalid anixart_id');
            return {
                id: `item_${index}_${sourceId ?? 'title'}`, sourceId: sourceId ?? '',
                title: title || titleRu || `Anime ${sourceId}`, titleRu, episodesWatched, episodesTotal,
                rawScore, anixartScore: mapMalScoreToAnixart(rawScore), rawStatus,
                anixartStatus: mapMalStatusToAnixart(rawStatus), anixartId,
            };
        } catch (error) {
            throw new XmlParseError(`Row ${index + 1}: ${error instanceof Error ? error.message : 'Invalid anime record'}`);
        }
    });
}
