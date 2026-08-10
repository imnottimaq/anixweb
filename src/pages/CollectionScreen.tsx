import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import AnimeCardHorizontal from '../components/AnimeCardHorizontal';
import { PageHeader, PageLayout } from '../components/PageLayout';
import PageState from '../components/PageState';
import CommentComponent from '../components/Comment';
import RemoteImage from '../components/RemoteImage';
import { Modal } from '../modals/ModalTemplate';
import { useApi } from '../shared/apiClient';
import type { Anime, Collection, Comment, PagedResponse } from '../shared/types/api';
import { useAsyncLoad } from '../shared/useAsyncLoad';
import { useUser } from '../shared/contexts/userContext';
import { useTranslation } from '../shared/useTranslation';
import circleCheckIcon from '../assets/icons/circle-check.svg';
import circlePlusIcon from '../assets/icons/circle-plus.svg';
import commentsIcon from '../assets/icons/message-circle-dots.svg';
import sendIcon from '../assets/icons/send.svg';
import styles from './CollectionScreen.module.css';

type CollectionResponse = {
    code: number;
    collection?: Collection;
};

type CollectionPage = {
    collection?: Collection;
    releases: Anime[];
};

type CollectionComment = {
    id: number;
    message: string;
    timestamp?: number | string;
    is_spoiler?: boolean;
    vote_count?: number;
    vote?: number;
    reply_count?: number;
    profile: { id: number; login: string; avatar?: string | null };
};

type CollectionCommentsResponse = PagedResponse<CollectionComment> & {
    comments?: CollectionComment[];
};

