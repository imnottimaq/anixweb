import type { Dub } from "../../modals/DubSelectModal";

export interface Anime {
  id: number;
  image: string;
  title_ru: string;
  title_original: string;
  episodes_released: number;
  episodes_total: number | null;
  grade: number;
  description: string;
  favorites_count: number;
  duration: number;
  country: string;
  season: number;
  year: string;
  aired_on_date: number;
  genres: string;
  studio: string;
  author: string;
  director: string;
  category: {
    name: string
  };
  status: {
    name: string
  };
  age_rating: number;
  related_releases: Anime[];
  recommended_releases: Anime[];
  profile_list_status: number;
  vote_1_count: number;
  vote_2_count: number;
  vote_3_count: number;
  vote_4_count: number;
  vote_5_count: number;
  vote_count: number;
  screenshot_images: string[];
  comments: Comment[];
  note: string;
  watching_count: number;
  plan_count: number;
  completed_count: number;
  hold_on_count: number;
  dropped_count: number;
  is_favorite: boolean;
  my_vote: number;
  comment_per_day_count: number;
  comment_count?: number;
  comments_count?: number;
}

export interface Comment {
    id: number,
    profile: Profile,
    message: string,
    timestamp: string,
    vote_count: number,
    is_spoiler: boolean,
    vote: number,
    reply_count: number,
    release: Anime
}

export interface Filter {
  country?: 'Япония' | 'Китай' | 'Южная Корея' | null;
  category_id?: 1|2|3|4 | null; //1 - Сериал, 2 - Фильм, 3 - OVA, 4 - Дорама? (На момент 25.07.2026 ни одной дорамы в приложении нету)
  status_id?: 1|2|3 | null; //1 - Вышел, 2 - Выходит, 3 - Анонс 
  genres?: string[]; 
  is_genres_exclude_mode_enabled?: boolean;
  profile_list_exclusions?: number[]; // 0 - Избранное, 1 - Смотрю, 2 - В планах, 3 - Просмотрено, 4 - Отложено, 5 - Брошено
  types?: string[];
  studio?: string | null;
  source?: string | null;
  start_year?: number | null;
  end_year?: number | null;
  episode_duration_from?: number | null;
  episode_duration_to?: number | null;
  episodes_from?: number | null;
  episodes_to?: number | null;
  season?: 1|2|3|4 | null; // 1 - Зима, 2 - Весна, 3 - Лето, 4 - Осень
  age_ratings?: (1|2|3|4|5)[]; //1 - 0+, 2 - 6+, 3 - 12+, 4 - 16+, 5 - 18+
  sort?: 0|1|2|3; // 0 - По дате добавления, 1 - По рейтингу, 2 - По годам, 3 - По популярности
}

export interface Profile {
  id: number;
  login: string;
  avatar: string;
  status: string;
  badge: string;
  history: ProfileHistoryRelease[];
  votes: ProfileVotedRelease[];
  last_activity_time: number;
  register_date: number;
  vk_page: string;
  tg_page: string;
  inst_page: string;
  tt_page: string;
  discord_page: string;
  watched_episode_count: number;
  watched_time: number; // В секундах
  watching_count: number;
  plan_count: number;
  completed_count: number;
  hold_on_count: number;
  dropped_count: number;
  favorite_count: number;
  comment_count: number;
  collection_count: number;
  video_count: number;
  friend_count: number;
  subscription_count: number;
  is_verified: boolean;
  is_online: boolean;
  rating_score: number;
  comments_preview: Comment;
  watch_dynamics: [{
    id: number;
    day: number;
    count: number;
    timestamp: number;
  }];
  roles: [{
    name: string;
    color: string;
  }]
  friend_status: number | null; // null - ничего, 0 - вы отправили запрос дружбы, 1 - вам отправили запрос дружбы, 2 - друзья

  // TODO: расширить
}

export interface ProfileVotedRelease extends Anime {
  voted_at: number;
}

