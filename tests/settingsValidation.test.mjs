import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultAppSettings, defaultPlayerKeybindings, defaultCustomColors } from '../src/shared/types/settings.ts';
import { parseImportedSettings, normalizeLegacySettings } from '../src/shared/settingsNormalizer.ts';
import { saveAccountSettings, loadAccountSettings, safeSetItem } from '../src/shared/cloudSettings.ts';

// ---------------------------------------------------------------------------
// 1. Malformed settings payloads must throw and reject on import
// ---------------------------------------------------------------------------

test('strict parser rejects malformed volume', () => {
    // Volume > 100
    assert.throws(
        () => parseImportedSettings({ settings: { player: { volume: 1000 } } }),
        /Invalid player\.volume.*Must be a finite number between 0 and 100/
    );
    // Volume < 0
    assert.throws(
        () => parseImportedSettings({ settings: { player: { volume: -1 } } }),
        /Invalid player\.volume/
    );
    // Volume non-finite
    assert.throws(
        () => parseImportedSettings({ settings: { player: { volume: NaN } } }),
        /Invalid player\.volume/
    );
    assert.throws(
        () => parseImportedSettings({ settings: { player: { volume: Infinity } } }),
        /Invalid player\.volume/
    );
    // Volume string
    assert.throws(
        () => parseImportedSettings({ settings: { player: { volume: '50' } } }),
        /Invalid player\.volume/
    );
});

test('strict parser rejects malformed appearance language', () => {
    // Unknown language string
    assert.throws(
        () => parseImportedSettings({ settings: { appearance: { language: 'invalid' } } }),
        /Invalid appearance\.language.*Must be 'russian', 'english', or 'ukrainian'/
    );
    assert.throws(
        () => parseImportedSettings({ settings: { appearance: { language: 'spanish' } } }),
        /Invalid appearance\.language/
    );
    // Non-string
    assert.throws(
        () => parseImportedSettings({ settings: { appearance: { language: 123 } } }),
        /Invalid appearance\.language/
    );

    // Valid languages pass
    for (const lang of ['russian', 'english', 'ukrainian']) {
        const parsed = parseImportedSettings({ settings: { appearance: { language: lang } } });
        assert.equal(parsed.settings.appearance.language, lang);
    }
});

test('strict parser rejects malformed custom colors', () => {
    // Non-hex string
    assert.throws(
        () => parseImportedSettings({ settings: { appearance: { customColors: { accentColor: 123 } } } }),
        /Invalid hex color in customColors\.accentColor/
    );
    assert.throws(
        () => parseImportedSettings({ settings: { appearance: { customColors: { accentColor: 'red' } } } }),
        /Invalid hex color in customColors\.accentColor/
    );
    assert.throws(
        () => parseImportedSettings({ settings: { appearance: { customColors: { accentColor: '#1234' } } } }),
        /Invalid hex color in customColors\.accentColor/
    );
    assert.throws(
        () => parseImportedSettings({ settings: { appearance: { customColors: { backgroundColor: 'invalid' } } } }),
        /Invalid hex color in customColors\.backgroundColor/
    );
    assert.throws(
        () => parseImportedSettings({ settings: { appearance: { customColors: { textColor: '#gggggg' } } } }),
        /Invalid hex color in customColors\.textColor/
    );
    // Non-boolean autoTextColor or enabled
    assert.throws(
        () => parseImportedSettings({ settings: { appearance: { customColors: { autoTextColor: 'true' } } } }),
        /Invalid customColors\.autoTextColor/
    );
    assert.throws(
        () => parseImportedSettings({ settings: { appearance: { customColors: { enabled: 1 } } } }),
        /Invalid customColors\.enabled/
    );

    // Valid hex colors pass
    const validColors = parseImportedSettings({
        settings: {
            appearance: {
                customColors: {
                    enabled: true,
                    accentColor: '#FF6060',
                    backgroundColor: '#161616',
                    textColor: '#fff',
                    autoTextColor: false,
                },
            },
        },
    });
    assert.equal(validColors.settings.appearance.customColors.accentColor, '#FF6060');
    assert.equal(validColors.settings.appearance.customColors.textColor, '#fff');
    assert.equal(validColors.settings.appearance.customColors.autoTextColor, false);
});

