import type { AppSettings, CustomColorSettings } from './types/settings.ts';
import {
    defaultAppSettings,
    playerKeybindingActions,
    HOME_TAB_ORDER, FAVORITES_TAB_ORDER,
} from './types/settings.ts';
import { normalizeTabOrder } from './tabOrder.ts';
import type { Filter } from './types/api.ts';

export interface CloudSettingsPayload {
    version: 1;
    uploadedAt: string;
    settings: AppSettings;
    my_filters?: Filter | null;
}

const HEX_COLOR_REGEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const KNOWN_LANGUAGES = new Set(['russian', 'english', 'ukrainian']);
const KNOWN_THEMES = new Set(['system', 'dark', 'light']);
const KNOWN_QUALITIES = new Set(['auto', '1080', '720', '480', '360']);
const KNOWN_UPGRADE_MODES = new Set(['weak', 'medium', 'strong']);
const KNOWN_HOME_TABS = new Set<string>(HOME_TAB_ORDER);
const KNOWN_FAVORITES_TABS = new Set([
    'collections', 'favorites', 'history', 'watching', 'planned', 'completed', 'hold_on', 'dropped',
]);
const KNOWN_NOTIF_TYPES = new Set(['all', 'selected_lists', 'selected_releases']);
const KNOWN_KEYBINDING_ACTIONS = new Set<string>(playerKeybindingActions);

const WRAPPER_PAYLOAD_KEYS = new Set(['version', 'uploadedAt', 'exportedAt', 'settings', 'my_filters']);
const FLAT_SETTINGS_KEYS = new Set([
    'version', 'uploadedAt', 'exportedAt', 'appearance', 'player', 'content', 'notifications', 'my_filters',
]);
const SETTINGS_SECTIONS = new Set(['player', 'appearance', 'content', 'notifications']);

const APPEARANCE_KEYS = new Set(['theme', 'highContrast', 'compactMode', 'customColors', 'language', 'defaultCardType']);
const CUSTOM_COLOR_KEYS = new Set(['enabled', 'accentColor', 'backgroundColor', 'textColor', 'autoTextColor']);
const PLAYER_KEYS = new Set([
    'defaultQuality', 'autoplay', 'volume', 'qualityUpgrade', 'qualityUpgradeMode',
    'showSkipOpeningButton', 'skipOpeningValue', 'autoFullscreen', 'autoPauseOnTabSwitch',
    'keybindings', 'skipForwardSeconds', 'skipBackwardSeconds',
]);
const CONTENT_KEYS = new Set([
    'homeTabOrder', 'favoritesTabOrder',
    'defaultTabOnHome', 'defaultTabOnFavorites', 'rememberSource', 'rememberedSourceId',
    'rememberDub', 'rememberedDubId', 'rememberEpisodeTime', 'proxySearchThroughShikimori', 'proxyImages',
]);
const NOTIFICATIONS_KEYS = new Set([
    'recieveNotifications', 'notificationsType', 'selectedLists', 'selectedDubs',
    'selectedReleases', 'getOnlyOneNotification', 'notificationOnRelatedRelease',
    'repliesNotifications', 'commentsOnCollectionNotification',
]);
const FILTER_KEYS = new Set([
    'country', 'category_id', 'status_id', 'genres', 'is_genres_exclude_mode_enabled',
    'profile_list_exclusions', 'types', 'studio', 'source', 'start_year', 'end_year',
    'episode_duration_from', 'episode_duration_to', 'episodes_from', 'episodes_to',
    'season', 'age_ratings', 'sort',
]);

function assertUnknownKeys(obj: Record<string, unknown>, allowedKeys: Set<string>, scope: string): void {
    for (const key of Object.keys(obj)) {
        if (!allowedKeys.has(key)) {
            throw new Error(`Unknown field in ${scope}: "${key}"`);
        }
    }
}

