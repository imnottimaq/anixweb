export type Language = 'russian' | 'english';
export type AppLocale = 'ru-RU' | 'en-US';

export const localeByLanguage: Record<Language, AppLocale> = {
    russian: 'ru-RU',
    english: 'en-US',
};

export const htmlLanguageByLanguage: Record<Language, 'ru' | 'en'> = {
    russian: 'ru',
    english: 'en',
};

export function isLanguage(value: unknown): value is Language {
    return value === 'russian' || value === 'english';
}

export function getLocale(language: Language): AppLocale {
    return localeByLanguage[language];
}
