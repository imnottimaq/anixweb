import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import { defaultAppSettings, defaultCustomColors } from '../src/shared/types/settings.ts';
import { getLuminance, getContrastRatio, getAutoTextColor, getAccentTextColor, ACCENT_COLOR_PRESETS, BACKGROUND_COLOR_PRESETS } from '../src/shared/theme.ts';

test('defaultAppSettings contains autoFullscreen, autoPauseOnTabSwitch, theme, compactMode and customColors', () => {
    assert.equal(defaultAppSettings.player.autoFullscreen, false);
    assert.equal(defaultAppSettings.player.autoPauseOnTabSwitch, false);
    assert.equal(defaultAppSettings.appearance.theme, 'system');
    assert.equal(defaultAppSettings.appearance.highContrast, false);
    assert.equal(defaultAppSettings.appearance.compactMode, false);
    assert.equal(defaultAppSettings.appearance.customColors.enabled, false);
    assert.equal(defaultAppSettings.appearance.customColors.autoTextColor, true);
    assert.equal(defaultCustomColors.enabled, false);
});

test('cloud settings validation correctly parses and validates payloads', async () => {
    const { validateSettingsPayload } = await import('../src/shared/cloudSettings.ts');

    const validPayload = {
        version: 1,
        uploadedAt: new Date().toISOString(),
        settings: defaultAppSettings,
        my_filters: { genres: [1, 2] }
    };

    const validated = validateSettingsPayload(validPayload);
    assert.equal(validated.version, 1);
    assert.equal(validated.settings.appearance.theme, 'system');
    assert.deepEqual(validated.my_filters, { genres: [1, 2] });

    // Handles flat settings objects
    const flatValidated = validateSettingsPayload({
        appearance: defaultAppSettings.appearance,
        content: defaultAppSettings.content,
        player: defaultAppSettings.player
    });
    assert.equal(flatValidated.version, 1);
    assert.equal(flatValidated.settings.appearance.language, 'russian');

    // Throws on invalid formats
    assert.throws(() => validateSettingsPayload(null));
    assert.throws(() => validateSettingsPayload('string'));
    assert.throws(() => validateSettingsPayload({ invalid: true }));
});

test('theme color calculations produce correct contrast and luminance', () => {
    // Luminance of white is ~1.0, black is 0.0
    assert.ok(getLuminance('#ffffff') > 0.95);
    assert.ok(getLuminance('#000000') < 0.05);

    // Dark background gives light text
    const darkResult = getAutoTextColor('#161616');
    assert.equal(darkResult.isDark, true);
    assert.equal(darkResult.textColor, '#f4f5f7');

    // Light background gives dark text
    const lightResult = getAutoTextColor('#ffffff');
    assert.equal(lightResult.isDark, false);
    assert.equal(lightResult.textColor, '#1d1f24');

    // Accent button text policy: user white policy
    assert.equal(getAccentTextColor('#ffff00'), '#ffffff');
    assert.equal(getAccentTextColor('#101010'), '#ffffff');

    // Test contrast ratio calculations
    const coralContrastWithWhite = getContrastRatio('#FF6060', '#ffffff');
    const coralContrastWithDark = getContrastRatio('#FF6060', '#121212');
    assert.ok(coralContrastWithDark > 6.0, `Expected dark contrast > 6.0, got ${coralContrastWithDark}`);
    assert.ok(coralContrastWithWhite < 3.2, `Expected white contrast < 3.2, got ${coralContrastWithWhite}`);
    assert.equal(getAccentTextColor('#FF6060'), '#ffffff'); // Default coral brand with user white text policy

    // Presets contrast verification under user white text policy
    for (const preset of ACCENT_COLOR_PRESETS) {
        const actual = getAccentTextColor(preset.color);
        assert.equal(actual, '#ffffff', `Preset ${preset.label} (${preset.color}) expected white text`);
    }

    // Presets exist
    assert.ok(ACCENT_COLOR_PRESETS.length >= 5);
    assert.ok(BACKGROUND_COLOR_PRESETS.length >= 5);
});