function parseFilter(data: unknown): Filter {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new Error('Invalid my_filters: expected an object');
    }

    const raw = data as Record<string, unknown>;
    assertUnknownKeys(raw, FILTER_KEYS, 'my_filters');

    const result: Filter = {};

    if (raw.country !== undefined) {
        if (raw.country !== null && raw.country !== 'Япония' && raw.country !== 'Китай' && raw.country !== 'Южная Корея') {
            throw new Error(`Invalid country in my_filters: "${String(raw.country)}"`);
        }
        result.country = raw.country as Filter['country'];
    }

    if (raw.category_id !== undefined) {
        if (raw.category_id !== null && raw.category_id !== 1 && raw.category_id !== 2 && raw.category_id !== 3 && raw.category_id !== 4) {
            throw new Error(`Invalid category_id in my_filters: ${String(raw.category_id)}`);
        }
        result.category_id = raw.category_id as Filter['category_id'];
    }

    if (raw.status_id !== undefined) {
        if (raw.status_id !== null && raw.status_id !== 1 && raw.status_id !== 2 && raw.status_id !== 3) {
            throw new Error(`Invalid status_id in my_filters: ${String(raw.status_id)}`);
        }
        result.status_id = raw.status_id as Filter['status_id'];
    }

    if (raw.season !== undefined) {
        if (raw.season !== null && raw.season !== 1 && raw.season !== 2 && raw.season !== 3 && raw.season !== 4) {
            throw new Error(`Invalid season in my_filters: ${String(raw.season)}`);
        }
        result.season = raw.season as Filter['season'];
    }

    if (raw.sort !== undefined) {
        if (raw.sort !== 0 && raw.sort !== 1 && raw.sort !== 2 && raw.sort !== 3) {
            throw new Error(`Invalid sort in my_filters: ${String(raw.sort)}`);
        }
        result.sort = raw.sort as Filter['sort'];
    }

    if (raw.genres !== undefined) {
        if (!Array.isArray(raw.genres) || !raw.genres.every(x => typeof x === 'string' || (typeof x === 'number' && Number.isFinite(x) && x >= 0))) {
            throw new Error('Invalid genres in my_filters: expected array of strings or nonnegative numbers');
        }
        result.genres = raw.genres as Filter['genres'];
    }

    if (raw.types !== undefined) {
        if (!Array.isArray(raw.types) || !raw.types.every(x => typeof x === 'string')) {
            throw new Error('Invalid types in my_filters: expected array of strings');
        }
        result.types = raw.types as Filter['types'];
    }

    if (raw.is_genres_exclude_mode_enabled !== undefined) {
        if (typeof raw.is_genres_exclude_mode_enabled !== 'boolean') {
            throw new Error('Invalid is_genres_exclude_mode_enabled in my_filters: expected boolean');
        }
        result.is_genres_exclude_mode_enabled = raw.is_genres_exclude_mode_enabled;
    }

    if (raw.profile_list_exclusions !== undefined) {
        if (!Array.isArray(raw.profile_list_exclusions) || !raw.profile_list_exclusions.every(x => typeof x === 'number' && Number.isInteger(x) && x >= 0 && x <= 5)) {
            throw new Error('Invalid profile_list_exclusions in my_filters: expected array of list numbers 0-5');
        }
        result.profile_list_exclusions = raw.profile_list_exclusions;
    }

    if (raw.studio !== undefined) {
        if (raw.studio !== null && typeof raw.studio !== 'string') {
            throw new Error('Invalid studio in my_filters: expected string or null');
        }
        result.studio = raw.studio;
    }

    if (raw.source !== undefined) {
        if (raw.source !== null && typeof raw.source !== 'string') {
            throw new Error('Invalid source in my_filters: expected string or null');
        }
        result.source = raw.source;
    }

    const rangeKeys = [
        'start_year', 'end_year', 'episode_duration_from',
        'episode_duration_to', 'episodes_from', 'episodes_to',
    ] as const;

    for (const key of rangeKeys) {
        const val = raw[key];
        if (val !== undefined) {
            if (val !== null && (typeof val !== 'number' || !Number.isFinite(val) || val < 0)) {
                throw new Error(`Invalid numeric range in my_filters: "${key}" must be a nonnegative finite number or null`);
            }
            result[key] = val as number | null;
        }
    }

    if (raw.age_ratings !== undefined) {
        if (raw.age_ratings !== null) {
            if (typeof raw.age_ratings === 'number') {
                if (![1, 2, 3, 4, 5].includes(raw.age_ratings)) {
                    throw new Error('Invalid age_ratings in my_filters: expected values 1-5');
                }
                result.age_ratings = [raw.age_ratings as 1 | 2 | 3 | 4 | 5];
            } else if (Array.isArray(raw.age_ratings)) {
                if (!raw.age_ratings.every(x => typeof x === 'number' && [1, 2, 3, 4, 5].includes(x))) {
                    throw new Error('Invalid age_ratings in my_filters: expected values 1-5');
                }
                result.age_ratings = raw.age_ratings as Filter['age_ratings'];
            } else {
                throw new Error('Invalid age_ratings in my_filters: expected number or array of numbers 1-5');
            }
        } else {
            result.age_ratings = undefined;
        }
    }

    return result;
}

