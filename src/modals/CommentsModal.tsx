import { useCallback, useMemo, useRef, useState, type UIEvent } from 'react';
import CommentComponent from '../components/Comment';
import sendIcon from '../assets/icons/send.svg';
import { useApi } from '../shared/apiClient';
import { useUser } from '../shared/contexts/userContext';
import type { Anime, Comment, PagedResponse } from '../shared/types/api';
import { useAsyncLoad } from '../shared/useAsyncLoad';
import { useTranslation } from '../shared/useTranslation';
import { Modal } from './ModalTemplate';
import styles from './CommentsModal.module.css';

type CommentsVariant = 'release' | 'collection';
type InitialAction = { type: 'compose' } | { type: 'reply' | 'edit'; comment: Comment } | null;

type CommentsModalProps = {
    isOpen: boolean;
    onClose: () => void;
    entityId: number;
    variant: CommentsVariant;
    title: string;
    initialAction?: InitialAction;
    onCommentsChanged?: () => void;
};

type CommentResponse = PagedResponse<Comment> & { comments?: Comment[] };
type CommentMutationResponse = { code: number; comment?: Comment | null };

export default function CommentsModal({ isOpen, onClose, entityId, variant, title, initialAction = null, onCommentsChanged }: CommentsModalProps) {
    const api = useApi();
    const { userToken } = useUser();
    const { t } = useTranslation();
    const endpointPrefix = `/${variant}/comment`;
    const initialComment = initialAction && initialAction.type !== 'compose' ? initialAction.comment : null;
    const [commentText, setCommentText] = useState(() => initialAction?.type === 'reply'
        ? `${initialComment?.profile.login ?? ''}, `
        : initialAction?.type === 'edit' ? initialComment?.message ?? '' : '');
    const [commentSpoiler, setCommentSpoiler] = useState(() => initialAction?.type === 'edit' && Boolean(initialComment?.is_spoiler));
    const [replyTarget, setReplyTarget] = useState<Comment | null>(() => initialAction?.type === 'reply' ? initialComment : null);
    const [editTarget, setEditTarget] = useState<Comment | null>(() => initialAction?.type === 'edit' ? initialComment : null);
    const [isSendingComment, setIsSendingComment] = useState(false);
    const [commentError, setCommentError] = useState<string | null>(null);
    const [newReply, setNewReply] = useState<{ parentCommentId: number; comment: Comment } | null>(null);
    const [editedComment, setEditedComment] = useState<{ commentId: number; message: string; spoiler: boolean } | null>(null);
    const [pagination, setPagination] = useState<{ page: number; comments: Comment[] }>({ page: 0, comments: [] });
    const [loadingPage, setLoadingPage] = useState<number | null>(null);
    const loadingPageRef = useRef<number | null>(null);
    const commentInputRef = useRef<HTMLTextAreaElement>(null);

    const { data, error, isLoading, reload } = useAsyncLoad(
        signal => api.get<CommentResponse>(`${endpointPrefix}/all/${entityId}/0`, { signal }),
        [api, endpointPrefix, entityId],
        {
            enabled: isOpen && Number.isInteger(entityId) && entityId > 0,
            initialData: { code: 0, content: [], total_count: 0, total_page_count: 0, current_page: 0 },
        },
    );
    const firstPage = useMemo(() => (data?.content ?? data?.comments ?? []).map(normalizeComment), [data]);
    const comments = useMemo(() => [...firstPage, ...pagination.comments]
        .filter((comment, index, all) => all.findIndex(item => item.id === comment.id) === index), [firstPage, pagination.comments]);
    const isCommentTooShort = commentText.trim().length < 5;

    const reloadAll = useCallback(() => {
        setPagination({ page: 0, comments: [] });
        loadingPageRef.current = null;
        setLoadingPage(null);
        reload();
        onCommentsChanged?.();
    }, [onCommentsChanged, reload]);

    const loadNextPage = useCallback(async () => {
        const lastPage = data?.total_page_count ?? 0;
        if (loadingPageRef.current !== null || pagination.page >= lastPage) return;
        const nextPage = pagination.page + 1;
        loadingPageRef.current = nextPage;
        setLoadingPage(nextPage);
        try {
            const page = await api.get<CommentResponse>(`${endpointPrefix}/all/${entityId}/${nextPage}`);
            const nextComments = (page.content ?? page.comments ?? []).map(normalizeComment);
            setPagination(previous => ({ page: page.current_page ?? nextPage, comments: [...previous.comments, ...nextComments] }));
        } catch (requestError) {
            console.error('Не удалось загрузить следующую страницу комментариев:', requestError);
        } finally {
            loadingPageRef.current = null;
            setLoadingPage(null);
        }
    }, [api, data?.total_page_count, endpointPrefix, entityId, pagination.page]);

    const handleScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
        const container = event.currentTarget;
        const distance = container.scrollHeight - container.clientHeight;
        if (distance > 0 && container.scrollTop / distance >= .7) void loadNextPage();
    }, [loadNextPage]);

    const focusInput = () => window.requestAnimationFrame(() => commentInputRef.current?.focus());
    const startReply = (comment: Comment) => {
        setReplyTarget(comment);
        setEditTarget(null);
        setCommentText(`${comment.profile.login}, `);
        setCommentSpoiler(false);
        setCommentError(null);
        focusInput();
    };
    const startEdit = (comment: Comment) => {
        setEditTarget(comment);
        setReplyTarget(null);
        setCommentText(comment.message);
        setCommentSpoiler(comment.is_spoiler);
        setCommentError(null);
        focusInput();
    };

    const sendComment = async () => {
        const message = commentText.trim();
        if (message.length < 5 || isSendingComment) {
            setCommentError(t('comments.minLength'));
            return;
        }
        if (!userToken) {
            setCommentError(t('release.loginToChangeStatus'));
            return;
        }

        setIsSendingComment(true);
        setCommentError(null);
        try {
            if (editTarget) {
                const body = { message, spoiler: commentSpoiler };
                if (variant === 'collection') await api.postViaAgent<{ code: number }>(`${endpointPrefix}/edit/${editTarget.id}`, body);
                else await api.post<{ code?: number }>(`${endpointPrefix}/edit/${editTarget.id}`, body);
                setEditedComment({ commentId: editTarget.id, message, spoiler: commentSpoiler });
            } else {
                const result = await api.postViaAgent<CommentMutationResponse>(`${endpointPrefix}/add/${entityId}`, {
                    message,
                    spoiler: commentSpoiler,
                    parentCommentId: replyTarget?.id ?? null,
                    replyToProfileId: replyTarget?.profile.id ?? null,
                });
                if (replyTarget && result.comment) {
                    setNewReply({ parentCommentId: replyTarget.id, comment: normalizeComment(result.comment) });
                }
            }
            setCommentText('');
            setCommentSpoiler(false);
            setReplyTarget(null);
            setEditTarget(null);
            reloadAll();
        } catch (sendError) {
            setCommentError(variant === 'collection' ? t('collection.commentError') : sendError instanceof Error ? sendError.message : t('release.loadError'));
        } finally {
            setIsSendingComment(false);
        }
    };

    const loadingText = variant === 'collection' ? t('collection.commentsLoading') : t('misc.loading');
    const emptyText = variant === 'collection' ? t('collection.commentsEmpty') : t('release.noComments');
    const errorText = variant === 'collection' ? t('collection.commentsError') : t('release.loadError');

    return <Modal
        isOpen={isOpen}
        onClose={onClose}
        title={title}
        stickyHeader
        onBodyScroll={handleScroll}
        contentClassName={styles.modal}
        contentStyle={{ width: 'min(1180px, calc(100vw - 32px))', maxHeight: '80vh' }}
    >
        {isLoading && <p className={styles.message}>{loadingText}</p>}
        {Boolean(error) && <p className={styles.error}>{errorText}</p>}
        {!isLoading && !error && comments.length === 0 && <p className={styles.message}>{emptyText}</p>}
        {!isLoading && comments.map(comment => <CommentComponent
            key={comment.id}
            comment={comment}
            releaseId={variant === 'release' ? entityId : undefined}
            variant={variant}
            onReply={startReply}
            onEdit={startEdit}
            newReply={newReply}
            editedComment={editedComment}
            onDelete={reloadAll}
        />)}
        {loadingPage !== null && <p className={styles.message}>{loadingText}</p>}
        <form className={styles.composer} onSubmit={event => { event.preventDefault(); void sendComment(); }}>
            {replyTarget && <div className={styles.context}>
                <span>{t('comments.replyFor')} <strong>{replyTarget.profile.login}</strong></span>
                <button type="button" onClick={() => { setReplyTarget(null); setCommentText(''); }} aria-label={t('release.cancelReply')}>×</button>
            </div>}
            {editTarget && <div className={styles.context}>
                <span>{t('comments.editing')}</span>
                <button type="button" onClick={() => { setEditTarget(null); setCommentText(''); }} aria-label={t('release.cancelEdit')}>×</button>
            </div>}
            <textarea
                ref={commentInputRef}
                autoFocus={initialAction !== null}
                value={commentText}
                maxLength={1000}
                placeholder={t('comments.writePlaceholder')}
                onChange={event => { setCommentText(event.target.value); setCommentError(null); }}
            />
            <div className={styles.controls}>
                <label className={styles.spoiler}>
                    <input type="checkbox" checked={commentSpoiler} onChange={event => setCommentSpoiler(event.target.checked)} />
                    <span>{t('comments.spoiler')}</span>
                </label>
                <span className={styles.counter}>{commentText.length}/1000</span>
                <button type="submit" className={styles.send} disabled={isCommentTooShort || isSendingComment}>
                    <img src={sendIcon} alt="" />
                    {isSendingComment ? t('comments.sending') : t('comments.send')}
                </button>
            </div>
            {commentError && <p className={styles.error}>{commentError}</p>}
        </form>
    </Modal>;
}

function normalizeComment(comment: Comment): Comment {
    return {
        ...comment,
        timestamp: comment.timestamp ?? '',
        is_spoiler: comment.is_spoiler ?? false,
        vote_count: comment.vote_count ?? 0,
        vote: comment.vote ?? 0,
        reply_count: comment.reply_count ?? 0,
        release: comment.release ?? ({} as Anime),
        profile: { ...comment.profile, is_verified: comment.profile.is_verified ?? false },
    };
}
