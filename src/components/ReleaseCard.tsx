import { Link } from 'react-router-dom';
import { type Anime } from '../shared/types/api';
import styles from './ReleaseCard.module.css';
import starIcon from '../assets/icons/star.svg';
import RemoteImage from './RemoteImage';
import { useSettings } from '../shared/contexts/settingsContext';
import { useTranslation } from '../shared/useTranslation';

type RelatedReleaseCardProps = {
    variant: 'related';
    anime: Anime;
};

type ProfileReleaseCardProps = {
    variant: 'rated' | 'history';
    id: number;
    name: string;
    poster: string;
    grade: number;
    timestamp: number;
};

type ReleaseCardProps = RelatedReleaseCardProps | ProfileReleaseCardProps;

export default function ReleaseCard(props: ReleaseCardProps) {
    const { settings } = useSettings();
    const { t, formatDate } = useTranslation();
    const isRelated = props.variant === 'related';
    const name = isRelated
        ? (settings.appearance.language === 'english' && props.anime.title_original
            ? props.anime.title_original
            : props.anime.title_ru)
        : props.name;
    const poster = isRelated ? props.anime.image : props.poster;

    const content = (
        <article className={styles['release-card']}>
            <RemoteImage src={poster} loading="lazy" alt={name} />
            <div className={styles['release-content']}>
                <p className={styles.title}>{name}</p>
                {isRelated ? <>
                    <div className={styles['meta-row']}>
                        <span>{t('release.year', { year: props.anime.year })}</span>
                        <span className={styles['release-rating']}><img src={starIcon} alt="" />{props.anime.grade.toFixed(2)}</span>
                    </div>
                    {props.anime.category?.name && <span className={styles.category}>{props.anime.category.name}</span>}
                </> : <div className={styles['meta-row']}>
                    {props.variant === 'rated'
                        ? <span className={styles.stars} aria-label={t('release.gradeAria', { grade: props.grade })}>
                            {Array.from({ length: Math.max(0, Math.min(5, Math.round(props.grade))) }, (_, index) => (
                                <img key={index} src={starIcon} alt="" />
                            ))}
                        </span>
                        : <span>{t('release.episodeNumber', { number: props.grade })}</span>}
                    <span>{formatDate(props.timestamp * 1000, { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                </div>}
            </div>
        </article>
    );

    const releaseId = isRelated ? props.anime.id : props.id;

    return <Link to={`/anime/${releaseId}`} className={styles.link}>{content}</Link>;
}
