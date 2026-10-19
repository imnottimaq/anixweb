import { releaseMenuAttributes, useReleaseAnime } from '../shared/contexts/releaseActionsContext';
import { Link } from "react-router-dom";
import styles from "./AnimeCardHorizontal.module.css"
import { type Anime } from "../shared/types/api";
import { profileListStatus } from "../shared/profileListStatus"
import starIcon from '../assets/icons/star.svg'
import RemoteMedia from './RemoteMedia';
import { getReleaseTitle } from '../shared/releaseTitle';
import { useSettings } from '../shared/contexts/settingsContext';
import { useTranslation } from '../shared/useTranslation';

export interface AnimeCardProps {
  anime: Anime;
  compact?: boolean;
}

export default function AnimeCardHorizontal({ anime: originalAnime, compact = false }: AnimeCardProps) {
  const anime = useReleaseAnime(originalAnime);
  const { settings } = useSettings();
  const { t, selectPlural } = useTranslation();
  const listStatus = profileListStatus[anime.profile_list_status as 0 | 1 | 2 | 3 | 4 | 5];
  const title = getReleaseTitle(anime, settings.appearance.language);

  return (
    <Link {...releaseMenuAttributes(anime)} to={`/anime/${anime.id}`} state={{partialAnime: anime}} key={anime.id} className={`${styles.card} ${compact ? styles.compact : ''}`}>
      <div className={styles.poster}>
        <RemoteMedia
          src={anime.image}
          alt={title}
          loading="lazy"
        />
        {listStatus && <span className={`${styles['list-status']} ${styles[`status-${listStatus.color}`]}`}>{t(listStatus.labelKey)}</span>}
      </div>
      <div className={styles.info}>
        <p className={styles['anime-title']}>{title}</p>
        <p className={styles['anime-meta']}>
          {anime.episodes_released || "?"} {t('misc.outOf')} {anime.episodes_total || "?"} {t('misc.episodes')}
          {anime.grade !== 0 && <span className={styles['anime-rating']}><img src={starIcon} alt="" />{anime.grade.toFixed(2)}</span>}
        </p>
        <p className={styles['anime-description']}>{anime.description?.trim() || t('release.noDescription')}</p>
        {compact && anime.comment_per_day_count > 0 && <p className={styles['comment-activity']}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5Z" />
          </svg>
          <span>{t('card.commentsPerDay', { count: anime.comment_per_day_count, comments: t(`comments.count.${selectPlural(anime.comment_per_day_count) as 'one' | 'few' | 'many' | 'other'}`) })}</span>
        </p>}
      </div>
    </Link>
  );
}