export function parseImportedSettings(data: unknown, current?: AppSettings): CloudSettingsPayload {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new Error('Invalid cloud settings format: not an object');
    }

    const record = data as Record<string, unknown>;

    // Version check: payload version 1 or legacy absent version. Reject unknown versions.
    if ('version' in record && record.version !== undefined) {
        if (record.version !== 1) {
            throw new Error(`Unsupported settings payload version: ${String(record.version)}`);
        }
    }

    const isWrapper = record.settings && typeof record.settings === 'object';
    const isFlat = record.appearance || record.player || record.content || record.notifications;

    if (!isWrapper && !isFlat) {
        throw new Error('Invalid cloud settings: missing settings object');
    }

    if (isWrapper) {
        assertUnknownKeys(record, WRAPPER_PAYLOAD_KEYS, 'payload');
    } else {
        assertUnknownKeys(record, FLAT_SETTINGS_KEYS, 'payload');
    }

    const rawSettings = isWrapper
        ? (record.settings as Record<string, unknown>)
        : record;

    if (!rawSettings || typeof rawSettings !== 'object' || Array.isArray(rawSettings)) {
        throw new Error('Invalid settings: settings must be an object');
    }

    if (isWrapper) {
        assertUnknownKeys(rawSettings, SETTINGS_SECTIONS, 'settings');
    }

    const base: AppSettings = current ?? defaultAppSettings;

    // 1. Appearance
    const appearance = { ...base.appearance, customColors: { ...base.appearance.customColors } };
    if (rawSettings.appearance !== undefined) {
        if (!rawSettings.appearance || typeof rawSettings.appearance !== 'object' || Array.isArray(rawSettings.appearance)) {
            throw new Error('Invalid appearance settings: expected an object');
        }
        const appRaw = rawSettings.appearance as Record<string, unknown>;
        assertUnknownKeys(appRaw, APPEARANCE_KEYS, 'appearance');

        if (appRaw.theme !== undefined) {
            if (typeof appRaw.theme !== 'string' || !KNOWN_THEMES.has(appRaw.theme)) {
                throw new Error(`Invalid appearance.theme: "${String(appRaw.theme)}". Must be 'system', 'dark', or 'light'`);
            }
            appearance.theme = appRaw.theme as 'system' | 'dark' | 'light';
        }

        if (appRaw.language !== undefined) {
            if (typeof appRaw.language !== 'string' || !KNOWN_LANGUAGES.has(appRaw.language)) {
                throw new Error(`Invalid appearance.language: "${String(appRaw.language)}". Must be 'russian', 'english', or 'ukrainian'`);
            }
            appearance.language = appRaw.language as AppSettings['appearance']['language'];
        }

        if (appRaw.compactMode !== undefined) {
            if (typeof appRaw.compactMode !== 'boolean') {
                throw new Error('Invalid appearance.compactMode: expected boolean');
            }
            appearance.compactMode = appRaw.compactMode;
        }

        if (appRaw.highContrast !== undefined) {
            if (typeof appRaw.highContrast !== 'boolean') {
                throw new Error('Invalid appearance.highContrast: expected boolean');
            }
            appearance.highContrast = appRaw.highContrast;
        }

        if (appRaw.defaultCardType !== undefined) {
            if (appRaw.defaultCardType !== 'vertical' && appRaw.defaultCardType !== 'horizontal') {
                throw new Error(`Invalid appearance.defaultCardType: "${String(appRaw.defaultCardType)}"`);
            }
            appearance.defaultCardType = appRaw.defaultCardType;
        }

        if (appRaw.customColors !== undefined) {
            if (!appRaw.customColors || typeof appRaw.customColors !== 'object' || Array.isArray(appRaw.customColors)) {
                throw new Error('Invalid appearance.customColors: expected an object');
            }
            const colorsRaw = appRaw.customColors as Record<string, unknown>;
            assertUnknownKeys(colorsRaw, CUSTOM_COLOR_KEYS, 'appearance.customColors');

            const customColors: CustomColorSettings = {
                enabled: colorsRaw.enabled !== undefined
                    ? (typeof colorsRaw.enabled === 'boolean' ? colorsRaw.enabled : (() => { throw new Error('Invalid customColors.enabled: expected boolean'); })())
                    : base.appearance.customColors.enabled,
                autoTextColor: colorsRaw.autoTextColor !== undefined
                    ? (typeof colorsRaw.autoTextColor === 'boolean' ? colorsRaw.autoTextColor : (() => { throw new Error('Invalid customColors.autoTextColor: expected boolean'); })())
                    : base.appearance.customColors.autoTextColor,
                accentColor: colorsRaw.accentColor !== undefined
                    ? (typeof colorsRaw.accentColor === 'string' && HEX_COLOR_REGEX.test(colorsRaw.accentColor) ? colorsRaw.accentColor : (() => { throw new Error(`Invalid hex color in customColors.accentColor: "${String(colorsRaw.accentColor)}"`); })())
                    : base.appearance.customColors.accentColor,
                backgroundColor: colorsRaw.backgroundColor !== undefined
                    ? (typeof colorsRaw.backgroundColor === 'string' && HEX_COLOR_REGEX.test(colorsRaw.backgroundColor) ? colorsRaw.backgroundColor : (() => { throw new Error(`Invalid hex color in customColors.backgroundColor: "${String(colorsRaw.backgroundColor)}"`); })())
                    : base.appearance.customColors.backgroundColor,
                textColor: colorsRaw.textColor !== undefined
                    ? (typeof colorsRaw.textColor === 'string' && HEX_COLOR_REGEX.test(colorsRaw.textColor) ? colorsRaw.textColor : (() => { throw new Error(`Invalid hex color in customColors.textColor: "${String(colorsRaw.textColor)}"`); })())
                    : base.appearance.customColors.textColor,
            };
            appearance.customColors = customColors;
        }
    }

    // 2. Player
    const player = { ...base.player, keybindings: { ...base.player.keybindings } };
    if (rawSettings.player !== undefined) {
        if (!rawSettings.player || typeof rawSettings.player !== 'object' || Array.isArray(rawSettings.player)) {
            throw new Error('Invalid player settings: expected an object');
        }
        const playerRaw = rawSettings.player as Record<string, unknown>;
        assertUnknownKeys(playerRaw, PLAYER_KEYS, 'player');

        if (playerRaw.volume !== undefined) {
            if (typeof playerRaw.volume !== 'number' || !Number.isFinite(playerRaw.volume) || playerRaw.volume < 0 || playerRaw.volume > 100) {
                throw new Error(`Invalid player.volume: ${String(playerRaw.volume)}. Must be a finite number between 0 and 100`);
            }
            player.volume = playerRaw.volume;
        }

        if (playerRaw.defaultQuality !== undefined) {
            if (typeof playerRaw.defaultQuality !== 'string' || !KNOWN_QUALITIES.has(playerRaw.defaultQuality)) {
                throw new Error(`Invalid player.defaultQuality: "${String(playerRaw.defaultQuality)}"`);
            }
            player.defaultQuality = playerRaw.defaultQuality as AppSettings['player']['defaultQuality'];
        }

        if (playerRaw.autoplay !== undefined) {
            if (typeof playerRaw.autoplay !== 'boolean') throw new Error('Invalid player.autoplay: expected boolean');
            player.autoplay = playerRaw.autoplay;
        }

        if (playerRaw.qualityUpgrade !== undefined) {
            if (typeof playerRaw.qualityUpgrade !== 'boolean') throw new Error('Invalid player.qualityUpgrade: expected boolean');
            player.qualityUpgrade = playerRaw.qualityUpgrade;
        }

        if (playerRaw.qualityUpgradeMode !== undefined) {
            if (typeof playerRaw.qualityUpgradeMode !== 'string' || !KNOWN_UPGRADE_MODES.has(playerRaw.qualityUpgradeMode)) {
                throw new Error(`Invalid player.qualityUpgradeMode: "${String(playerRaw.qualityUpgradeMode)}"`);
            }
            player.qualityUpgradeMode = playerRaw.qualityUpgradeMode as AppSettings['player']['qualityUpgradeMode'];
        }

        if (playerRaw.showSkipOpeningButton !== undefined) {
            if (typeof playerRaw.showSkipOpeningButton !== 'boolean') throw new Error('Invalid player.showSkipOpeningButton: expected boolean');
            player.showSkipOpeningButton = playerRaw.showSkipOpeningButton;
        }

        if (playerRaw.skipOpeningValue !== undefined) {
            if (typeof playerRaw.skipOpeningValue !== 'number' || !Number.isFinite(playerRaw.skipOpeningValue) || playerRaw.skipOpeningValue < 0 || playerRaw.skipOpeningValue > 86400) {
                throw new Error(`Invalid player.skipOpeningValue: ${String(playerRaw.skipOpeningValue)}. Must be a nonnegative finite number <= 86400`);
            }
            player.skipOpeningValue = playerRaw.skipOpeningValue;
        }

        if (playerRaw.skipForwardSeconds !== undefined) {
            if (typeof playerRaw.skipForwardSeconds !== 'number' || !Number.isFinite(playerRaw.skipForwardSeconds) || playerRaw.skipForwardSeconds < 0 || playerRaw.skipForwardSeconds > 86400) {
                throw new Error(`Invalid player.skipForwardSeconds: ${String(playerRaw.skipForwardSeconds)}. Must be a nonnegative finite number <= 86400`);
            }
        }

        if (playerRaw.skipBackwardSeconds !== undefined) {
            if (typeof playerRaw.skipBackwardSeconds !== 'number' || !Number.isFinite(playerRaw.skipBackwardSeconds) || playerRaw.skipBackwardSeconds < 0 || playerRaw.skipBackwardSeconds > 86400) {
                throw new Error(`Invalid player.skipBackwardSeconds: ${String(playerRaw.skipBackwardSeconds)}. Must be a nonnegative finite number <= 86400`);
            }
        }

        if (playerRaw.autoFullscreen !== undefined) {
            if (typeof playerRaw.autoFullscreen !== 'boolean') throw new Error('Invalid player.autoFullscreen: expected boolean');
            player.autoFullscreen = playerRaw.autoFullscreen;
        }

        if (playerRaw.autoPauseOnTabSwitch !== undefined) {
            if (typeof playerRaw.autoPauseOnTabSwitch !== 'boolean') throw new Error('Invalid player.autoPauseOnTabSwitch: expected boolean');
            player.autoPauseOnTabSwitch = playerRaw.autoPauseOnTabSwitch;
        }

        if (playerRaw.keybindings !== undefined) {
            if (!playerRaw.keybindings || typeof playerRaw.keybindings !== 'object' || Array.isArray(playerRaw.keybindings)) {
                throw new Error('Invalid player.keybindings: expected an object');
            }
            const keybindingsRaw = playerRaw.keybindings as Record<string, unknown>;
            const keybindings = { ...base.player.keybindings };
            for (const [action, code] of Object.entries(keybindingsRaw)) {
                if (!KNOWN_KEYBINDING_ACTIONS.has(action)) {
                    throw new Error(`Unknown keybinding action: "${action}"`);
                }
                if (typeof code !== 'string' || (code !== '' && !code.trim())) {
                    throw new Error(`Invalid keybinding code for "${action}": must be a key code or an empty string`);
                }
                keybindings[action as keyof typeof keybindings] = code.trim();
            }
            player.keybindings = keybindings;
        }
    }

    // 3. Content
    const content = { ...base.content };
    if (rawSettings.content !== undefined) {
        if (!rawSettings.content || typeof rawSettings.content !== 'object' || Array.isArray(rawSettings.content)) {
            throw new Error('Invalid content settings: expected an object');
        }
        const contentRaw = rawSettings.content as Record<string, unknown>;
        assertUnknownKeys(contentRaw, CONTENT_KEYS, 'content');

        for (const [key, defaults] of [['homeTabOrder', HOME_TAB_ORDER], ['favoritesTabOrder', FAVORITES_TAB_ORDER]] as const) {
            const order = contentRaw[key];
            if (order === undefined) continue;
            if (!Array.isArray(order) || order.some(item => typeof item !== 'string' || !(defaults as readonly string[]).includes(item)) || new Set(order).size !== order.length) throw new Error(`Invalid content.${key}`);
            if (key === 'homeTabOrder') content.homeTabOrder = normalizeTabOrder(order, HOME_TAB_ORDER);
            else content.favoritesTabOrder = normalizeTabOrder(order, FAVORITES_TAB_ORDER);
        }

        if (contentRaw.defaultTabOnHome !== undefined) {
            if (typeof contentRaw.defaultTabOnHome !== 'string' || !KNOWN_HOME_TABS.has(contentRaw.defaultTabOnHome)) {
                throw new Error(`Invalid content.defaultTabOnHome: "${String(contentRaw.defaultTabOnHome)}"`);
            }
            content.defaultTabOnHome = contentRaw.defaultTabOnHome as AppSettings['content']['defaultTabOnHome'];
        }

        if (contentRaw.defaultTabOnFavorites !== undefined) {
            if (typeof contentRaw.defaultTabOnFavorites !== 'string' || !KNOWN_FAVORITES_TABS.has(contentRaw.defaultTabOnFavorites)) {
                throw new Error(`Invalid content.defaultTabOnFavorites: "${String(contentRaw.defaultTabOnFavorites)}"`);
            }
            content.defaultTabOnFavorites = contentRaw.defaultTabOnFavorites as AppSettings['content']['defaultTabOnFavorites'];
        }

        const booleanFlags = [
            'rememberSource', 'rememberDub', 'rememberEpisodeTime',
            'proxySearchThroughShikimori', 'proxyImages',
        ] as const;

        for (const flag of booleanFlags) {
            if (contentRaw[flag] !== undefined) {
                if (typeof contentRaw[flag] !== 'boolean') {
                    throw new Error(`Invalid content.${flag}: expected boolean`);
                }
                content[flag] = contentRaw[flag] as boolean;
            }
        }

        if (contentRaw.rememberedSourceId !== undefined) {
            if (contentRaw.rememberedSourceId !== null && (typeof contentRaw.rememberedSourceId !== 'number' || !Number.isFinite(contentRaw.rememberedSourceId))) {
                throw new Error('Invalid content.rememberedSourceId: expected number or null');
            }
            content.rememberedSourceId = contentRaw.rememberedSourceId as number | null;
        }

        if (contentRaw.rememberedDubId !== undefined) {
            if (contentRaw.rememberedDubId !== null && (typeof contentRaw.rememberedDubId !== 'number' || !Number.isFinite(contentRaw.rememberedDubId))) {
                throw new Error('Invalid content.rememberedDubId: expected number or null');
            }
            content.rememberedDubId = contentRaw.rememberedDubId as number | null;
        }
    }

    // 4. Notifications
    const notifications = { ...base.notifications };
    if (rawSettings.notifications !== undefined) {
        if (!rawSettings.notifications || typeof rawSettings.notifications !== 'object' || Array.isArray(rawSettings.notifications)) {
            throw new Error('Invalid notifications settings: expected an object');
        }
        const notifRaw = rawSettings.notifications as Record<string, unknown>;
        assertUnknownKeys(notifRaw, NOTIFICATIONS_KEYS, 'notifications');

        const booleanNotifFlags = [
            'recieveNotifications', 'getOnlyOneNotification', 'notificationOnRelatedRelease',
            'repliesNotifications', 'commentsOnCollectionNotification',
        ] as const;

        for (const flag of booleanNotifFlags) {
            if (notifRaw[flag] !== undefined) {
                if (typeof notifRaw[flag] !== 'boolean') {
                    throw new Error(`Invalid notifications.${flag}: expected boolean`);
                }
                notifications[flag] = notifRaw[flag] as boolean;
            }
        }

        if (notifRaw.notificationsType !== undefined) {
            if (notifRaw.notificationsType !== null && (typeof notifRaw.notificationsType !== 'string' || !KNOWN_NOTIF_TYPES.has(notifRaw.notificationsType))) {
                throw new Error(`Invalid notifications.notificationsType: "${String(notifRaw.notificationsType)}"`);
            }
            notifications.notificationsType = notifRaw.notificationsType as AppSettings['notifications']['notificationsType'];
        }

        if (notifRaw.selectedLists !== undefined) {
            if (notifRaw.selectedLists !== null && (!Array.isArray(notifRaw.selectedLists) || !notifRaw.selectedLists.every(x => typeof x === 'string'))) {
                throw new Error('Invalid notifications.selectedLists: expected array of strings or null');
            }
            notifications.selectedLists = notifRaw.selectedLists as string[] | null;
        }

        if (notifRaw.selectedDubs !== undefined) {
            if (notifRaw.selectedDubs !== null && !Array.isArray(notifRaw.selectedDubs)) {
                throw new Error('Invalid notifications.selectedDubs: expected array or null');
            }
            notifications.selectedDubs = notifRaw.selectedDubs as AppSettings['notifications']['selectedDubs'];
        }

        if (notifRaw.selectedReleases !== undefined) {
            if (notifRaw.selectedReleases !== null && !Array.isArray(notifRaw.selectedReleases)) {
                throw new Error('Invalid notifications.selectedReleases: expected array or null');
            }
            notifications.selectedReleases = notifRaw.selectedReleases as AppSettings['notifications']['selectedReleases'];
        }
    }

    // 5. Filters
    let myFilters: Filter | null = null;
    if (record.my_filters !== undefined) {
        if (record.my_filters !== null) {
            myFilters = parseFilter(record.my_filters);
        }
    }

    const uploadedAt = typeof record.uploadedAt === 'string'
        ? record.uploadedAt
        : (typeof record.exportedAt === 'string' ? record.exportedAt : new Date().toISOString());

    return {
        version: 1,
        uploadedAt,
        settings: {
            appearance,
            player,
            content,
            notifications,
        },
        my_filters: myFilters,
    };
}