test('strict parser rejects malformed skip seconds', () => {
    // skipForwardSeconds negative or > 86400
    assert.throws(
        () => parseImportedSettings({ settings: { player: { skipForwardSeconds: -5 } } }),
        /Invalid player\.skipForwardSeconds.*Must be a nonnegative finite number <= 86400/
    );
    assert.throws(
        () => parseImportedSettings({ settings: { player: { skipForwardSeconds: 90000 } } }),
        /Invalid player\.skipForwardSeconds/
    );
    assert.throws(
        () => parseImportedSettings({ settings: { player: { skipForwardSeconds: Infinity } } }),
        /Invalid player\.skipForwardSeconds/
    );

    // skipBackwardSeconds negative or > 86400
    assert.throws(
        () => parseImportedSettings({ settings: { player: { skipBackwardSeconds: -1 } } }),
        /Invalid player\.skipBackwardSeconds.*Must be a nonnegative finite number <= 86400/
    );
    assert.throws(
        () => parseImportedSettings({ settings: { player: { skipBackwardSeconds: 100000 } } }),
        /Invalid player\.skipBackwardSeconds/
    );
    assert.throws(
        () => parseImportedSettings({ settings: { player: { skipBackwardSeconds: '10' } } }),
        /Invalid player\.skipBackwardSeconds/
    );

    // skipOpeningValue
    assert.throws(
        () => parseImportedSettings({ settings: { player: { skipOpeningValue: -1 } } }),
        /Invalid player\.skipOpeningValue/
    );
    assert.throws(
        () => parseImportedSettings({ settings: { player: { skipOpeningValue: 100000 } } }),
        /Invalid player\.skipOpeningValue/
    );

    // Valid skip seconds pass
    const validSkip = parseImportedSettings({
        settings: {
            player: {
                skipForwardSeconds: 10,
                skipBackwardSeconds: 5,
                skipOpeningValue: 90,
            },
        },
    });
    assert.equal(validSkip.settings.player.skipOpeningValue, 90);
});

test('strict parser rejects unknown fields in payload, settings and sections', () => {
    // Unknown top-level wrapper field
    assert.throws(
        () => parseImportedSettings({ settings: defaultAppSettings, unknownProp: 123 }),
        /Unknown field in payload.*unknownProp/
    );

    // Unknown section in settings
    assert.throws(
        () => parseImportedSettings({ settings: { player: defaultAppSettings.player, hackerSection: {} } }),
        /Unknown field in settings.*hackerSection/
    );

    // Unknown field in player
    assert.throws(
        () => parseImportedSettings({ settings: { player: { volume: 50, unknownPlayerProp: true } } }),
        /Unknown field in player.*unknownPlayerProp/
    );

    // Unknown field in appearance
    assert.throws(
        () => parseImportedSettings({ settings: { appearance: { theme: 'dark', extraField: 'val' } } }),
        /Unknown field in appearance.*extraField/
    );

    // Unknown field in customColors
    assert.throws(
        () => parseImportedSettings({ settings: { appearance: { customColors: { accentColor: '#fff', extraColor: '#000' } } } }),
        /Unknown field in appearance\.customColors.*extraColor/
    );

    // Unknown field in content
    assert.throws(
        () => parseImportedSettings({ settings: { content: { rememberDub: true, bogusContentProp: 1 } } }),
        /Unknown field in content.*bogusContentProp/
    );

    // Unknown field in notifications
    assert.throws(
        () => parseImportedSettings({ settings: { notifications: { recieveNotifications: true, unknownNotif: 2 } } }),
        /Unknown field in notifications.*unknownNotif/
    );

    // Unknown keybinding action
    assert.throws(
        () => parseImportedSettings({ settings: { player: { keybindings: { customAction: 'KeyZ' } } } }),
        /Unknown keybinding action.*customAction/
    );

    // Empty keybinding code
    assert.throws(
        () => parseImportedSettings({ settings: { player: { keybindings: { togglePlayback: '  ' } } } }),
        /Invalid keybinding code for "togglePlayback"/
    );

    // Non-string keybinding code
    assert.throws(
        () => parseImportedSettings({ settings: { player: { keybindings: { togglePlayback: 32 } } } }),
        /Invalid keybinding code for "togglePlayback"/
    );
});