type CollectionCommentMutationResponse = {
    code: number;
    comment?: CollectionComment | null;
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
    const [commentText, setCommentText] = useState('');
    const [commentSpoiler, setCommentSpoiler] = useState(false);
    const [isSendingComment, setIsSendingComment] = useState(false);
    const [commentError, setCommentError] = useState<string | null>(null);
    const [replyTarget, setReplyTarget] = useState<Comment | null>(null);
    const [editTarget, setEditTarget] = useState<Comment | null>(null);
    const [newReply, setNewReply] = useState<{ parentCommentId: number; comment: Comment } | null>(null);
    const [editedComment, setEditedComment] = useState<{ commentId: number; message: string; spoiler: boolean } | null>(null);
    const commentInputRef = useRef<HTMLTextAreaElement>(null);
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
        ? 'Не удалось открыть коллекцию.'
        : error
            ? 'Не удалось загрузить коллекцию.'
            : null;
    const { data: commentsData, error: commentsError, isLoading: isCommentsLoading, reload: reloadComments } = useAsyncLoad(
        signal => api.get<CollectionCommentsResponse>(`/collection/comment/all/${collectionId}/0`, { signal }),
        [api, collectionId],
        { enabled: isCommentsOpen && isValidId, initialData: { code: 0, content: [], total_count: 0, total_page_count: 0, current_page: 0 } },
    );
    const comments = commentsData?.content ?? commentsData?.comments ?? [];
    const isCommentTooShort = commentText.trim().length < 5;

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
            setManageError('Название должно содержать от 10 до 60 символов.');
            return;
        }
        if (description.length > 1000) {
            setManageError('Описание не должно превышать 1000 символов.');
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
        } catch (requestError) {
            setManageError(requestError instanceof Error ? requestError.message : 'Не удалось сохранить изменения.');
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
        } catch (requestError) {
            setManageError(requestError instanceof Error ? requestError.message : 'Не удалось удалить коллекцию.');
        } finally {
            setIsDeleting(false);
        }
    };

    const startReply = (comment: Comment) => {
        setReplyTarget(comment);
        setEditTarget(null);
        setCommentText(`${comment.profile.login}, `);
        setCommentSpoiler(false);
        setCommentError(null);
        window.requestAnimationFrame(() => commentInputRef.current?.focus());
    };

    const startEdit = (comment: Comment) => {
        setEditTarget(comment);
        setReplyTarget(null);
        setCommentText(comment.message);
        setCommentSpoiler(comment.is_spoiler);
        setCommentError(null);
        window.requestAnimationFrame(() => commentInputRef.current?.focus());
    };

    const sendComment = async () => {
        const message = commentText.trim();
        if (message.length < 5 || isSendingComment) {
            setCommentError(t('comments.minLength'));
            return;
        }
        if (!userId) {
            setCommentError(t('release.loginToChangeStatus'));
            return;
        }

        setIsSendingComment(true);
        setCommentError(null);
        try {
            if (editTarget) {
                await api.postViaAgent<{ code: number }>(`/collection/comment/edit/${editTarget.id}`, { message, spoiler: commentSpoiler });
                setEditedComment({ commentId: editTarget.id, message, spoiler: commentSpoiler });
            } else {
                const result = await api.postViaAgent<CollectionCommentMutationResponse>(`/collection/comment/add/${collectionId}`, {
                    message,
                    spoiler: commentSpoiler,
                    parentCommentId: replyTarget?.id ?? null,
                    replyToProfileId: replyTarget?.profile.id ?? null,
                });
                if (replyTarget && result.comment) {
                    setNewReply({ parentCommentId: replyTarget.id, comment: toComment(result.comment) });
                }
            }
            setCommentText('');
            setCommentSpoiler(false);
            setReplyTarget(null);
            setEditTarget(null);
            reloadComments();
        } catch (requestError) {
            setCommentError(requestError instanceof Error ? requestError.message : 'Не удалось отправить комментарий.');
        } finally {
            setIsSendingComment(false);
        }
    };

    return <PageLayout size="wide" className={styles.page}>
        <PageHeader title={collection?.title ?? 'Коллекция'} back />

        {collection && <section className={styles.hero}>
            {collection.image && <RemoteImage className={styles.cover} src={collection.image} alt="" />}
            <div className={styles.description}>
                {isPrivate && <p className={styles.privateNotice}>Это закрытая коллекция — она доступна только автору.</p>}
                {collection.description && <p>{collection.description}</p>}
                <Link className={styles.creator} to={`/account/${collection.creator.id}`}>
                    <RemoteImage src={collection.creator.avatar} alt="" />
                    <span>{collection.creator.login}</span>
                </Link>
                <div className={styles.actions}>
                    <button type="button" className={styles.actionButton} disabled={isFavoriteLoading} onClick={() => void toggleFavorite()}>
                        <img src={isFavorite ? circleCheckIcon : circlePlusIcon} alt="" />
                        {isFavorite ? 'Сохранено' : 'Сохранить'}
                    </button>
                    {!isPrivate && <button type="button" className={styles.actionButton} onClick={() => setIsCommentsOpen(true)}>
                        <img src={commentsIcon} alt="" />
                        Комментарии
                    </button>}
                    {isOwner && <>
                        <button type="button" className={styles.actionButton} onClick={openEdit}>Редактировать</button>
                        <button type="button" className={`${styles.actionButton} ${styles.deleteButton}`} onClick={() => {
                            setManageError(null);
                            setIsDeleteOpen(true);
                        }}>Удалить</button>
                    </>}
                </div>
                {manageError && <p className={styles.manageError}>{manageError}</p>}
            </div>
        </section>}

        <section className={styles.releases}>
            <div className={styles.sectionHeader}><h2>Релизы коллекции</h2></div>
            {isLoading && <PageState status="loading" message="Загружаем коллекцию…" />}
            {!isLoading && errorMessage && <PageState status="error" message={errorMessage} onRetry={isValidId ? reload : undefined} />}
            {!isLoading && !errorMessage && releases.length === 0 && <PageState status="empty" message="В этой коллекции пока нет релизов." />}
            <div className={styles.releaseList}>
                {releases.map(release => <AnimeCardHorizontal key={release.id} anime={release} />)}
            </div>
        </section>
        <Modal
            isOpen={isCommentsOpen}
            onClose={() => setIsCommentsOpen(false)}
            title="Комментарии коллекции"
            stickyHeader
            contentClassName={styles.commentsModal}
            contentStyle={{ width: 'min(1180px, calc(100vw - 32px))', maxHeight: '80vh' }}
        >
            <form className={styles.commentArea} onSubmit={event => {
                event.preventDefault();
                void sendComment();
            }}>
                {replyTarget && <div className={styles.replyContext}>
                    <span>{t('comments.replyFor')} <strong>{replyTarget.profile.login}</strong></span>
                    <button type="button" onClick={() => {
                        setReplyTarget(null);
                        setCommentText('');
                    }} aria-label={t('release.cancelReply')}>×</button>
                </div>}
                {editTarget && <div className={styles.replyContext}>
                    <span>{t('comments.editing')}</span>
                    <button type="button" onClick={() => {
                        setEditTarget(null);
                        setCommentText('');
                    }} aria-label={t('release.cancelEdit')}>×</button>
                </div>}
                <textarea
                    ref={commentInputRef}
                    value={commentText}
                    maxLength={1000}
                    placeholder={t('comments.writePlaceholder')}
                    onChange={event => {
                        setCommentText(event.target.value);
                        setCommentError(null);
                    }}
                />
                <div className={styles.commentControls}>
                    <label className={styles.spoilerToggle}>
                        <input type="checkbox" checked={commentSpoiler} onChange={event => setCommentSpoiler(event.target.checked)} />
                        <span>{t('comments.spoiler')}</span>
                    </label>
                    <span className={styles.commentCounter}>{commentText.length}/1000</span>
                    <button type="submit" className={styles.sendButton} disabled={isCommentTooShort || isSendingComment}>
                        <img src={sendIcon} alt="" />
                        {isSendingComment ? t('comments.sending') : t('comments.send')}
                    </button>
                </div>
                {commentError && <p className={styles.commentError}>{commentError}</p>}
            </form>
            {isCommentsLoading && <p className={styles.commentsMessage}>Загружаем комментарии…</p>}
            {commentsError as Error && <p className={styles.error}>Не удалось загрузить комментарии.</p>}
            {!isCommentsLoading && !commentsError && comments.length === 0 && <p className={styles.commentsMessage}>Комментариев пока нет.</p>}
            {!isCommentsLoading && comments.length > 0 && <div className={styles.commentsList}>
                {comments.map(comment => <CommentComponent
                    key={comment.id}
                    comment={toComment(comment)}
                    variant="collection"
                    onReply={startReply}
                    onEdit={startEdit}
                    newReply={newReply}
                    editedComment={editedComment}
                    onDelete={reloadComments}
                />)}
            </div>}
        </Modal>
        <Modal
            isOpen={isEditOpen}
            onClose={() => setIsEditOpen(false)}
            title="Редактировать коллекцию"
            actions={[
                { label: 'Отмена', variant: 'secondary', onClick: () => setIsEditOpen(false) },
                { label: isSaving ? 'Сохраняем…' : 'Сохранить', onClick: () => void saveCollection() },
            ]}
        >
            <div className={styles.editForm}>
                <label>
                    <span>Название</span>
                    <input value={editTitle} minLength={10} maxLength={60} onChange={event => setEditTitle(event.target.value)} />
                </label>
                <label>
                    <span>Описание</span>
                    <textarea value={editDescription} maxLength={1000} onChange={event => setEditDescription(event.target.value)} />
                </label>
                <label className={styles.privateToggle}>
                    <input type="checkbox" checked={isEditPrivate} onChange={event => setIsEditPrivate(event.target.checked)} />
                    <span>Доступна только мне</span>
                </label>
                {manageError && <p className={styles.manageError}>{manageError}</p>}
            </div>
        </Modal>
        <Modal
            isOpen={isDeleteOpen}
            onClose={() => setIsDeleteOpen(false)}
            title="Удалить коллекцию?"
            text="Коллекция, её релизы и комментарии будут удалены без возможности восстановления."
            actions={[
                { label: 'Отмена', variant: 'secondary', onClick: () => setIsDeleteOpen(false) },
                { label: isDeleting ? 'Удаляем…' : 'Удалить', variant: 'danger', onClick: () => void deleteCollection() },
            ]}
        />
    </PageLayout>;
}

function toComment(comment: CollectionComment): Comment {
    return {
        ...comment,
        timestamp: comment.timestamp ?? '',
        is_spoiler: comment.is_spoiler ?? false,
        vote_count: comment.vote_count ?? 0,
        vote: comment.vote ?? 0,
        reply_count: comment.reply_count ?? 0,
        release: {} as Anime,
        profile: {
            ...comment.profile,
            is_verified: false,
        } as Comment['profile'],
    } as Comment;
}
