import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { useAsyncLoad } from '../../src/shared/useAsyncLoad';
import {
    getApiUrl,
    getJson,
    apiGet,
    apiPost,
    apiPostForm,
    apiGetViaAgent,
    apiPostViaAgent,
    apiPostFormViaAgent,
    useApi,
} from '../../src/shared/apiClient';
import {
    DEFAULT_PROXY_SERVER_URL,
    DEFAULT_MEDIA_PROXY_URL,
    SERVER_PROXY_ALLOWLIST,
    normalizeTrailingSlashes,
    getProxyServerUrl,
    getMediaProxyUrl,
    cleanTargetUrl,
    isAllowedServerProxyHost,
    getAgentProxyUrl,
    getCorsProxyUrl,
} from '../../src/shared/proxy';
import { getStoredUserToken, setStoredUserToken } from '../../src/shared/authToken';
import { createDeferred } from './helpers/deferred';
import { UserContext } from '../../src/shared/contexts/userContext';

describe('useAsyncLoad Hook', () => {
    it('handles initial loading state and successful resolution', async () => {
        const deferred = createDeferred<{ id: number; name: string }>();
        const request = vi.fn().mockImplementation(() => deferred.promise);

        const { result } = renderHook(() =>
            useAsyncLoad(request, [], { initialData: { id: 0, name: 'initial' } })
        );

        // Initially in loading state with initialData preserved
        expect(result.current.isLoading).toBe(true);
        expect(result.current.data).toEqual({ id: 0, name: 'initial' });
        expect(result.current.error).toBeNull();

        await waitFor(() => {
            expect(request).toHaveBeenCalledTimes(1);
        });

        // Resolve the request
        await act(async () => {
            deferred.resolve({ id: 1, name: 'Naruto' });
        });

        expect(result.current.isLoading).toBe(false);
        expect(result.current.data).toEqual({ id: 1, name: 'Naruto' });
        expect(result.current.error).toBeNull();
    });

    it('handles request failure and captures the error state', async () => {
        const deferred = createDeferred<string>();
        const request = vi.fn().mockImplementation(() => deferred.promise);

        const { result } = renderHook(() => useAsyncLoad(request, []));

        expect(result.current.isLoading).toBe(true);

        await waitFor(() => {
            expect(request).toHaveBeenCalledTimes(1);
        });

        const testError = new Error('Network failure');
        await act(async () => {
            deferred.reject(testError);
        });

        expect(result.current.isLoading).toBe(false);
        expect(result.current.data).toBeUndefined();
        expect(result.current.error).toBe(testError);
    });

    it('triggers a refetch on manual reload() and resets error', async () => {
        let callCount = 0;
        const request = vi.fn().mockImplementation(async () => {
            callCount++;
            if (callCount === 1) {
                throw new Error('First call failed');
            }
            return 'Reload succeeded';
        });

        const { result } = renderHook(() => useAsyncLoad(request, []));

        await waitFor(() => {
            expect(result.current.isLoading).toBe(false);
        });
        expect(result.current.error).toBeInstanceOf(Error);
        expect(request).toHaveBeenCalledTimes(1);

        // Trigger manual reload
        await act(async () => {
            result.current.reload();
        });

        await waitFor(() => {
            expect(result.current.isLoading).toBe(false);
        });

        expect(request).toHaveBeenCalledTimes(2);
        expect(result.current.error).toBeNull();
        expect(result.current.data).toBe('Reload succeeded');
    });

    it('prevents out-of-order race conditions when dependencies change', async () => {
        const deferred1 = createDeferred<string>();
        const deferred2 = createDeferred<string>();

        const request = vi.fn().mockImplementation(() => {
            if (request.mock.calls.length === 1) {
                return deferred1.promise;
            }
            return deferred2.promise;
        });

        let currentDep = 'dep-1';
        const { result, rerender } = renderHook(
            ({ dep }) => useAsyncLoad(request, [dep]),
            { initialProps: { dep: currentDep } }
        );

        await waitFor(() => {
            expect(request).toHaveBeenCalledTimes(1);
        });

        // Change dependency: triggers second request and aborts first
        currentDep = 'dep-2';
        rerender({ dep: currentDep });

        await waitFor(() => {
            expect(request).toHaveBeenCalledTimes(2);
        });

        // Resolve request 2 FIRST (newer request)
        await act(async () => {
            deferred2.resolve('Fresh Data (dep-2)');
        });

        expect(result.current.data).toBe('Fresh Data (dep-2)');
        expect(result.current.isLoading).toBe(false);

        // Now resolve request 1 LATER (stale out-of-order request)
        await act(async () => {
            deferred1.resolve('Stale Data (dep-1)');
        });

        // Data MUST remain the fresh data from dep-2!
        expect(result.current.data).toBe('Fresh Data (dep-2)');
        expect(result.current.error).toBeNull();
    });

    it('aborts in-flight request and ignores aborted error when dependencies change', async () => {
        const signals: AbortSignal[] = [];
        const deferred1 = createDeferred<string>();
        const deferred2 = createDeferred<string>();

        const request = vi.fn().mockImplementation((signal: AbortSignal) => {
            signals.push(signal);
            return signals.length === 1 ? deferred1.promise : deferred2.promise;
        });

        const { result, rerender } = renderHook(
            ({ id }) => useAsyncLoad(request, [id]),
            { initialProps: { id: 10 } }
        );

        await waitFor(() => {
            expect(signals.length).toBe(1);
        });
        expect(signals[0].aborted).toBe(false);

        // Changing dependency should abort first controller
        rerender({ id: 20 });

        await waitFor(() => {
            expect(signals.length).toBe(2);
        });
        expect(signals[0].aborted).toBe(true);
        expect(signals[1].aborted).toBe(false);

        // Even if first promise rejects due to abort, it must not pollute error state
        await act(async () => {
            deferred1.reject(new DOMException('Aborted', 'AbortError'));
            deferred2.resolve('Data 20');
        });

        expect(result.current.data).toBe('Data 20');
        expect(result.current.error).toBeNull();
    });

    it('cancels in-flight task on component unmount and prevents state updates', async () => {
        let capturedSignal: AbortSignal | null = null;
        const deferred = createDeferred<string>();

        const request = vi.fn().mockImplementation((signal: AbortSignal) => {
            capturedSignal = signal;
            return deferred.promise;
        });

        const { unmount } = renderHook(() => useAsyncLoad(request, []));

        await waitFor(() => {
            expect(capturedSignal).not.toBeNull();
        });
        expect(capturedSignal!.aborted).toBe(false);

        // Unmount
        unmount();

        expect(capturedSignal!.aborted).toBe(true);

        // Resolving deferred after unmount should not cause uncaught error or state warning
        await act(async () => {
            deferred.resolve('late data');
        });
    });

    it('respects enabled toggling (false -> true -> false -> true)', async () => {
        const request = vi.fn().mockImplementation(async () => 'Active Data');

        const { result, rerender } = renderHook(
            ({ enabled }) => useAsyncLoad(request, [], { enabled }),
            { initialProps: { enabled: false } }
        );

        // Initial state with enabled: false
        expect(result.current.isLoading).toBe(false);
        expect(result.current.data).toBeUndefined();
        expect(request).not.toHaveBeenCalled();

        // Toggle to true
        rerender({ enabled: true });

        await waitFor(() => {
            expect(result.current.data).toBe('Active Data');
        });
        expect(result.current.isLoading).toBe(false);
        expect(request).toHaveBeenCalledTimes(1);

        // Toggle back to false
        rerender({ enabled: false });
        expect(result.current.isLoading).toBe(false);
        expect(request).toHaveBeenCalledTimes(1);

        // Toggle to true again
        rerender({ enabled: true });
        await waitFor(() => {
            expect(request).toHaveBeenCalledTimes(2);
        });
        await waitFor(() => {
            expect(result.current.isLoading).toBe(false);
        });
    });
});

