import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError } from '../src/shared/apiClient.ts';
import {
    isNetworkError,
    isTimeoutError,
    getReadableErrorMessage,
} from '../src/shared/errorUtils.ts';

test('isNetworkError identifies network and offline failures', () => {
    assert.equal(isNetworkError(new TypeError('Failed to fetch')), true);
    assert.equal(isNetworkError(new Error('NetworkError when attempting to fetch resource.')), true);
    assert.equal(isNetworkError(new Error('A normal application error')), false);
});

test('isTimeoutError identifies timeout and abort failures', () => {
    const abortErr = new Error('The operation was aborted');
    abortErr.name = 'AbortError';
    assert.equal(isTimeoutError(abortErr), true);

    const timeoutErr = new Error('request timed out');
    timeoutErr.name = 'TimeoutError';
    assert.equal(isTimeoutError(timeoutErr), true);

    assert.equal(isTimeoutError(new Error('Other error')), false);
});

test('getReadableErrorMessage handles network and timeout errors', () => {
    const mockT = key => `translated:${key}`;

    const networkErr = new TypeError('Failed to fetch');
    assert.equal(getReadableErrorMessage(networkErr, mockT), 'translated:error.network');

    const timeoutErr = new Error('timeout occurred');
    timeoutErr.name = 'TimeoutError';
    assert.equal(getReadableErrorMessage(timeoutErr, mockT), 'translated:error.timeout');
});

test('getReadableErrorMessage handles HTTP status codes via ApiError', () => {
    const mockT = key => `translated:${key}`;

    assert.equal(getReadableErrorMessage(new ApiError(404), mockT), 'translated:error.notFound');
    assert.equal(getReadableErrorMessage(new ApiError(429), mockT), 'translated:error.rateLimit');
    assert.equal(getReadableErrorMessage(new ApiError(401), mockT), 'translated:error.forbidden');
    assert.equal(getReadableErrorMessage(new ApiError(403), mockT), 'translated:error.forbidden');
    assert.equal(getReadableErrorMessage(new ApiError(500), mockT), 'translated:error.server');
    assert.equal(getReadableErrorMessage(new ApiError(502), mockT), 'translated:error.server');
    assert.equal(getReadableErrorMessage(new ApiError(503), mockT), 'translated:error.server');
});

test('getReadableErrorMessage falls back to error message or generic key', () => {
    const mockT = key => `translated:${key}`;

    assert.equal(getReadableErrorMessage(new Error('Custom validation error'), mockT), 'Custom validation error');
    assert.equal(getReadableErrorMessage(new ApiError(418), mockT), 'translated:error.generic');
    assert.equal(getReadableErrorMessage(null, mockT), 'translated:error.generic');
});
