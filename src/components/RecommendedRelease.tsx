import { releaseMenuAttributes, useReleaseAnime } from '../shared/contexts/releaseActionsContext';
import { Link } from 'react-router-dom';
import type { Anime } from '../shared/types/api';
import RemoteImage from './RemoteImage';
import StarIcon from '../assets/icons/star.svg';
import styles from './RecommendedRelease.module.css';

interface RecommendedReleaseProps {
    anime: Anime;
}

export default function RecommendedRelease({ anime: originalAnime }: RecommendedReleaseProps) {
    const anime = useReleaseAnime(originalAnime);
    return (
        <Link {...releaseMenuAttributes(anime)} to={`/anime/${anime.id}`} state={{ partialAnime: anime }} className={styles.card}>
            <div className={styles.poster}>
                <RemoteImage src={anime.image} alt={anime.title_ru} loading="lazy" />
            </div>
            <p className={styles.title}>{anime.title_ru}</p>
            <div className={styles.meta}>
                <span>{anime.episodes_released || '?'} / {anime.episodes_total || '?'}</span>
                {anime.grade > 0 && <span className={styles.rating}><img src={StarIcon} alt="" />{anime.grade.toFixed(1)}</span>}
            </div>
        </Link>
    );
}
