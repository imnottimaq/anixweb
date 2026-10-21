import type { TranslationKey } from './i18n';

type ReleaseTitles = {
    title_ru?: string | null;
    title_original?: string | null;
};

export function getReleaseTitle(anime: ReleaseTitles, language: 'english' | 'russian'): string {
    const original = anime.title_original?.trim();
    const russian = anime.title_ru?.trim();
    return language === 'english' ? original || russian || '' : russian || original || '';
}

export function localizeCategory(name?: string, t?: (key: TranslationKey) => string): string {
    if (!name) return '';
    if (!t) return name;
    const lower = name.toLowerCase().trim();
    if (lower.includes('сериал')) return t('releaseType.series');
    if (lower.includes('фильм')) return t('releaseType.film');
    if (lower === 'ova') return t('releaseType.ova');
    if (lower.includes('спешл') || lower.includes('special')) return t('releaseType.special');
    if (lower.includes('дорама') || lower.includes('drama')) return t('releaseType.dorama');
    return name;
}

export function localizeReleaseStatus(status?: string, t?: (key: TranslationKey) => string): string {
    if (!status) return '';
    if (!t) return status;
    const lower = status.toLowerCase().trim();
    if (lower.includes('онгоинг') || lower.includes('ongoing')) return t('filter.statusOngoing');
    if (lower.includes('вышел') || lower.includes('released')) return t('filter.statusReleased');
    if (lower.includes('анонс') || lower.includes('announced')) return t('filter.statusAnnounced');
    return status;
}

