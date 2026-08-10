import { Link } from 'react-router-dom';
import type { Collection } from '../shared/types/api';
import { plural } from '../shared/plural';
import RemoteImage from './RemoteImage';
import styles from './CollectionCard.module.css';

interface CollectionCardProps {
    collection: Collection;
}

export default function CollectionCard({ collection }: CollectionCardProps) {
    return <article className={styles.card}>
        <Link className={styles.mainLink} to={`/collection/${collection.id}`} aria-label={`Открыть коллекцию «${collection.title}»`}>
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
                <span>{collection.comment_count} {plural(collection.comment_count, 'комментарий', 'комментария', 'комментариев')}</span>
                <span>{collection.favorites_count} сохранений</span>
            </div>
        </footer>
    </article>;
}

export type { CollectionCardProps };