describe('API Client (src/shared/apiClient.ts)', () => {
    const originalFetch = globalThis.fetch;
    beforeEach(() => {
        vi.restoreAllMocks();
    });
    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    describe('getApiUrl', () => {
        it('constructs base API URL with path and properly encodes token parameter', () => {
            expect(getApiUrl('/releases/latest', 'my-token')).toBe(
                'https://api-s.anixsekai.com/releases/latest?token=my-token'
            );
        });

        it('omits token query param when token is empty string', () => {
            expect(getApiUrl('/releases/popular', '')).toBe(
                'https://api-s.anixsekai.com/releases/popular'
            );
        });

        it('handles special characters in token with proper URL encoding', () => {
            const complexToken = 'tok+val/123==&param=hack';
            const url = new URL(getApiUrl('/test', complexToken));
            expect(url.searchParams.get('token')).toBe(complexToken);
        });
    });

    it('cancels direct and proxied JSON POST requests while preserving the request payload', async () => {
        for (const post of [apiPost, apiPostViaAgent]) {
            const controller = new AbortController();
            const request = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
                init?.signal?.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true });
            }));
            globalThis.fetch = request;
            const pending = post('/filter/1', 'fixture-token', { sort: 3 }, { 'Api-Version': 'v2' }, { signal: controller.signal });
            expect(request.mock.calls[0][1]).toMatchObject({
                method: 'POST', body: JSON.stringify({ sort: 3 }), signal: controller.signal,
                headers: { 'Content-Type': 'application/json', 'Api-Version': 'v2' },
            });
            controller.abort();
            await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
        }
    });

    describe('getJson & error handling', () => {
        it('returns parsed JSON data on successful HTTP and API response', async () => {
            globalThis.fetch = vi.fn().mockResolvedValue({
                ok: true,
                status: 200,
                json: async () => ({ code: 0, profile: { id: 1 } }),
            } as Response);

            const result = await getJson<{ code: number; profile: { id: number } }>('https://api-s.anixsekai.com/profile');
            expect(result).toEqual({ code: 0, profile: { id: 1 } });
        });

        it('throws an error on non-ok HTTP status (e.g. 404, 500)', async () => {
            globalThis.fetch = vi.fn().mockResolvedValue({
                ok: false,
                status: 404,
                json: async () => ({ error: 'Not found' }),
            } as Response);

            await expect(getJson('https://api-s.anixsekai.com/unknown')).rejects.toThrow('API error: 404');
        });

        it('throws an error on application error code (code !== 0)', async () => {
            globalThis.fetch = vi.fn().mockResolvedValue({
                ok: true,
                status: 200,
                json: async () => ({ code: 102, message: 'Invalid credentials' }),
            } as Response);

            await expect(getJson('https://api-s.anixsekai.com/auth')).rejects.toThrow('API error: 102');
        });

        it('allows responses without a code field', async () => {
            globalThis.fetch = vi.fn().mockResolvedValue({
                ok: true,
                status: 200,
                json: async () => ({ name: 'custom payload' }),
            } as Response);

            const result = await getJson<{ name: string }>('https://api-s.anixsekai.com/custom');
            expect(result.name).toBe('custom payload');
        });
    });

    describe('apiGet, apiPost, and apiPostForm semantics', () => {
        it('apiGet sends GET request with token in url and custom init', async () => {
            const fetchMock = vi.fn().mockResolvedValue({
                ok: true,
                json: async () => ({ code: 0, items: [] }),
            } as Response);
            globalThis.fetch = fetchMock;

            await apiGet('/items', 'my-token', { headers: { 'X-Custom': 'yes' } });

            expect(fetchMock).toHaveBeenCalledWith(
                'https://api-s.anixsekai.com/items?token=my-token',
                { headers: { 'X-Custom': 'yes' } }
            );
        });

        it('apiPost sends POST with application/json header and serialized body', async () => {
            const fetchMock = vi.fn().mockResolvedValue({
                ok: true,
                json: async () => ({ code: 0, success: true }),
            } as Response);
            globalThis.fetch = fetchMock;

            await apiPost('/update', 'my-token', { name: 'test' }, { 'Api-Version': 'v2' });

            expect(fetchMock).toHaveBeenCalledWith(
                'https://api-s.anixsekai.com/update?token=my-token',
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Api-Version': 'v2',
                    },
                    body: JSON.stringify({ name: 'test' }),
                }
            );
        });

        it('apiPostForm sends FormData without forcing JSON content-type header', async () => {
            const fetchMock = vi.fn().mockResolvedValue({
                ok: true,
                json: async () => ({ code: 0, uploaded: true }),
            } as Response);
            globalThis.fetch = fetchMock;

            const formData = new FormData();
            formData.append('file', 'data');

            await apiPostForm('/upload', 'my-token', formData);

            expect(fetchMock).toHaveBeenCalledWith(
                'https://api-s.anixsekai.com/upload?token=my-token',
                {
                    method: 'POST',
                    body: formData,
                }
            );
            // Verify Content-Type was not explicitly overwritten
            const callInit = fetchMock.mock.calls[0][1];
            expect(callInit.headers).toBeUndefined();
        });
    });

    describe('Agent proxy methods and AbortSignal propagation', () => {
        it('apiGetViaAgent routes through /agentproxy and forwards AbortSignal', async () => {
            const fetchMock = vi.fn().mockResolvedValue({
                ok: true,
                json: async () => ({ code: 0 }),
            } as Response);
            globalThis.fetch = fetchMock;

            const controller = new AbortController();
            await apiGetViaAgent('/profile', 'token-abc', { signal: controller.signal });

            const [calledUrl, calledInit] = fetchMock.mock.calls[0];
            expect(calledUrl).toContain('/agentproxy?url=');
            expect(calledUrl).toContain(encodeURIComponent('https://api-s.anixsekai.com/profile?token=token-abc'));
            expect(calledInit.signal).toBe(controller.signal);
        });

        it('apiPostViaAgent forwards Api-Version and custom headers through agent proxy', async () => {
            const fetchMock = vi.fn().mockResolvedValue({
                ok: true,
                json: async () => ({ code: 0, status: 'ok' }),
            } as Response);
            globalThis.fetch = fetchMock;

            await apiPostViaAgent(
                '/search/releases/0',
                'token-xyz',
                { query: 'test' },
                { 'Api-Version': 'v2', 'X-Session': '123' }
            );

            const [calledUrl, calledInit] = fetchMock.mock.calls[0];
            expect(calledUrl).toContain('/agentproxy?url=');
            expect(calledInit.method).toBe('POST');
            expect(calledInit.headers['Api-Version']).toBe('v2');
            expect(calledInit.headers['X-Session']).toBe('123');
            expect(calledInit.headers['Content-Type']).toBe('application/json');
            expect(calledInit.body).toBe(JSON.stringify({ query: 'test' }));
        });

        it('apiPostFormViaAgent sends FormData through agent proxy without application/json header', async () => {
            const fetchMock = vi.fn().mockResolvedValue({
                ok: true,
                json: async () => ({ code: 0 }),
            } as Response);
            globalThis.fetch = fetchMock;

            const formData = new FormData();
            formData.append('key', 'value');

            await apiPostFormViaAgent('/form-endpoint', 'token-form', formData);

            const [calledUrl, calledInit] = fetchMock.mock.calls[0];
            expect(calledUrl).toContain('/agentproxy?url=');
            expect(calledInit.method).toBe('POST');
            expect(calledInit.body).toBe(formData);
            expect(calledInit.headers).toBeUndefined();
        });
    });

    describe('useApi Hook', () => {
        it('binds current userToken from UserContext to api calls', async () => {
            const fetchMock = vi.fn().mockResolvedValue({
                ok: true,
                json: async () => ({ code: 0 }),
            } as Response);
            globalThis.fetch = fetchMock;

            const wrapper = ({ children }: { children: ReactNode }) => (
                <UserContext.Provider
                    value={{
                        userToken: 'hook-user-token-999',
                        userId: 42,
                        setUserToken: vi.fn(),
                        setUserId: vi.fn(),
                    }}
                >
                    {children}
                </UserContext.Provider>
            );

            const { result } = renderHook(() => useApi(), { wrapper });

            await result.current.get('/endpoint');
            expect(fetchMock).toHaveBeenCalledWith(
                'https://api-s.anixsekai.com/endpoint?token=hook-user-token-999',
                undefined
            );

            await result.current.post('/post-endpoint', { foo: 'bar' }, { 'Api-Version': 'v2' });
            expect(fetchMock).toHaveBeenCalledWith(
                'https://api-s.anixsekai.com/post-endpoint?token=hook-user-token-999',
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Api-Version': 'v2' },
                    body: JSON.stringify({ foo: 'bar' }),
                }
            );

            const form = new FormData();
            await result.current.postForm('/form-test', form);
            expect(fetchMock).toHaveBeenCalledWith(
                'https://api-s.anixsekai.com/form-test?token=hook-user-token-999',
                { method: 'POST', body: form }
            );

            await result.current.getViaAgent('/agent-get');
            expect(fetchMock.mock.calls[fetchMock.mock.calls.length - 1][0]).toContain('/agentproxy?url=');

            await result.current.postViaAgent('/agent-post', { x: 1 });
            expect(fetchMock.mock.calls[fetchMock.mock.calls.length - 1][0]).toContain('/agentproxy?url=');

            await result.current.postFormViaAgent('/agent-form', form);
            expect(fetchMock.mock.calls[fetchMock.mock.calls.length - 1][0]).toContain('/agentproxy?url=');
        });
    });
});