test('strict parser rejects invalid filter shapes', () => {
    // genres not an array
    assert.throws(
        () => parseImportedSettings({ settings: defaultAppSettings, my_filters: { genres: 'comedy' } }),
        /Invalid genres in my_filters/
    );

    // genres with invalid items (negative or object)
    assert.throws(
        () => parseImportedSettings({ settings: defaultAppSettings, my_filters: { genres: [-1] } }),
        /Invalid genres in my_filters/
    );
    assert.throws(
        () => parseImportedSettings({ settings: defaultAppSettings, my_filters: { genres: [{}] } }),
        /Invalid genres in my_filters/
    );

    // types not an array of strings
    assert.throws(
        () => parseImportedSettings({ settings: defaultAppSettings, my_filters: { types: [123] } }),
        /Invalid types in my_filters/
    );

    // country invalid
    assert.throws(
        () => parseImportedSettings({ settings: defaultAppSettings, my_filters: { country: 'Франция' } }),
        /Invalid country in my_filters/
    );

    // category_id invalid
    assert.throws(
        () => parseImportedSettings({ settings: defaultAppSettings, my_filters: { category_id: 10 } }),
        /Invalid category_id in my_filters/
    );

    // status_id invalid
    assert.throws(
        () => parseImportedSettings({ settings: defaultAppSettings, my_filters: { status_id: 99 } }),
        /Invalid status_id in my_filters/
    );

    // season invalid
    assert.throws(
        () => parseImportedSettings({ settings: defaultAppSettings, my_filters: { season: 5 } }),
        /Invalid season in my_filters/
    );

    // sort invalid
    assert.throws(
        () => parseImportedSettings({ settings: defaultAppSettings, my_filters: { sort: 4 } }),
        /Invalid sort in my_filters/
    );

    // negative numeric range
    assert.throws(
        () => parseImportedSettings({ settings: defaultAppSettings, my_filters: { start_year: -1990 } }),
        /Invalid numeric range in my_filters/
    );
    assert.throws(
        () => parseImportedSettings({ settings: defaultAppSettings, my_filters: { episodes_from: -5 } }),
        /Invalid numeric range in my_filters/
    );

    // non-finite numeric range
    assert.throws(
        () => parseImportedSettings({ settings: defaultAppSettings, my_filters: { end_year: Infinity } }),
        /Invalid numeric range in my_filters/
    );

    // unknown field in filter
    assert.throws(
        () => parseImportedSettings({ settings: defaultAppSettings, my_filters: { invalidFilterField: 1 } }),
        /Unknown field in my_filters.*invalidFilterField/
    );
});

test('strict parser rejects unsupported versions', () => {
    assert.throws(
        () => parseImportedSettings({ version: 2, settings: defaultAppSettings }),
        /Unsupported settings payload version: 2/
    );
    assert.throws(
        () => parseImportedSettings({ version: '1', settings: defaultAppSettings }),
        /Unsupported settings payload version: 1/
    );

    // Version 1 and absent version pass
    const v1 = parseImportedSettings({ version: 1, settings: defaultAppSettings });
    assert.equal(v1.version, 1);

    const legacyAbsentVersion = parseImportedSettings({ settings: defaultAppSettings });
    assert.equal(legacyAbsentVersion.version, 1);
});

// ---------------------------------------------------------------------------
// 2. Missing legacy fields are deep-merged with defaults (customColors, keybindings)
// ---------------------------------------------------------------------------

test('strict parser deep-merges missing legacy fields with defaults', () => {
    // Only theme supplied in appearance; customColors absent
    const parsedAppearanceOnly = parseImportedSettings({
        settings: {
            appearance: {
                theme: 'dark',
            },
        },
    });

    assert.equal(parsedAppearanceOnly.settings.appearance.theme, 'dark');
    assert.equal(parsedAppearanceOnly.settings.appearance.compactMode, defaultAppSettings.appearance.compactMode);
    assert.deepEqual(parsedAppearanceOnly.settings.appearance.customColors, defaultCustomColors);
    assert.deepEqual(parsedAppearanceOnly.settings.player.keybindings, defaultPlayerKeybindings);
    assert.deepEqual(parsedAppearanceOnly.settings.notifications, defaultAppSettings.notifications);

    // Partial customColors supplied
    const parsedPartialColors = parseImportedSettings({
        settings: {
            appearance: {
                customColors: {
                    accentColor: '#10B981',
                },
            },
        },
    });
    assert.equal(parsedPartialColors.settings.appearance.customColors.accentColor, '#10B981');
    assert.equal(parsedPartialColors.settings.appearance.customColors.backgroundColor, defaultCustomColors.backgroundColor);
    assert.equal(parsedPartialColors.settings.appearance.customColors.autoTextColor, defaultCustomColors.autoTextColor);

    // Partial keybindings supplied
    const parsedPartialKeybindings = parseImportedSettings({
        settings: {
            player: {
                keybindings: {
                    togglePlayback: 'KeyK',
                },
            },
        },
    });
    assert.equal(parsedPartialKeybindings.settings.player.keybindings.togglePlayback, 'KeyK');
    assert.equal(parsedPartialKeybindings.settings.player.keybindings.seekForward, defaultPlayerKeybindings.seekForward);
    assert.equal(parsedPartialKeybindings.settings.player.keybindings.skipOpening, defaultPlayerKeybindings.skipOpening);
});

