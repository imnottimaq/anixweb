import { useCallback, useMemo } from 'react';
import { useSettings } from './contexts/settingsContext';
import { dictionaries, russian, type TranslationKey } from './i18n';
import { getLocale } from './locale';

export type TranslationParams = Record<string, string | number | boolean | null | undefined>;

function interpolate(template: string, params?: TranslationParams): string {
    if (!params) return template;

    return template.replace(/\{([\w.-]+)\}/g, (placeholder, name: string) => {
        if (!Object.prototype.hasOwnProperty.call(params, name)) return placeholder;
        const value = params[name];
        return value == null ? '' : String(value);
    });
}

export function useTranslation() {
    const { settings } = useSettings();
    const language = settings.appearance.language;
    const dictionary = dictionaries[language];
    const locale = getLocale(language);

    const t = useCallback((key: TranslationKey, params?: TranslationParams) => {
        const translation = dictionary[key] ?? russian[key] ?? key;
        return interpolate(translation, params);
    }, [dictionary]);

    const formatDate = useCallback((value: Date | number | string, options?: Intl.DateTimeFormatOptions) => {
        const date = value instanceof Date ? value : new Date(value);
        return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat(locale, options).format(date);
    }, [locale]);

    const formatNumber = useCallback((value: number | bigint, options?: Intl.NumberFormatOptions) =>
        new Intl.NumberFormat(locale, options).format(value), [locale]);

    const formatRelativeTime = useCallback((value: number, unit: Intl.RelativeTimeFormatUnit = 'second', options?: Intl.RelativeTimeFormatOptions) =>
        new Intl.RelativeTimeFormat(locale, options).format(value, unit), [locale]);

    const pluralRules = useMemo(() => new Intl.PluralRules(locale), [locale]);
    const selectPlural = useCallback((value: number, options?: Intl.PluralRulesOptions) =>
        options ? new Intl.PluralRules(locale, options).select(value) : pluralRules.select(value), [locale, pluralRules]);

    return { t, language, locale, formatDate, formatNumber, formatRelativeTime, selectPlural };
}
