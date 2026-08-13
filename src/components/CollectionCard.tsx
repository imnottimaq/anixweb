import { Link } from 'react-router-dom';
import type { Collection } from '../shared/types/api';
import RemoteImage from './RemoteImage';
import styles from './CollectionCard.module.css';
import { useTranslation } from '../shared/useTranslation';

interface CollectionCardProps {
    collection: Collection;
}

export default function CollectionCard({ collection }: CollectionCardProps) {
    const { t, selectPlural } = useTranslation();
    return <article className={styles.card}>
        <Link className={styles.mainLink} to={`/collection/${collection.id}`} aria-label={t('collection.open', { title: collection.title })}>
            <RemoteImage src={collection.image} className={styles.poster} alt={collection.title} />
            <div className={styles.content}>
                <h2>{collection.title}</h2>
                {collection.description && <p>{collection.description}</p>}
            </div>
        </Link>
        <footer className={styles.footer}>
            <Link className={styles.creator} to={`/account/${collection.creator.id}`}>
                <RemoteImage src={collection.creator.avatar} alt="" />
                <span>{collection.creator.login}</span>
            </Link>
            <div className={styles.stats}>
                <span>{collection.comment_count} {t(`comments.count.${selectPlural(collection.comment_count) as 'one' | 'few' | 'many' | 'other'}`)}</span>
                <span>{t(`collection.saved.${selectPlural(collection.favorites_count) as 'one' | 'few' | 'many' | 'other'}`, { count: collection.favorites_count })}</span>
            </div>
        </footer>
    </article>;
}

export type { CollectionCardProps };