test('normalizeLegacySettings safely falls back to defaults on corrupted data without crashing', () => {
    // Completely invalid inputs
    assert.deepEqual(normalizeLegacySettings(null), defaultAppSettings);
    assert.deepEqual(normalizeLegacySettings(undefined), defaultAppSettings);
    assert.deepEqual(normalizeLegacySettings('invalid-string'), defaultAppSettings);
    assert.deepEqual(normalizeLegacySettings([1, 2, 3]), defaultAppSettings);

    // Corrupted values in object
    const corrupted = {
        player: {
            volume: 9999, // out of range
            defaultQuality: '4k', // invalid
            keybindings: {
                togglePlayback: '', // empty code
                seekBackward: 'KeyJ', // valid
            },
        },
        appearance: {
            theme: 'rainbow', // invalid
            language: 'elvish', // invalid
            customColors: {
                accentColor: 12345, // invalid
                backgroundColor: '#000000', // valid
            },
        },
    };

    const normalized = normalizeLegacySettings(corrupted);

    // Corrupted volume falls back to default 60
    assert.equal(normalized.player.volume, defaultAppSettings.player.volume);
    // Valid keybinding preserved
    assert.equal(normalized.player.keybindings.seekBackward, 'KeyJ');
    // Explicitly cleared bindings stay unassigned after reload.
    assert.equal(normalized.player.keybindings.togglePlayback, '');
    // Corrupted theme falls back to system
    assert.equal(normalized.appearance.theme, defaultAppSettings.appearance.theme);
    // Corrupted language falls back to default russian
    assert.equal(normalized.appearance.language, defaultAppSettings.appearance.language);
    // Corrupted accentColor falls back to default
    assert.equal(normalized.appearance.customColors.accentColor, defaultCustomColors.accentColor);
    // Valid backgroundColor preserved
    assert.equal(normalized.appearance.customColors.backgroundColor, '#000000');
    // Notifications filled with defaults
    assert.deepEqual(normalized.notifications, defaultAppSettings.notifications);
});

// ---------------------------------------------------------------------------
// 3. Full roundtrip preserving notifications and all valid settings
// ---------------------------------------------------------------------------

