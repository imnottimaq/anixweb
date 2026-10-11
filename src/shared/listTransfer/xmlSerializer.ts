import { validateExportEntries } from './validation.ts';
import { mapAnixartScoreToMal, mapAnixartStatusToMal } from './statusMapper.ts';
import type { AnixartListStatusId, ExportListEntry, SerializeOptions } from './types.ts';

export type { ExportListEntry, SerializeOptions };

function escapeXml(unsafe: string): string {
    return unsafe
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function wrapCdata(content: string): string {
    // Prevent CDATA closing breakout
    const safeContent = content.replace(/]]>/g, ']]]]><![CDATA[>');
    return `<![CDATA[${safeContent}]]>`;
}

/**
 * Serializes user's Anixart lists to official accepted Shikimori / MyAnimeList XML format.
 * Strict rules:
 * - series_animedb_id MUST be the verified external Shikimori/MAL anime ID
 * - NEVER write Anixart anime.id into series_animedb_id
 * - Serializer FAILS (throws) if any entry lacks a verified externalId
 * - anixart_id extension preserves original Anixart ID
 */
export function serializeToMalXml(options: SerializeOptions): string {
    const { profile, entries } = options;

    // Fail immediately if any entry lacks a verified externalId
    validateExportEntries(entries);

    const counts: Record<AnixartListStatusId, number> = {
        1: 0,
        2: 0,
        3: 0,
        4: 0,
        5: 0,
    };

    entries.forEach(entry => {
        if (counts[entry.status] !== undefined) {
            counts[entry.status]++;
        }
    });

    const totalAnime = entries.length;
    const now = Math.floor(Date.now() / 1000);

    const lines: string[] = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<myanimelist>',
        '    <myinfo>',
        `        <user_id>${profile?.id ?? 0}</user_id>`,
        `        <user_name>${escapeXml(profile?.login ?? 'AnixartUser')}</user_name>`,
        '        <user_export_type>1</user_export_type>',
        `        <user_total_anime>${totalAnime}</user_total_anime>`,
        `        <user_total_watching>${counts[1]}</user_total_watching>`,
        `        <user_total_completed>${counts[3]}</user_total_completed>`,
        `        <user_total_onhold>${counts[4]}</user_total_onhold>`,
        `        <user_total_dropped>${counts[5]}</user_total_dropped>`,
        `        <user_total_plantowatch>${counts[2]}</user_total_plantowatch>`,
        '    </myinfo>',
    ];

    entries.forEach(entry => {
        const { anime, status, externalId } = entry;
        const malStatus = mapAnixartStatusToMal(status);
        const rating = anime.your_vote ?? anime.my_vote ?? 0;
        const malScore = mapAnixartScoreToMal(rating);
        const titleOriginal = anime.title_original?.trim() || anime.title_ru?.trim() || `Anime ${anime.id}`;
        const titleRu = anime.title_ru?.trim() || '';
        const totalEps = anime.episodes_total ?? anime.episodes_released ?? 0;
        const watchedEps = status === 3 ? totalEps : 0; // If completed, all episodes

        lines.push('    <anime>');
        lines.push(`        <series_animedb_id>${externalId}</series_animedb_id>`);
        lines.push(`        <series_title>${wrapCdata(titleOriginal)}</series_title>`);
        if (titleRu) {
            lines.push(`        <series_title_ru>${wrapCdata(titleRu)}</series_title_ru>`);
        }
        lines.push(`        <series_type>${escapeXml(anime.category?.name || 'TV')}</series_type>`);
        lines.push(`        <series_episodes>${totalEps}</series_episodes>`);
        lines.push(`        <my_id>0</my_id>`);
        lines.push(`        <anixart_id>${anime.id}</anixart_id>`);
        lines.push(`        <my_watched_episodes>${watchedEps}</my_watched_episodes>`);
        lines.push('        <my_start_date>0000-00-00</my_start_date>');
        lines.push('        <my_finish_date>0000-00-00</my_finish_date>');
        lines.push(`        <my_score>${malScore}</my_score>`);
        lines.push(`        <my_status>${escapeXml(malStatus)}</my_status>`);
        lines.push('        <my_rewatching>0</my_rewatching>');
        lines.push('        <my_rewatching_ep>0</my_rewatching_ep>');
        lines.push(`        <my_last_updated>${now}</my_last_updated>`);
        lines.push('        <my_tags><![CDATA[]]></my_tags>');
        lines.push('        <update_on_import>1</update_on_import>');
        lines.push('    </anime>');
    });

    lines.push('</myanimelist>');
    lines.push('');

    return lines.join('\n');
}
