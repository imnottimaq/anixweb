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

export interface AppSettings {
    player: {
        defaultQuality: 'auto'| '1080' | '720' | '480' | '360';
        autoplay: boolean;
        volume: number;
        qualityUpgrade: boolean;
        qualityUpgradeMode: 'weak' | 'medium' | 'strong';
        showSkipOpeningButton: boolean;
        skipOpeningValue: number; // in seconds
        keybindings: PlayerKeybindings;
    },
    content: {
        defaultTabOnHome: 'latest' | 'my' | 'ongoing' | 'announced' | 'finished' | 'films';
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
        theme: 'light' | 'dark';
        language: 'russian' | 'english';
        defaultCardType: 'vertical' | 'horizontal';
    }
    notifications:{
        recieveNotifications: boolean;
        notificationsType: 'all' | 'selected_lists' | 'selected_releases' | null 
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
        keybindings: defaultPlayerKeybindings,
    },
    content:{
        defaultTabOnHome: 'latest',
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
        theme: 'light',
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