describe('Proxy Utilities (src/shared/proxy.ts)', () => {
    it('normalizes trailing slashes correctly', () => {
        expect(normalizeTrailingSlashes('http://localhost:8787///')).toBe('http://localhost:8787');
        expect(normalizeTrailingSlashes('https://example.com/api/')).toBe('https://example.com/api');
        expect(normalizeTrailingSlashes('https://example.com')).toBe('https://example.com');
    });

    it('resolves default proxy and media proxy URLs when environment variables are unset', () => {
        expect(getProxyServerUrl()).toBe(DEFAULT_PROXY_SERVER_URL);
        expect(getMediaProxyUrl()).toBe(DEFAULT_MEDIA_PROXY_URL);
    });

    it('cleans double percent-encoded URLs', () => {
        const doubleEncoded = 'https%3A%2F%2Fapi-s.anixsekai.com%2Fv1%2Ftest';
        expect(cleanTargetUrl(doubleEncoded)).toBe('https://api-s.anixsekai.com/v1/test');

        const normalUrl = 'https://api-s.anixsekai.com/v1/test';
        expect(cleanTargetUrl(normalUrl)).toBe(normalUrl);
    });

    it('validates allowed server proxy hostnames against allowlist', () => {
        expect(isAllowedServerProxyHost('https://kodikplayer.com/video/1')).toBe(true);
        expect(isAllowedServerProxyHost('https://api-s.anixsekai.com/releases')).toBe(true);
        expect(isAllowedServerProxyHost('//video.sibnet.ru/shell.php')).toBe(true);
        expect(isAllowedServerProxyHost('https://evil-hacker.com/malicious')).toBe(false);
        expect(isAllowedServerProxyHost('invalid-not-a-url')).toBe(false);

        // Verify allowlist completeness
        expect(SERVER_PROXY_ALLOWLIST.has('kodik.info')).toBe(true);
        expect(SERVER_PROXY_ALLOWLIST.has('rutube.ru')).toBe(true);
    });

    it('constructs agent proxy and cors proxy URLs properly encoded', () => {
        const base = getProxyServerUrl();
        const rawTarget = 'https://api-s.anixsekai.com/releases?sort=1&filter=all';

        const agentUrl = getAgentProxyUrl(rawTarget);
        expect(agentUrl).toBe(`${base}/agentproxy?url=${encodeURIComponent(rawTarget)}`);

        const corsUrl = getCorsProxyUrl(rawTarget);
        expect(corsUrl).toBe(`${base}/corsproxy?url=${encodeURIComponent(rawTarget)}`);
    });
});