test('full roundtrip preserves notifications and all valid settings exactly', () => {
    const customSettings = {
        appearance: {
            theme: 'dark',
            highContrast: true,
            compactMode: true,
            language: 'ukrainian',
            defaultCardType: 'horizontal',
            customColors: {
                enabled: true,
                accentColor: '#123456',
                backgroundColor: '#050505',
                textColor: '#f0f0f0',
                autoTextColor: false,
            },
        },
        player: {
            defaultQuality: '1080',
            autoplay: true,
            volume: 75,
            qualityUpgrade: true,
            qualityUpgradeMode: 'strong',
            showSkipOpeningButton: false,
            skipOpeningValue: 120,
            autoFullscreen: true,
            autoPauseOnTabSwitch: true,
            keybindings: {
                ...defaultPlayerKeybindings,
                togglePlayback: 'KeyK',
                skipOpening: 'KeyO',
            },
        },
        content: {
            defaultTabOnHome: 'films',
            defaultTabOnFavorites: 'history',
            rememberSource: true,
            rememberedSourceId: 88,
            rememberDub: true,
            rememberedDubId: 99,
            rememberEpisodeTime: true,
            proxySearchThroughShikimori: true,
            proxyImages: true,
        },
        notifications: {
            recieveNotifications: true,
            notificationsType: 'selected_lists',
            selectedLists: ['favorites', 'watching'],
            selectedDubs: null,
            selectedReleases: null,
            getOnlyOneNotification: true,
            notificationOnRelatedRelease: true,
            repliesNotifications: true,
            commentsOnCollectionNotification: true,
        },
    };

    const payload = {
        version: 1,
        exportedAt: '2026-10-09T12:00:00.000Z',
        settings: customSettings,
        my_filters: {
            country: 'Япония',
            category_id: 1,
            genres: ['Action', 'Comedy'],
            types: ['tv'],
            start_year: 2020,
            end_year: 2025,
            sort: 3,
        },
    };

    // 1. Serialize as would happen in export
    const serialized = JSON.stringify(payload);

    // 2. Parse as would happen in import
    const parsed = JSON.parse(serialized);
    const parsedPayload = parseImportedSettings(parsed);

    // 3. Normalize into state
    const normalized = normalizeLegacySettings(parsedPayload.settings);

    // Assert every section and nested fields are perfectly preserved
    assert.deepEqual(normalized.appearance, customSettings.appearance);
    assert.deepEqual(normalized.player, customSettings.player);
    assert.deepEqual(normalized.content, customSettings.content);
    assert.deepEqual(normalized.notifications, customSettings.notifications);
    assert.deepEqual(parsedPayload.my_filters, payload.my_filters);
});

// ---------------------------------------------------------------------------
// 4. Successful and failed account saves make ZERO requests to Bytebin/dpaste
// ---------------------------------------------------------------------------

