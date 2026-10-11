import type { AppSettings } from './types/settings';
import type { Filter } from './types/api';
import { getProxyServerUrl } from './proxy.ts';
import { parseImportedSettings, type CloudSettingsPayload } from './settingsNormalizer.ts';

export type { CloudSettingsPayload };

export const AUTO_SYNC_STORAGE = 'anixweb_auto_sync_account';

const memoryFallback = new Map<string, string>();

export function safeGetItem(key: string): string | null {
    try {
        if (typeof localStorage !== 'undefined' && typeof localStorage.getItem === 'function') {
            const val = localStorage.getItem(key);
            if (val !== null && val !== undefined) return val;
        }
    } catch {
        // Fall back to memory
    }
    return memoryFallback.get(key) ?? null;
}

export function safeSetItem(key: string, value: string): void {
    try {
        if (typeof localStorage !== 'undefined' && typeof localStorage.setItem === 'function') {
            localStorage.setItem(key, value);
        }
    } catch {
        // Fall back to memory
    }
    memoryFallback.set(key, value);
}

export function safeRemoveItem(key: string): void {
    try {
        if (typeof localStorage !== 'undefined' && typeof localStorage.removeItem === 'function') {
            localStorage.removeItem(key);
        }
    } catch {
        // Fall back to memory
    }
    memoryFallback.delete(key);
}

export function isAutoSyncAccountEnabled(): boolean {
    return safeGetItem(AUTO_SYNC_STORAGE) !== 'false';
}

export function setAutoSyncAccountEnabled(enabled: boolean): void {
    safeSetItem(AUTO_SYNC_STORAGE, enabled ? 'true' : 'false');
}

export function getAccountLastSynced(userId: number): string | null {
    return safeGetItem(`anixweb_account_last_sync_${userId}`);
}

export function validateSettingsPayload(data: unknown): CloudSettingsPayload {
    return parseImportedSettings(data);
}

// -------------------------------------------------------------------------
// Account-Bound Sync (Server)
// -------------------------------------------------------------------------

async function getAccountSession(userToken: string): Promise<string | null> {
    try {
        const serverUrl = getProxyServerUrl();
        const res = await fetch(`${serverUrl}/api/v2/session`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: userToken }),
            signal: AbortSignal.timeout(6000),
        });
        if (!res.ok) return null;
        const data = (await res.json()) as { session?: string };
        return data.session || null;
    } catch {
        return null;
    }
}

export async function saveAccountSettings(
    userToken: string,
    userId: number,
    settings: AppSettings,
    myFilters?: Filter | null,
): Promise<{ ok: boolean; serverSaved: boolean; uploadedAt: string }> {
    const uploadedAt = new Date().toISOString();
    const payload: CloudSettingsPayload = {
        version: 1,
        uploadedAt,
        settings,
        my_filters: myFilters ?? null,
    };

    const session = await getAccountSession(userToken);
    if (!session) {
        throw new Error('Failed to obtain server session');
    }

    const serverUrl = getProxyServerUrl();
    const serverRes = await fetch(`${serverUrl}/api/v2/user/settings`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session}`,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(6000),
    });

    if (!serverRes.ok) {
        throw new Error(`Failed to save settings to server: status ${serverRes.status}`);
    }

    safeSetItem(`anixweb_account_last_sync_${userId}`, uploadedAt);

    return {
        ok: true,
        serverSaved: true,
        uploadedAt,
    };
}

export async function loadAccountSettings(
    userToken: string,
    _userId?: number,
): Promise<{ payload: CloudSettingsPayload; source?: 'server' }> {
    void _userId;
    const session = await getAccountSession(userToken);
    if (!session) {
        throw new Error('Failed to obtain server session');
    }

    const serverUrl = getProxyServerUrl();
    const serverRes = await fetch(`${serverUrl}/api/v2/user/settings`, {
        headers: {
            Authorization: `Bearer ${session}`,
        },
        signal: AbortSignal.timeout(6000),
    });

    if (!serverRes.ok) {
        if (serverRes.status === 404) {
            throw new Error('NO_ACCOUNT_SETTINGS');
        }
        throw new Error(`Failed to load settings from server: status ${serverRes.status}`);
    }

    const json = (await serverRes.json()) as { ok?: boolean; settings?: unknown };
    if (!json.settings) {
        throw new Error('NO_ACCOUNT_SETTINGS');
    }

    const validated = validateSettingsPayload(json.settings);
    return { payload: validated, source: 'server' };
}