describe('authToken (src/shared/authToken.ts)', () => {
    beforeEach(() => {
        localStorage.clear();
        // Clear all cookies
        document.cookie.split(';').forEach(cookie => {
            const eqPos = cookie.indexOf('=');
            const name = eqPos > -1 ? cookie.substring(0, eqPos).trim() : cookie.trim();
            if (name) {
                document.cookie = `${name}=; Path=/; Max-Age=0;`;
            }
        });
    });

    afterEach(() => {
        localStorage.clear();
    });

    it('returns empty string when neither cookie nor legacy localStorage token exists', () => {
        expect(getStoredUserToken()).toBe('');
    });

    it('reads stored token from cookie when present', () => {
        document.cookie = 'anixart_token=token-from-cookie; Path=/';
        expect(getStoredUserToken()).toBe('token-from-cookie');
    });

    it('migrates legacy token from localStorage to cookie, cleans localStorage, and returns migrated token', () => {
        localStorage.setItem('user_token', 'legacy-persisted-token');

        const token = getStoredUserToken();
        expect(token).toBe('legacy-persisted-token');

        // Check legacy token was removed from localStorage
        expect(localStorage.getItem('user_token')).toBeNull();

        // Check cookie was written
        expect(document.cookie).toContain('anixart_token=legacy-persisted-token');
    });

    it('setStoredUserToken writes encoded token to cookie and cleans localStorage', () => {
        localStorage.setItem('user_token', 'old');

        setStoredUserToken('my+special/token==');

        expect(localStorage.getItem('user_token')).toBeNull();
        expect(document.cookie).toContain(`anixart_token=${encodeURIComponent('my+special/token==')}`);
        expect(getStoredUserToken()).toBe('my+special/token==');
    });

    it('setStoredUserToken removes token when empty string is passed', () => {
        setStoredUserToken('active-token');
        expect(getStoredUserToken()).toBe('active-token');

        // Now clear token
        setStoredUserToken('');

        expect(getStoredUserToken()).toBe('');
        expect(localStorage.getItem('user_token')).toBeNull();
    });

    it('appends Secure flag when running under https protocol', () => {
        const cookieSpy = vi.spyOn(document, 'cookie', 'set');
        const originalLocation = window.location;

        try {
            Object.defineProperty(window, 'location', {
                value: new URL('https://anixart.tv'),
                writable: true,
                configurable: true,
            });

            setStoredUserToken('secure-token-123');

            expect(cookieSpy).toHaveBeenCalled();
            const lastSetCookie = cookieSpy.mock.calls[cookieSpy.mock.calls.length - 1][0];
            expect(lastSetCookie).toContain('; Secure');
        } finally {
            Object.defineProperty(window, 'location', {
                value: originalLocation,
                writable: true,
                configurable: true,
            });
            cookieSpy.mockRestore();
        }
    });
});