export interface ProfileHistoryRelease extends Anime {
  last_view_episode: {
    position: number;
  };
  last_view_timestamp: number;
}

export interface NotificationsPreferencesAPIResponse {
  code: number;
  profileStatusNotificationPreferences: Array<{
    '@id': number;
    status: 'FAVORITE_STATUS' | 'STATUS_WATCHING' | 'STATUS_PLAN' | 'STATUS_COMPLETED' | 'STATUS_HOLD_ON' | 'STATUS_DROPPED';
  }>;
  profileTypeNotificationPreferences: Array<{
    '@id': number;
    type: Dub;
  }>;
  is_release_type_notifications_enabled: boolean;
  is_episode_notifications_enabled: boolean;
  is_first_episode_notification_enabled: boolean;
  is_related_release_notifications_enabled: boolean;
  is_report_process_notifications_enabled: boolean;
  is_comment_notifications_enabled: boolean;
  is_my_collection_comment_notifications_enabled: boolean;
  is_article_notifications_enabled: boolean;
  is_my_article_comment_notifications_enabled: boolean;
}

export interface AnimeWithSelectedDub extends Anime {
  profile_release_type_notification_preference_count: number,
  is_release_type_notifications_enabled: boolean
}

export interface AllDubbersAPIResponse {
  code: number,
  types: Dub[]
}

export interface PagedResponse<TContent> {
  code: number;
  content: TContent[];
  total_count: number;
  total_page_count: number;
  current_page: number;
}

export type ReleaseNotificationsPreferencesAPIResponse = PagedResponse<AnimeWithSelectedDub>;

/** @deprecated Используй PagedResponse<T>. */
export type NotificationsPagedResponse<TNotification> = PagedResponse<TNotification>;

export type AllNotificationsAPIResponse = NotificationsPagedResponse<AnixartNotification>;

export type NotificationProfile = Pick<Profile, 'id' | 'login' | 'avatar'>;

export type NotificationBase<TType extends string = string> = {
  type: TType;
  id: number;
  profile?: NotificationProfile;
  timestamp: number;
  is_pushed: boolean;
  is_new: boolean;
};

export type EpisodeNotification = NotificationBase<'episode'> & {
  episode: {
    name: string;
    position: number;
    release: { id: number; title_ru: string; image: string | null };
    source: { id: number; name: string; type: { name: string } | null };
  };
};

export type FriendNotification = NotificationBase<'friend'> & {
  status: string;
  by_profile: NotificationProfile;
};

export type RelatedReleaseNotification = NotificationBase<'relatedRelease'> & {
  '@id': number;
  release: number;
};

export type ArticleNotification = NotificationBase<'article'> & {
  '@id': number;
  article: number;
};

export type NotificationComment = {
  id: number;
  message: string;
  is_spoiler: boolean;
  profile?: NotificationProfile;
};

export type ReleaseNotificationComment = NotificationComment & {
  release: { id: number; title_ru: string; image: string | null };
};

export type ReleaseCommentNotification = NotificationBase<'releaseComment'> & {
  parentComment?: ReleaseNotificationComment;
  comment?: ReleaseNotificationComment;
};

export type CollectionCommentNotification = NotificationBase<'myCollection'> & {
  collection_comment: NotificationComment & {
    collection: { id: number; title: string; image: string | null };
  };
};

export type AnixartNotification =
  | EpisodeNotification
  | FriendNotification
  | RelatedReleaseNotification
  | ArticleNotification
  | ReleaseCommentNotification
  | CollectionCommentNotification;

export interface DiscoverInteresting{
  id: number,
  title: string,
  description: string,
  image: string,
  type: number,
  action: number, // id релиза
}

export interface Collection{
  id: number,
  creator: Profile,
  title: string,
  description: string,
  image: string,
  releases: Anime[],
  creation_date: number,
  last_update_date: number,
  comment_count: number,
  favorites_count: number,
  is_favorite: boolean,
  is_private?: boolean,
  isPrivate?: boolean,
}
