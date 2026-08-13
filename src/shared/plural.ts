import { getLocale, type AppLocale, type Language } from './locale';

/** Selects a localized form while preserving the existing one/few/many API. */
export function plural(
    value: number,
    one: string,
    few: string,
    many: string,
    languageOrLocale: Language | AppLocale = 'russian',
) {
    const locale = languageOrLocale === 'russian' || languageOrLocale === 'english'
        ? getLocale(languageOrLocale)
        : languageOrLocale;
    const category = new Intl.PluralRules(locale).select(value);

    if (category === 'one') return one;
    if (category === 'few') return few;
    return many;
}
