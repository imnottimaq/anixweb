import type { Dub } from "../../modals/DubSelectModal";
import type { Anime } from "./api";

export const playerKeybindingActions = [
    'togglePlayback',
    'seekBackward',
    'seekForward',
    'volumeDown',
    'volumeUp',
    'toggleMute',
    'toggleFullscreen',
    'previousEpisode',
    'nextEpisode',
    'skipOpening',
] as const;

export type PlayerKeybindingAction = typeof playerKeybindingActions[number];
export type PlayerKeybindings = Record<PlayerKeybindingAction, string>;

export const defaultPlayerKeybindings: PlayerKeybindings = {
    togglePlayback: 'Space',
    seekBackward: 'ArrowLeft',
    seekForward: 'ArrowRight',
    volumeDown: 'ArrowDown',
    volumeUp: 'ArrowUp',
    toggleMute: 'KeyM',
    toggleFullscreen: 'KeyF',
    previousEpisode: 'KeyP',
    nextEpisode: 'KeyN',
    skipOpening: 'KeyS',
};

export interface CustomColorSettings {
    enabled: boolean;
    accentColor: string;
    backgroundColor: string;
    textColor: string;
    autoTextColor: boolean;
}

export const defaultCustomColors: CustomColorSettings = {
    enabled: false,
    accentColor: '#FF6060',
    backgroundColor: '#161616',
    textColor: '#f4f5f7',
    autoTextColor: true,
};

export const HOME_TAB_ORDER = ['my', 'latest', 'donghua', 'ongoing', 'announced', 'finished', 'films'] as const;
export const FAVORITES_TAB_ORDER = ['collections', 'favorites', 'history', 'watching', 'planned', 'completed', 'hold_on', 'dropped'] as const;
export type HomeTabKey = typeof HOME_TAB_ORDER[number];
export type FavoritesTabKey = typeof FAVORITES_TAB_ORDER[number];

export interface AppSettings {
    player: {
        defaultQuality: 'auto'| '1080' | '720' | '480' | '360';
        autoplay: boolean;
        volume: number;
        qualityUpgrade: boolean;
        qualityUpgradeMode: 'weak' | 'medium' | 'strong';
        showSkipOpeningButton: boolean;
        skipOpeningValue: number; // in seconds
        autoFullscreen: boolean;
        autoPauseOnTabSwitch: boolean;
        keybindings: PlayerKeybindings;
    },
    content: {
        defaultTabOnHome: HomeTabKey;
        homeTabOrder: HomeTabKey[];
        favoritesTabOrder: FavoritesTabKey[];
        defaultTabOnFavorites: 'collections' | 'favorites' | 'history' | 'watching' | 'planned' | 'completed' | 'hold_on' | 'dropped'
        rememberSource: boolean;
        rememberedSourceId: number | null;
        rememberDub: boolean;
        rememberedDubId: number | null;
        rememberEpisodeTime: boolean;
        proxySearchThroughShikimori: boolean;
        proxyImages: boolean;
    }
    appearance:{
        theme: 'system' | 'light' | 'dark';
        highContrast: boolean;
        compactMode: boolean;
        customColors: CustomColorSettings;
        language: 'russian' | 'english';
        defaultCardType: 'vertical' | 'horizontal';
    }
    notifications:{
        recieveNotifications: boolean;
        notificationsType: null | 'all' | 'selected_lists' | 'selected_releases'
        selectedLists: string[] | null;
        selectedDubs: Dub[] | null;
        selectedReleases: Anime[] | null;
        getOnlyOneNotification: boolean;
        notificationOnRelatedRelease: boolean;
        repliesNotifications: boolean;
        commentsOnCollectionNotification: boolean;
    }
}

export const defaultAppSettings:AppSettings = {
    player:{
        defaultQuality: 'auto',
        autoplay: false,
        volume: 60,
        qualityUpgrade: false,
        qualityUpgradeMode: 'medium',
        showSkipOpeningButton: true,
        skipOpeningValue: 84,
        autoFullscreen: false,
        autoPauseOnTabSwitch: false,
        keybindings: defaultPlayerKeybindings,
    },
    content:{
        defaultTabOnHome: 'latest',
        homeTabOrder: [...HOME_TAB_ORDER],
        favoritesTabOrder: [...FAVORITES_TAB_ORDER],
        defaultTabOnFavorites: 'favorites',
        rememberSource: false,
        rememberedSourceId: null,
        rememberDub: false,
        rememberedDubId: null,
        rememberEpisodeTime: false,
        proxySearchThroughShikimori: false,
        proxyImages: false,
    },
    appearance:{
        theme: 'system',
        highContrast: false,
        compactMode: false,
        customColors: defaultCustomColors,
        language: 'russian',
        defaultCardType: 'vertical'
    },
    notifications:{
        recieveNotifications: false,
        notificationsType: null,
        selectedLists: null,
        selectedDubs: null,
        selectedReleases: null,
        getOnlyOneNotification: false, 
        notificationOnRelatedRelease: false,
        repliesNotifications: false,
        commentsOnCollectionNotification: false,
    }
}