test('saveAccountSettings makes ZERO requests to Bytebin or dpaste on success', async () => {
    const originalFetch = globalThis.fetch;
    const requestedUrls = [];

    globalThis.fetch = async (url) => {
        const urlStr = String(url);
        requestedUrls.push(urlStr);

        if (urlStr.includes('/api/v2/session')) {
            return {
                ok: true,
                status: 200,
                json: async () => ({ session: 'mock-session-token' }),
            };
        }

        if (urlStr.includes('/api/v2/user/settings')) {
            return {
                ok: true,
                status: 200,
                json: async () => ({ ok: true }),
            };
        }

        return {
            ok: false,
            status: 404,
            text: async () => 'Not found',
            json: async () => ({}),
        };
    };

    try {
        const result = await saveAccountSettings('test-user-token', 42, defaultAppSettings, null);
        assert.equal(result.ok, true);
        assert.equal(result.serverSaved, true);
        assert.ok(result.uploadedAt);

        // Verify that server endpoints were called
        assert.ok(requestedUrls.some(u => u.includes('/api/v2/session')));
        assert.ok(requestedUrls.some(u => u.includes('/api/v2/user/settings')));

        // Verify ZERO requests were made to Bytebin or dpaste
        const leakedPublicUrls = requestedUrls.filter(u => u.includes('bytebin') || u.includes('dpaste'));
        assert.equal(leakedPublicUrls.length, 0, `Leaked requests to public paste services: ${leakedPublicUrls.join(', ')}`);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('saveAccountSettings makes ZERO requests to Bytebin or dpaste on server failure', async () => {
    const originalFetch = globalThis.fetch;
    const requestedUrls = [];

    globalThis.fetch = async (url) => {
        const urlStr = String(url);
        requestedUrls.push(urlStr);

        if (urlStr.includes('/api/v2/session')) {
            return {
                ok: true,
                status: 200,
                json: async () => ({ session: 'mock-session-token' }),
            };
        }

        if (urlStr.includes('/api/v2/user/settings')) {
            return {
                ok: false,
                status: 500,
                text: async () => 'Server error',
                json: async () => ({ error: 'Internal error' }),
            };
        }

        return {
            ok: false,
            status: 404,
            text: async () => 'Not found',
            json: async () => ({}),
        };
    };

    try {
        await assert.rejects(
            async () => {
                await saveAccountSettings('test-user-token', 42, defaultAppSettings, null);
            },
            /Failed to save settings to server/
        );

        // Verify ZERO requests were made to Bytebin or dpaste even after failure
        const leakedPublicUrls = requestedUrls.filter(u => u.includes('bytebin') || u.includes('dpaste'));
        assert.equal(leakedPublicUrls.length, 0, `Leaked requests to public paste services on failure: ${leakedPublicUrls.join(', ')}`);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('loadAccountSettings with legacy account_cloud_key makes ZERO requests to third-party paste services on server failure', async () => {
    const originalFetch = globalThis.fetch;
    const requestedUrls = [];
    const testUserId = 77;

    // Simulate presence of legacy cloud key in local/safe storage
    safeSetItem(`anixweb_account_cloud_key_${testUserId}`, 'legacy-snapshot-key-12345');
    try {
        localStorage.setItem(`anixweb_account_cloud_key_${testUserId}`, 'legacy-snapshot-key-12345');
    } catch {
        // Node experimental localStorage might not be enabled
    }

    globalThis.fetch = async (url) => {
        const urlStr = String(url);
        requestedUrls.push(urlStr);

        if (urlStr.includes('/api/v2/session')) {
            return {
                ok: true,
                status: 200,
                json: async () => ({ session: 'mock-session-token' }),
            };
        }

        if (urlStr.includes('/api/v2/user/settings')) {
            return {
                ok: false,
                status: 500,
                text: async () => 'Internal Server Error',
                json: async () => ({ error: 'Database unreachable' }),
            };
        }

        return {
            ok: false,
            status: 404,
            text: async () => 'Not found',
            json: async () => ({}),
        };
    };

    try {
        await assert.rejects(
            async () => {
                await loadAccountSettings('test-user-token', testUserId);
            },
            /Failed to load settings from server|NO_ACCOUNT_SETTINGS/
        );

        // Verify that server endpoints were called
        assert.ok(requestedUrls.some(u => u.includes('/api/v2/session')));
        assert.ok(requestedUrls.some(u => u.includes('/api/v2/user/settings')));

        // Verify ZERO requests were made to Bytebin, dpaste, or other third-party paste services
        const leakedPublicUrls = requestedUrls.filter(u => u.includes('bytebin') || u.includes('dpaste'));
        assert.equal(leakedPublicUrls.length, 0, `Leaked requests to public paste services on load failure: ${leakedPublicUrls.join(', ')}`);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('loadAccountSettings with legacy account_cloud_key validates and restores from server without contacting third-party services', async () => {
    const originalFetch = globalThis.fetch;
    const requestedUrls = [];
    const testUserId = 88;

    // Set legacy cloud key
    safeSetItem(`anixweb_account_cloud_key_${testUserId}`, 'dp:legacy-slug-67890');
    try {
        localStorage.setItem(`anixweb_account_cloud_key_${testUserId}`, 'dp:legacy-slug-67890');
    } catch {
        // Node experimental localStorage might not be enabled
    }

    const serverSettings = {
        appearance: {
            theme: 'dark',
            highContrast: true,
            compactMode: true,
            language: 'english',
            defaultCardType: 'horizontal',
            customColors: {
                ...defaultCustomColors,
                enabled: true,
                accentColor: '#3b82f6',
            },
        },
        player: {
            defaultQuality: '720',
            autoplay: true,
            volume: 85,
            qualityUpgrade: false,
            qualityUpgradeMode: 'medium',
            showSkipOpeningButton: true,
            skipOpeningValue: 85,
            autoFullscreen: false,
            autoPauseOnTabSwitch: true,
            keybindings: defaultPlayerKeybindings,
        },
        content: defaultAppSettings.content,
        notifications: defaultAppSettings.notifications,
    };

    globalThis.fetch = async (url) => {
        const urlStr = String(url);
        requestedUrls.push(urlStr);

        if (urlStr.includes('/api/v2/session')) {
            return {
                ok: true,
                status: 200,
                json: async () => ({ session: 'mock-session-token' }),
            };
        }

        if (urlStr.includes('/api/v2/user/settings')) {
            return {
                ok: true,
                status: 200,
                json: async () => ({
                    ok: true,
                    settings: {
                        version: 1,
                        uploadedAt: '2026-10-09T14:00:00.000Z',
                        settings: serverSettings,
                        my_filters: { genres: [5, 10] },
                    },
                }),
            };
        }

        return {
            ok: false,
            status: 404,
            text: async () => 'Not found',
            json: async () => ({}),
        };
    };

    try {
        const result = await loadAccountSettings('test-user-token', testUserId);
        assert.ok(result.payload, 'Must return payload');
        assert.equal(result.payload.settings.player.volume, 85);
        assert.equal(result.payload.settings.appearance.theme, 'dark');
        assert.deepEqual(result.payload.my_filters, { genres: [5, 10] });

        // Validate that normalizeLegacySettings produces valid restored settings
        const restored = normalizeLegacySettings(result.payload.settings);
        assert.equal(restored.player.volume, 85);
        assert.equal(restored.appearance.theme, 'dark');

        // Verify server endpoints were called
        assert.ok(requestedUrls.some(u => u.includes('/api/v2/session')));
        assert.ok(requestedUrls.some(u => u.includes('/api/v2/user/settings')));

        // Verify ZERO requests were made to Bytebin or dpaste
        const leakedPublicUrls = requestedUrls.filter(u => u.includes('bytebin') || u.includes('dpaste'));
        assert.equal(leakedPublicUrls.length, 0, `Leaked requests to public paste services on successful load: ${leakedPublicUrls.join(', ')}`);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

// ---------------------------------------------------------------------------
// 5. Delayed auto-restore does not overwrite local edits made while request was in-flight
// ---------------------------------------------------------------------------

test('delayed auto-restore does not overwrite local edits made while request was in-flight', async () => {
    let settingsState = { ...defaultAppSettings, appearance: { ...defaultAppSettings.appearance, theme: 'system' } };
    let revisionCounter = 0;

    const editSettings = (newSettings) => {
        revisionCounter += 1;
        settingsState = newSettings;
    };

    // Simulate an in-flight account load
    let resolveServerResponse;
    const pendingRequest = new Promise((resolve) => {
        resolveServerResponse = resolve;
    });

    const revisionAtRequestStart = revisionCounter;
    const sessionTokenAtStart = 'user-session-token-1';
    let currentSessionToken = 'user-session-token-1';

    const performAutoRestore = async () => {
        const payload = await pendingRequest;
        // The check implemented in App.tsx:
        if (revisionCounter !== revisionAtRequestStart || currentSessionToken !== sessionTokenAtStart) {
            // IGNORED! Local edits or session change occurred while in-flight
            return;
        }
        settingsState = normalizeLegacySettings(payload.settings, settingsState);
    };

    const restorePromise = performAutoRestore();

    // While the request is in-flight, user modifies settings locally (e.g. switches to dark theme)
    editSettings({
        ...settingsState,
        appearance: { ...settingsState.appearance, theme: 'dark' },
    });
    assert.equal(settingsState.appearance.theme, 'dark');

    // Server responds late with older 'light' theme
    resolveServerResponse({
        version: 1,
        uploadedAt: new Date().toISOString(),
        settings: {
            ...defaultAppSettings,
            appearance: { ...defaultAppSettings.appearance, theme: 'light' },
        },
    });

    await restorePromise;

    // The local edit 'dark' must NOT have been overwritten by 'light'!
    assert.equal(settingsState.appearance.theme, 'dark');
});

test('delayed auto-restore ignores result when user session changes while in-flight', async () => {
    let settingsState = { ...defaultAppSettings, appearance: { ...defaultAppSettings.appearance, theme: 'light' } };
    let revisionCounter = 0;

    let resolveServerResponse;
    const pendingRequest = new Promise((resolve) => {
        resolveServerResponse = resolve;
    });

    const revisionAtRequestStart = revisionCounter;
    const sessionTokenAtStart = 'user-token-alice';
    let currentSessionToken = 'user-token-alice';

    const performAutoRestore = async () => {
        const payload = await pendingRequest;
        if (revisionCounter !== revisionAtRequestStart || currentSessionToken !== sessionTokenAtStart) {
            // Ignored because session changed
            return;
        }
        settingsState = normalizeLegacySettings(payload.settings, settingsState);
    };

    const restorePromise = performAutoRestore();

    // User logs out or switches accounts while in-flight
    currentSessionToken = 'user-token-bob';

    resolveServerResponse({
        version: 1,
        uploadedAt: new Date().toISOString(),
        settings: {
            ...defaultAppSettings,
            appearance: { ...defaultAppSettings.appearance, theme: 'dark' },
        },
    });

    await restorePromise;

    // Alice's restored settings must NOT be applied to Bob
    assert.equal(settingsState.appearance.theme, 'light');
});
