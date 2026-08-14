import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import AnimeCardHorizontal from '../components/AnimeCardHorizontal';
import { PageHeader, PageLayout } from '../components/PageLayout';
import PageState from '../components/PageState';
import RemoteImage from '../components/RemoteImage';
import { Modal } from '../modals/ModalTemplate';
import CommentsModal from '../modals/CommentsModal';
import { useApi } from '../shared/apiClient';
import type { Anime, Collection, PagedResponse } from '../shared/types/api';
import { useAsyncLoad } from '../shared/useAsyncLoad';
import { useUser } from '../shared/contexts/userContext';
import { useTranslation } from '../shared/useTranslation';
import circleCheckIcon from '../assets/icons/circle-check.svg';
import circlePlusIcon from '../assets/icons/circle-plus.svg';
import commentsIcon from '../assets/icons/message-circle-dots.svg';
import styles from './CollectionScreen.module.css';

type CollectionResponse = {
    code: number;
    collection?: Collection;
};

type CollectionPage = {
    collection?: Collection;
    releases: Anime[];
};

export default function CollectionScreen() {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const api = useApi();
    const { userId } = useUser();
    const { t } = useTranslation();
    const collectionId = Number(id);
    const isValidId = Number.isInteger(collectionId) && collectionId > 0;
    const [isCommentsOpen, setIsCommentsOpen] = useState(false);
    const [favoriteOverride, setFavoriteOverride] = useState<boolean | null>(null);
    const [isFavoriteLoading, setIsFavoriteLoading] = useState(false);
    const [isEditOpen, setIsEditOpen] = useState(false);
    const [isDeleteOpen, setIsDeleteOpen] = useState(false);
    const [editTitle, setEditTitle] = useState('');
    const [editDescription, setEditDescription] = useState('');
    const [isEditPrivate, setIsEditPrivate] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);
    const [manageError, setManageError] = useState<string | null>(null);
    const { data, error, isLoading, reload } = useAsyncLoad(
        async signal => {
            const [collectionData, releasesData] = await Promise.all([
                api.get<CollectionResponse>(`/collection/${collectionId}`, { signal }),
                api.get<PagedResponse<Anime>>(`/collection/${collectionId}/releases/0`, { signal }),
            ]);

            return {
                collection: collectionData.collection,
                releases: releasesData.content ?? [],
            } satisfies CollectionPage;
        },
        [api, collectionId],
        { enabled: isValidId },
    );

    const collection = data?.collection;
    const releases = data?.releases ?? [];
    const isFavorite = favoriteOverride ?? collection?.is_favorite ?? false;
    const isOwner = collection?.creator.id === userId;
    const isPrivate = collection?.is_private ?? collection?.isPrivate ?? false;
    const errorMessage = !isValidId
        ? t('collection.openError')
        : error
            ? t('collection.loadError')
            : null;

    const toggleFavorite = async () => {
        if (!collection || isFavoriteLoading) return;

        const nextValue = !isFavorite;
        setFavoriteOverride(nextValue);
        setIsFavoriteLoading(true);
        try {
            await api.get<{ code: number }>(`/collectionFavorite/${nextValue ? 'add' : 'delete'}/${collection.id}`);
        } catch {
            setFavoriteOverride(isFavorite);
        } finally {
            setIsFavoriteLoading(false);
        }
    };

    const openEdit = () => {
        if (!collection) return;
        setEditTitle(collection.title);
        setEditDescription(collection.description ?? '');
        setIsEditPrivate(isPrivate);
        setManageError(null);
        setIsEditOpen(true);
    };

    const saveCollection = async () => {
        if (!collection || isSaving) return;
        const title = editTitle.trim();
        const description = editDescription.trim();

        if (title.length < 10 || title.length > 60) {
            setManageError(t('collections.titleValidation'));
            return;
        }
        if (description.length > 1000) {
            setManageError(t('collections.descriptionValidation'));
            return;
        }

        setIsSaving(true);
        setManageError(null);
        try {
            await api.postViaAgent<{ code: number }>(`/collectionMy/edit/${collection.id}`, {
                title,
                description,
                is_private: isEditPrivate,
            });
            setIsEditOpen(false);
            reload();
        } catch {
            setManageError(t('collection.saveError'));
        } finally {
            setIsSaving(false);
        }
    };

    const deleteCollection = async () => {
        if (!collection || isDeleting) return;

        setIsDeleting(true);
        setManageError(null);
        try {
            await api.getViaAgent<{ code: number }>(`/collectionMy/delete/${collection.id}`);
            navigate('/collections', { replace: true });
        } catch {
            setManageError(t('collection.deleteError'));
        } finally {
            setIsDeleting(false);
        }
    };

    return <PageLayout size="wide" className={styles.page}>
        <PageHeader title={collection?.title ?? t('collection.title')} back />

        {collection && <section className={styles.hero}>
            {collection.image && <RemoteImage className={styles.cover} src={collection.image} alt={t('collection.coverAlt', { title: collection.title })} />}
            <div className={styles.description}>
                {isPrivate && <p className={styles.privateNotice}>{t('collection.privateNotice')}</p>}
                {collection.description && <p>{collection.description}</p>}
                <Link className={styles.creator} to={`/account/${collection.creator.id}`}>
                    <RemoteImage src={collection.creator.avatar} alt={t('collection.creatorAlt', { name: collection.creator.login })} />
                    <span>{collection.creator.login}</span>
                </Link>
                <div className={styles.actions}>
                    <button type="button" className={styles.actionButton} disabled={isFavoriteLoading} onClick={() => void toggleFavorite()}>
                        <img src={isFavorite ? circleCheckIcon : circlePlusIcon} alt="" />
                        {t(isFavorite ? 'collection.saved' : 'collection.save')}
                    </button>
                    {!isPrivate && <button type="button" className={styles.actionButton} onClick={() => setIsCommentsOpen(true)}>
                        <img src={commentsIcon} alt="" />
                        Комментарии
                    </button>}
                    {isOwner && <>
                        <button type="button" className={styles.actionButton} onClick={openEdit}>{t('collection.edit')}</button>
                        <button type="button" className={`${styles.actionButton} ${styles.deleteButton}`} onClick={() => {
                            setManageError(null);
                            setIsDeleteOpen(true);
                        }}>{t('collection.delete')}</button>
                    </>}
                </div>
                {manageError && <p className={styles.manageError}>{manageError}</p>}
            </div>
        </section>}

        <section className={styles.releases}>
            <div className={styles.sectionHeader}><h2>{t('collection.releases')}</h2></div>
            {isLoading && <PageState status="loading" message={t('collection.loading')} />}
            {!isLoading && errorMessage && <PageState status="error" message={errorMessage} onRetry={isValidId ? reload : undefined} />}
            {!isLoading && !errorMessage && releases.length === 0 && <PageState status="empty" message={t('collection.empty')} />}
            <div className={styles.releaseList}>
                {releases.map(release => <AnimeCardHorizontal key={release.id} anime={release} />)}
            </div>
        </section>
        {isCommentsOpen && <CommentsModal
            isOpen
            entityId={collectionId}
            variant="collection"
            title={t('collection.commentsTitle')}
            onClose={() => setIsCommentsOpen(false)}
        />}
        <Modal
            isOpen={isEditOpen}
            onClose={() => setIsEditOpen(false)}
            title={t('collection.editTitle')}
            actions={[
                { label: t('collection.cancel'), variant: 'secondary', onClick: () => setIsEditOpen(false) },
                { label: t(isSaving ? 'collection.saving' : 'collection.saveChanges'), onClick: () => void saveCollection() },
            ]}
        >
            <div className={styles.editForm}>
                <label>
                    <span>{t('collections.name')}</span>
                    <input value={editTitle} minLength={10} maxLength={60} onChange={event => setEditTitle(event.target.value)} />
                </label>
                <label>
                    <span>{t('collections.description')}</span>
                    <textarea value={editDescription} maxLength={1000} onChange={event => setEditDescription(event.target.value)} />
                </label>
                <label className={styles.privateToggle}>
                    <input type="checkbox" checked={isEditPrivate} onChange={event => setIsEditPrivate(event.target.checked)} />
                    <span>{t('collections.private')}</span>
                </label>
                {manageError && <p className={styles.manageError}>{manageError}</p>}
            </div>
        </Modal>
        <Modal
            isOpen={isDeleteOpen}
            onClose={() => setIsDeleteOpen(false)}
            title={t('collection.deleteTitle')}
            text={t('collection.deleteText')}
            actions={[
                { label: t('collection.cancel'), variant: 'secondary', onClick: () => setIsDeleteOpen(false) },
                { label: t(isDeleting ? 'collection.deleting' : 'collection.delete'), variant: 'danger', onClick: () => void deleteCollection() },
            ]}
        />
    </PageLayout>;
}
