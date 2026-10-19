import { useCallback, useMemo } from 'react';
import { useUser } from './contexts/userContext.ts';
import { getAgentProxyUrl } from './proxy.ts';

const API_URL = 'https://api-s.anixsekai.com';

type ApiHeaders = Record<string, string>;
type PostRequestInit = Omit<RequestInit, 'method' | 'body' | 'headers'>;

export class ApiError extends Error {
    readonly status: number;
    readonly code?: number;

    constructor(status: number, code?: number) {
        super(`API error: ${code ?? status}`);
        this.name = 'ApiError';
        this.status = status;
        this.code = code;
    }
}

export function useApi() {
    const { userToken } = useUser();
    const get = useCallback(<T>(path: string, init?: RequestInit) => apiGet<T>(path, userToken, init), [userToken]);
    const post = useCallback(<T>(path: string, body: unknown, headers?: ApiHeaders, init?: PostRequestInit) => apiPost<T>(path, userToken, body, headers, init), [userToken]);
    const postForm = useCallback(<T>(path: string, body: FormData, init?: PostRequestInit) => apiPostForm<T>(path, userToken, body, init), [userToken]);
    const getViaAgent = useCallback(<T>(path: string, init?: RequestInit) => apiGetViaAgent<T>(path, userToken, init), [userToken]);
    const postViaAgent = useCallback(<T>(path: string, body: unknown, headers?: ApiHeaders, init?: PostRequestInit) => apiPostViaAgent<T>(path, userToken, body, headers, init), [userToken]);
    const postFormViaAgent = useCallback(<T>(path: string, body: FormData) => apiPostFormViaAgent<T>(path, userToken, body), [userToken]);

    return useMemo(() => ({ get, post, postForm, getViaAgent, postViaAgent, postFormViaAgent }), [get, getViaAgent, post, postForm, postFormViaAgent, postViaAgent]);
}

export function getApiUrl(path: string, token: string) {
    const url = new URL(path, API_URL);
    if (token) url.searchParams.set('token', token);
    return url.toString();
}

export async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
    const response = await fetch(url, init);
    if (!response.ok) throw new ApiError(response.status);

    const data = await response.json() as T & { code?: number };
    if (typeof data.code === 'number' && data.code !== 0) throw new ApiError(response.status, data.code);
    return data;
}

export async function apiGet<T>(path: string, token: string, init?: RequestInit): Promise<T> {
    return getJson<T>(getApiUrl(path, token), init);
}

export async function apiPost<T>(path: string, token: string, body: unknown, headers?: ApiHeaders, init?: PostRequestInit): Promise<T> {
    return getJson<T>(getApiUrl(path, token), {
        ...init,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body),
    });
}

export async function apiPostForm<T>(path: string, token: string, body: FormData, init?: PostRequestInit): Promise<T> {
    return getJson<T>(getApiUrl(path, token), {
        ...init,
        method: 'POST',
        body,
    });
}

export async function apiGetViaAgent<T>(path: string, token: string, init?: RequestInit): Promise<T> {
    return getJson<T>(getAgentProxyUrl(getApiUrl(path, token)), init);
}

export async function apiPostViaAgent<T>(path: string, token: string, body: unknown, headers?: ApiHeaders, init?: PostRequestInit): Promise<T> {
    return getJson<T>(getAgentProxyUrl(getApiUrl(path, token)), {
        ...init,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body),
    });
}

export async function apiPostFormViaAgent<T>(path: string, token: string, body: FormData): Promise<T> {
    return getJson<T>(getAgentProxyUrl(getApiUrl(path, token)), {
        method: 'POST',
        body,
    });
}
