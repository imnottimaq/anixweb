import { useCallback, useMemo } from 'react';
import { useUser } from './contexts/userContext';

const API_URL = 'https://api-s.anixsekai.com';
const AGENT_PROXY = 'https://kodik-proxy.imnottimaq.workers.dev/agentproxy?url=';

type ApiHeaders = Record<string, string>;

export function useApi() {
    const { userToken } = useUser();
    const get = useCallback(<T>(path: string, init?: RequestInit) => apiGet<T>(path, userToken, init), [userToken]);
    const post = useCallback(<T>(path: string, body: unknown, headers?: ApiHeaders) => apiPost<T>(path, userToken, body, headers), [userToken]);
    const postForm = useCallback(<T>(path: string, body: FormData) => apiPostForm<T>(path, userToken, body), [userToken]);
    const getViaAgent = useCallback(<T>(path: string, init?: RequestInit) => apiGetViaAgent<T>(path, userToken, init), [userToken]);
    const postViaAgent = useCallback(<T>(path: string, body: unknown, headers?: ApiHeaders) => apiPostViaAgent<T>(path, userToken, body, headers), [userToken]);
    const postFormViaAgent = useCallback(<T>(path: string, body: FormData) => apiPostFormViaAgent<T>(path, userToken, body), [userToken]);

    return useMemo(() => ({ get, post, postForm, getViaAgent, postViaAgent, postFormViaAgent }), [get, getViaAgent, post, postForm, postFormViaAgent, postViaAgent]);
}

function getApiUrl(path: string, token: string) {
    const url = new URL(path, API_URL);
    if (token) url.searchParams.set('token', token);
    return url.toString();
}

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
    const response = await fetch(url, init);
    if (!response.ok) throw new Error(`API error: ${response.status}`);

    const data = await response.json() as T & { code?: number };
    if (typeof data.code === 'number' && data.code !== 0) throw new Error(`API error: ${data.code}`);
    return data;
}

async function apiGet<T>(path: string, token: string, init?: RequestInit): Promise<T> {
    return getJson<T>(getApiUrl(path, token), init);
}

async function apiPost<T>(path: string, token: string, body: unknown, headers?: ApiHeaders): Promise<T> {
    return getJson<T>(getApiUrl(path, token), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body),
    });
}

async function apiPostForm<T>(path: string, token: string, body: FormData): Promise<T> {
    return getJson<T>(getApiUrl(path, token), {
        method: 'POST',
        body,
    });
}

async function apiGetViaAgent<T>(path: string, token: string, init?: RequestInit): Promise<T> {
    return getJson<T>(`${AGENT_PROXY}${encodeURIComponent(getApiUrl(path, token))}`, init);
}

async function apiPostViaAgent<T>(path: string, token: string, body: unknown, headers?: ApiHeaders): Promise<T> {
    return getJson<T>(`${AGENT_PROXY}${encodeURIComponent(getApiUrl(path, token))}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body),
    });
}

async function apiPostFormViaAgent<T>(path: string, token: string, body: FormData): Promise<T> {
    return getJson<T>(`${AGENT_PROXY}${encodeURIComponent(getApiUrl(path, token))}`, {
        method: 'POST',
        body,
    });
}
