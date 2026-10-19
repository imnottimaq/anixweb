type ReleaseTitles = {
    title_ru?: string | null;
    title_original?: string | null;
};

export function getReleaseTitle(anime: ReleaseTitles, language: 'english' | 'russian'): string {
    const original = anime.title_original?.trim();
    const russian = anime.title_ru?.trim();
    return language === 'english' ? original || russian || '' : russian || original || '';
}
