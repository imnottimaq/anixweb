import type { Filter } from '../types/api';
export type PopularTabId = 'all' | 'ongoing' | 'finished' | 'films' | 'ova';

export interface PopularTabConfig {
    id: PopularTabId;
    labelKey: 'roadmap.discover.popular.tab.all' | 'roadmap.discover.popular.tab.ongoing' | 'roadmap.discover.popular.tab.finished' | 'roadmap.discover.popular.tab.films' | 'roadmap.discover.popular.tab.ova';
    filter: Partial<Filter>;
}

export const POPULAR_TABS: readonly PopularTabConfig[] = [
    { id: 'all', labelKey: 'roadmap.discover.popular.tab.all', filter: { sort: 3 } },
    { id: 'ongoing', labelKey: 'roadmap.discover.popular.tab.ongoing', filter: { sort: 3, status_id: 2 } },
    { id: 'finished', labelKey: 'roadmap.discover.popular.tab.finished', filter: { sort: 3, status_id: 1 } },
    { id: 'films', labelKey: 'roadmap.discover.popular.tab.films', filter: { sort: 3, category_id: 2 } },
    { id: 'ova', labelKey: 'roadmap.discover.popular.tab.ova', filter: { sort: 3, category_id: 3 } },
] as const;

export const EMPTY_FILTER_BASE: Required<Filter> = {
    country: null,
    category_id: null,
    status_id: null,
    genres: [],
    is_genres_exclude_mode_enabled: false,
    profile_list_exclusions: [],
    types: [],
    studio: null,
    source: null,
    start_year: null,
    end_year: null,
    episode_duration_from: null,
    episode_duration_to: null,
    episodes_from: null,
    episodes_to: null,
    season: null,
    age_ratings: [],
    sort: 3,
};