test('i18n file includes all new translation keys for settings, backup, themes, tabs, compact mode, account sync and home', () => {
    const i18nContent = readFileSync('src/shared/i18n.ts', 'utf8');

    const keysToCheck = [
        'settings.tab.appearance',
        'settings.tab.content',
        'settings.tab.player',
        'settings.tab.data',
        'settings.compactMode',
        'settings.compactMode.desc',
        'settings.accountSync',
        'settings.accountSync.desc',
        'settings.accountSync.profile',
        'settings.accountSync.notLoggedIn',
        'settings.accountSync.save',
        'settings.accountSync.load',
        'settings.accountSync.autoSync',
        'settings.autoFullscreen',
        'settings.autoFullscreen.desc',
        'settings.autoPauseOnTabSwitch',
        'settings.autoPauseOnTabSwitch.desc',
        'settings.myFilters',
        'settings.myFilters.desc',
        'settings.myFilters.button',
        'settings.backup',
        'settings.backup.desc',
        'settings.export',
        'settings.export.desc',
        'settings.export.button',
        'settings.import',
        'settings.import.desc',
        'settings.import.button',
        'settings.import.success',
        'settings.import.error',
        'home.myTabHint',
        'settings.theme',
        'settings.theme.desc',
        'settings.theme.system',
        'settings.theme.dark',
        'settings.theme.light',
        'settings.highContrast',
        'settings.highContrast.desc',
        'settings.customColors',
        'settings.customColors.desc',
        'settings.customColors.accent',
        'settings.customColors.background',
        'settings.customColors.autoText',
        'settings.customColors.textColor',
        'settings.customColors.reset'
    ];

    for (const key of keysToCheck) {
        assert.ok(i18nContent.includes(`'${key}':`), `Missing key in i18n.ts: ${key}`);
    }

    const removedKeys = [
        'settings.cloudSync',
        'settings.cloudSync.desc',
        'settings.cloudSync.key',
        'settings.cloudSync.upload',
        'settings.cloudSync.download',
        'settings.cloudSync.copyKey',
        'settings.accountSync.manualTitle',
        'settings.accountSync.manualDesc',
    ];

    for (const key of removedKeys) {
        assert.ok(!i18nContent.includes(`'${key}':`), `Removed key should not exist in i18n.ts: ${key}`);
    }
});

test('account sync options and auto-sync toggle work correctly', async () => {
    const { isAutoSyncAccountEnabled, setAutoSyncAccountEnabled } = await import('../src/shared/cloudSettings.ts');

    // Default is true
    setAutoSyncAccountEnabled(true);
    assert.equal(isAutoSyncAccountEnabled(), true);

    setAutoSyncAccountEnabled(false);
    assert.equal(isAutoSyncAccountEnabled(), false);

    setAutoSyncAccountEnabled(true);
    assert.equal(isAutoSyncAccountEnabled(), true);
});

test('PWA manifest exists, is valid JSON and has required PWA fields', () => {
    assert.ok(existsSync('public/manifest.webmanifest'), 'manifest.webmanifest must exist');
    const content = JSON.parse(readFileSync('public/manifest.webmanifest', 'utf8'));

    assert.equal(content.name, 'Anixweb');
    assert.equal(content.short_name, 'Anixweb');
    assert.ok(content.start_url === './' || content.start_url === '/', 'start_url should be relative ./ or /');
    assert.equal(content.display, 'standalone');
    assert.ok(Array.isArray(content.icons) && content.icons.length >= 2, 'Manifest must have icons');

    const has192 = content.icons.some(icon => icon.sizes === '192x192');
    const has512 = content.icons.some(icon => icon.sizes === '512x512');
    assert.ok(has192, 'Manifest must have 192x192 icon');
    assert.ok(has512, 'Manifest must have 512x512 icon');
});

test('Service worker and icon files exist in public directory', () => {
    assert.ok(existsSync('public/sw.js'), 'sw.js must exist');
    assert.ok(existsSync('public/icons/icon-192.png'), 'icon-192.png must exist');
    assert.ok(existsSync('public/icons/icon-512.png'), 'icon-512.png must exist');
    assert.ok(existsSync('public/icons/icon.svg'), 'icon.svg must exist');
});
