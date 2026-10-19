import { type Anime } from "./api";
export type Page = 'my' | 'latest' | 'donghua' | 'ongoing' | 'announced' | 'ended' | 'films';

export type TabData = {
    releases: Anime[];
    page: number;
    loadedPages: number[];
    isLoading: boolean;
    hasMore: boolean;
};

export const emptyTab = (): TabData => ({
    releases: [],
    page: 0,
    loadedPages: [],
    isLoading: false,
    hasMore: true,
});
