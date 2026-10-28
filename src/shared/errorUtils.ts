import type { TranslationKey } from './i18n';
import type { TranslationParams } from './useTranslation';

export type ErrorTranslator = (key: TranslationKey, params?: TranslationParams) => string;

export interface HasStatusAndCode {
    status: number;
    code?: number;
    message?: string;
}

export function isApiError(error: unknown): error is HasStatusAndCode {
    return Boolean(
        error &&
        typeof error === 'object' &&
        'status' in error &&
        typeof (error as { status: unknown }).status === 'number'
    );
}

export function isNetworkError(error: unknown): boolean {
    if (typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean' && !navigator.onLine) {
        return true;
    }
    if (error instanceof TypeError && error.message.toLowerCase().includes('fetch')) {
        return true;
    }
    if (error instanceof Error && (error.name === 'NetworkError' || error.message.toLowerCase().includes('networkerror'))) {
        return true;
    }
    return false;
}

export function isTimeoutError(error: unknown): boolean {
    if (error instanceof Error) {
        return error.name === 'TimeoutError' || error.name === 'AbortError' || error.message.toLowerCase().includes('timeout');
    }
    return false;
}

export function getReadableErrorMessage(
    error: unknown,
    t?: ErrorTranslator
): string {
    const translate = (key: TranslationKey) => (t ? t(key) : key);

    if (isNetworkError(error)) {
        return translate('error.network');
    }

    if (isTimeoutError(error)) {
        return translate('error.timeout');
    }

    if (isApiError(error)) {
        if (error.status === 404) {
            return translate('error.notFound');
        }
        if (error.status === 429) {
            return translate('error.rateLimit');
        }
        if (error.status === 401 || error.status === 403) {
            return translate('error.forbidden');
        }
        if (error.status >= 500) {
            return translate('error.server');
        }
        if (error.code === 2) {
            return translate('error.notFound');
        }
    }

    if (error instanceof Error && error.message && !error.message.startsWith('API error:') && !error.message.startsWith('[object')) {
        return error.message;
    }

    return translate('error.generic');
}