export function normalizeLegacySettings(data: unknown, current?: AppSettings): AppSettings {
    const base: AppSettings = current ?? defaultAppSettings;

    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        return {
            player: { ...base.player, keybindings: { ...base.player.keybindings } },
            content: { ...base.content },
            appearance: { ...base.appearance, customColors: { ...base.appearance.customColors } },
            notifications: { ...base.notifications },
        };
    }

    const record = data as Record<string, unknown>;
    const rawSettings = (record.settings && typeof record.settings === 'object' && !Array.isArray(record.settings))
        ? (record.settings as Record<string, unknown>)
        : record;

    // 1. Appearance
    const appRaw = (rawSettings.appearance && typeof rawSettings.appearance === 'object' && !Array.isArray(rawSettings.appearance))
        ? (rawSettings.appearance as Record<string, unknown>)
        : {};

    const theme = (appRaw.theme === 'system' || appRaw.theme === 'dark' || appRaw.theme === 'light')
        ? appRaw.theme
        : base.appearance.theme;

    const highContrast = typeof appRaw.highContrast === 'boolean'
        ? appRaw.highContrast
        : base.appearance.highContrast;

    const compactMode = typeof appRaw.compactMode === 'boolean'
        ? appRaw.compactMode
        : base.appearance.compactMode;

    const defaultCardType = (appRaw.defaultCardType === 'vertical' || appRaw.defaultCardType === 'horizontal')
        ? appRaw.defaultCardType
        : base.appearance.defaultCardType;

    const language = (typeof appRaw.language === 'string' && KNOWN_LANGUAGES.has(appRaw.language))
        ? (appRaw.language as AppSettings['appearance']['language'])
        : base.appearance.language;

    const colorsRaw = (appRaw.customColors && typeof appRaw.customColors === 'object' && !Array.isArray(appRaw.customColors))
        ? (appRaw.customColors as Record<string, unknown>)
        : {};

    const customColors: CustomColorSettings = {
        enabled: typeof colorsRaw.enabled === 'boolean' ? colorsRaw.enabled : base.appearance.customColors.enabled,
        autoTextColor: typeof colorsRaw.autoTextColor === 'boolean' ? colorsRaw.autoTextColor : base.appearance.customColors.autoTextColor,
        accentColor: (typeof colorsRaw.accentColor === 'string' && HEX_COLOR_REGEX.test(colorsRaw.accentColor))
            ? colorsRaw.accentColor
            : base.appearance.customColors.accentColor,
        backgroundColor: (typeof colorsRaw.backgroundColor === 'string' && HEX_COLOR_REGEX.test(colorsRaw.backgroundColor))
            ? colorsRaw.backgroundColor
            : base.appearance.customColors.backgroundColor,
        textColor: (typeof colorsRaw.textColor === 'string' && HEX_COLOR_REGEX.test(colorsRaw.textColor))
            ? colorsRaw.textColor
            : base.appearance.customColors.textColor,
    };

    // 2. Player
    const playerRaw = (rawSettings.player && typeof rawSettings.player === 'object' && !Array.isArray(rawSettings.player))
        ? (rawSettings.player as Record<string, unknown>)
        : {};

    const defaultQuality = (typeof playerRaw.defaultQuality === 'string' && KNOWN_QUALITIES.has(playerRaw.defaultQuality))
        ? (playerRaw.defaultQuality as AppSettings['player']['defaultQuality'])
        : base.player.defaultQuality;

    const autoplay = typeof playerRaw.autoplay === 'boolean' ? playerRaw.autoplay : base.player.autoplay;

    const volume = (typeof playerRaw.volume === 'number' && Number.isFinite(playerRaw.volume) && playerRaw.volume >= 0 && playerRaw.volume <= 100)
        ? playerRaw.volume
        : base.player.volume;

    const qualityUpgrade = typeof playerRaw.qualityUpgrade === 'boolean' ? playerRaw.qualityUpgrade : base.player.qualityUpgrade;

    const qualityUpgradeMode = (typeof playerRaw.qualityUpgradeMode === 'string' && KNOWN_UPGRADE_MODES.has(playerRaw.qualityUpgradeMode))
        ? (playerRaw.qualityUpgradeMode as AppSettings['player']['qualityUpgradeMode'])
        : base.player.qualityUpgradeMode;

    const showSkipOpeningButton = typeof playerRaw.showSkipOpeningButton === 'boolean' ? playerRaw.showSkipOpeningButton : base.player.showSkipOpeningButton;

    const skipOpeningValue = (typeof playerRaw.skipOpeningValue === 'number' && Number.isFinite(playerRaw.skipOpeningValue) && playerRaw.skipOpeningValue >= 0 && playerRaw.skipOpeningValue <= 86400)
        ? playerRaw.skipOpeningValue
        : base.player.skipOpeningValue;

    const autoFullscreen = typeof playerRaw.autoFullscreen === 'boolean' ? playerRaw.autoFullscreen : base.player.autoFullscreen;

    const autoPauseOnTabSwitch = typeof playerRaw.autoPauseOnTabSwitch === 'boolean' ? playerRaw.autoPauseOnTabSwitch : base.player.autoPauseOnTabSwitch;

    const keybindingsRaw = (playerRaw.keybindings && typeof playerRaw.keybindings === 'object' && !Array.isArray(playerRaw.keybindings))
        ? (playerRaw.keybindings as Record<string, unknown>)
        : {};

    const keybindings = { ...base.player.keybindings };
    for (const action of playerKeybindingActions) {
        if (typeof keybindingsRaw[action] === 'string' && (keybindingsRaw[action] === '' || (keybindingsRaw[action] as string).trim().length > 0)) {
            keybindings[action] = (keybindingsRaw[action] as string).trim();
        }
    }

    // 3. Content
    const contentRaw = (rawSettings.content && typeof rawSettings.content === 'object' && !Array.isArray(rawSettings.content))
        ? (rawSettings.content as Record<string, unknown>)
        : {};

    const defaultTabOnHome = (typeof contentRaw.defaultTabOnHome === 'string' && KNOWN_HOME_TABS.has(contentRaw.defaultTabOnHome))
        ? (contentRaw.defaultTabOnHome as AppSettings['content']['defaultTabOnHome'])
        : base.content.defaultTabOnHome;

    const defaultTabOnFavorites = (typeof contentRaw.defaultTabOnFavorites === 'string' && KNOWN_FAVORITES_TABS.has(contentRaw.defaultTabOnFavorites))
        ? (contentRaw.defaultTabOnFavorites as AppSettings['content']['defaultTabOnFavorites'])
        : base.content.defaultTabOnFavorites;

    const rememberSource = typeof contentRaw.rememberSource === 'boolean' ? contentRaw.rememberSource : base.content.rememberSource;
    const rememberedSourceId = (typeof contentRaw.rememberedSourceId === 'number' && Number.isFinite(contentRaw.rememberedSourceId))
        ? contentRaw.rememberedSourceId
        : (contentRaw.rememberedSourceId === null ? null : base.content.rememberedSourceId);

    const rememberDub = typeof contentRaw.rememberDub === 'boolean' ? contentRaw.rememberDub : base.content.rememberDub;
    const rememberedDubId = (typeof contentRaw.rememberedDubId === 'number' && Number.isFinite(contentRaw.rememberedDubId))
        ? contentRaw.rememberedDubId
        : (contentRaw.rememberedDubId === null ? null : base.content.rememberedDubId);

    const rememberEpisodeTime = typeof contentRaw.rememberEpisodeTime === 'boolean' ? contentRaw.rememberEpisodeTime : base.content.rememberEpisodeTime;
    const proxySearchThroughShikimori = typeof contentRaw.proxySearchThroughShikimori === 'boolean' ? contentRaw.proxySearchThroughShikimori : base.content.proxySearchThroughShikimori;
    const proxyImages = typeof contentRaw.proxyImages === 'boolean' ? contentRaw.proxyImages : base.content.proxyImages;

    // 4. Notifications
    const notifRaw = (rawSettings.notifications && typeof rawSettings.notifications === 'object' && !Array.isArray(rawSettings.notifications))
        ? (rawSettings.notifications as Record<string, unknown>)
        : {};

    const recieveNotifications = typeof notifRaw.recieveNotifications === 'boolean'
        ? notifRaw.recieveNotifications
        : base.notifications.recieveNotifications;

    const notificationsType = (notifRaw.notificationsType === null || (typeof notifRaw.notificationsType === 'string' && KNOWN_NOTIF_TYPES.has(notifRaw.notificationsType)))
        ? (notifRaw.notificationsType as AppSettings['notifications']['notificationsType'])
        : base.notifications.notificationsType;

    const selectedLists = (Array.isArray(notifRaw.selectedLists) && notifRaw.selectedLists.every(x => typeof x === 'string'))
        ? notifRaw.selectedLists
        : (notifRaw.selectedLists === null ? null : base.notifications.selectedLists);

    const selectedDubs = Array.isArray(notifRaw.selectedDubs)
        ? notifRaw.selectedDubs
        : (notifRaw.selectedDubs === null ? null : base.notifications.selectedDubs);

    const selectedReleases = Array.isArray(notifRaw.selectedReleases)
        ? notifRaw.selectedReleases
        : (notifRaw.selectedReleases === null ? null : base.notifications.selectedReleases);

    const getOnlyOneNotification = typeof notifRaw.getOnlyOneNotification === 'boolean'
        ? notifRaw.getOnlyOneNotification
        : base.notifications.getOnlyOneNotification;

    const notificationOnRelatedRelease = typeof notifRaw.notificationOnRelatedRelease === 'boolean'
        ? notifRaw.notificationOnRelatedRelease
        : base.notifications.notificationOnRelatedRelease;

    const repliesNotifications = typeof notifRaw.repliesNotifications === 'boolean'
        ? notifRaw.repliesNotifications
        : base.notifications.repliesNotifications;

    const commentsOnCollectionNotification = typeof notifRaw.commentsOnCollectionNotification === 'boolean'
        ? notifRaw.commentsOnCollectionNotification
        : base.notifications.commentsOnCollectionNotification;

    return {
        appearance: {
            theme,
            highContrast,
            compactMode,
            customColors,
            language,
            defaultCardType,
        },
        player: {
            defaultQuality,
            autoplay,
            volume,
            qualityUpgrade,
            qualityUpgradeMode,
            showSkipOpeningButton,
            skipOpeningValue,
            autoFullscreen,
            autoPauseOnTabSwitch,
            keybindings,
        },
        content: {
            defaultTabOnHome,
            defaultTabOnFavorites,
            homeTabOrder: normalizeTabOrder(contentRaw.homeTabOrder ?? base.content.homeTabOrder, HOME_TAB_ORDER),
            favoritesTabOrder: normalizeTabOrder(contentRaw.favoritesTabOrder ?? base.content.favoritesTabOrder, FAVORITES_TAB_ORDER),
            rememberSource,
            rememberedSourceId,
            rememberDub,
            rememberedDubId,
            rememberEpisodeTime,
            proxySearchThroughShikimori,
            proxyImages,
        },
        notifications: {
            recieveNotifications,
            notificationsType,
            selectedLists,
            selectedDubs,
            selectedReleases,
            getOnlyOneNotification,
            notificationOnRelatedRelease,
            repliesNotifications,
            commentsOnCollectionNotification,
        },
    };
}
