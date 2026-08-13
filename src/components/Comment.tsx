import styles from './Comment.module.css'
import verifiedBadge from '../assets/icons/verified.svg'
import upArrowIcon from '../assets/icons/up-arrow.svg'
import downArrowIcon from '../assets/icons/down-arrow.svg'
import replyIcon from '../assets/icons/reply.svg'
import arrowDownIcon from '../assets/icons/arrow-down.svg'
import { useEffect, useState } from 'react'
import { useUser } from '../shared/contexts/userContext'
import { Modal } from '../modals/ModalTemplate'
import { type Comment, type PagedResponse } from '../shared/types/api'
import RemoteImage from './RemoteImage'
import { useTranslation } from '../shared/useTranslation';
import { useApi } from '../shared/apiClient'
import { useNavigate } from 'react-router-dom'

export interface CommentProps {
    comment: Comment,
    releaseId?: number,
    onReply?: (comment: Comment) => void,
    onEdit?: (comment: Comment) => void,
    variant?: 'release' | 'collection',
    newReply?: { parentCommentId: number; comment: Comment } | null,
    editedComment?: { commentId: number; message: string; spoiler: boolean } | null,
    onDelete?: () => void,
}

export default function CommentComponent({ comment, releaseId, onReply, onEdit, variant = 'release', newReply, editedComment, onDelete }: CommentProps) {
    const { t, formatDate, selectPlural } = useTranslation();
    const api = useApi();
    const navigate = useNavigate();
    const [isRepliesShown, setIsRepliesShown] = useState(false);
    const userToken = useUser()
    const [replies, setReplies] = useState<Comment[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [replyCount, setReplyCount] = useState(comment.reply_count);
    const [currentVote, setCurrentVote] = useState(comment.vote);
    const [voteCount, setVoteCount] = useState(comment.vote_count);
    const [isVoting, setIsVoting] = useState(false);
    const [isCommentMenuOpen, setIsCommentMenuOpen] = useState(false);
    const [isCommentDeleted, setIsCommentDeleted] = useState(false);
    const [isCommentActionLoading, setIsCommentActionLoading] = useState(false);
    const [isDeleteConfirmationOpen, setIsDeleteConfirmationOpen] = useState(false);
    const [isSpoilerRevealed, setIsSpoilerRevealed] = useState(false);
    const isOwnComment = userToken.userId > 0
        && Number(comment.profile.id) === Number(userToken.userId);
    const commentMessage = editedComment?.commentId === comment.id
        ? editedComment.message
        : comment.message;
    const isSpoiler = editedComment?.commentId === comment.id
        ? editedComment.spoiler
        : comment.is_spoiler;
    const isCollectionComment = variant === 'collection';
    const endpointPrefix = isCollectionComment ? '/collection/comment' : '/release/comment';

    const handleVote = async (selectedVote: 1 | 2) => {
        if (isVoting) return;

        const nextVote = currentVote === selectedVote ? 0 : selectedVote;
        setIsVoting(true);

        try {
            await api.getViaAgent<{ code: number }>(`${endpointPrefix}/vote/${comment.id}/${selectedVote}`);
            setVoteCount((count) => count + getVoteScore(nextVote) - getVoteScore(currentVote));
            setCurrentVote(nextVote);
        } 
        catch (error) { console.error('Ошибка голосования:', error); } 
        finally {setIsVoting(false);}
    };

    const handleDeleteComment = async () => {
        if (isCommentActionLoading) return;

        setIsCommentActionLoading(true);
        try {
            await api.getViaAgent<{ code: number }>(`${endpointPrefix}/delete/${comment.id}`);
            setIsCommentDeleted(true);
            onDelete?.();
        } catch (err) {
            console.error('Ошибка удаления комментария:', err);
        } finally {
            setIsCommentActionLoading(false);
        }
    };

    useEffect(() => {
        if (!newReply || newReply.parentCommentId !== comment.id) return;

        let isCancelled = false;

        const appendReply = async () => {
            setIsLoading(true);
            try {
                const existingReplies = await api.get<PagedResponse<Comment>>
                (`${endpointPrefix}/replies/${comment.id}/0?sort=2`)
                if (isCancelled) return;

                setReplies([
                    ...existingReplies.content.filter((reply) => reply.id !== newReply.comment.id),
                    newReply.comment,
                ]);
                setReplyCount((count) => count + 1);
                setIsRepliesShown(true);
            } 
            catch (err) {console.error('Ошибка загрузки ответов:', err)} 
            finally {if (!isCancelled) setIsLoading(false)}
        };

        void appendReply();

        return () => {isCancelled = true}
    }, [api, comment.id, endpointPrefix, newReply, userToken.userToken]);

    const toggleReplies = async () => {
        if (isRepliesShown) {
            setIsRepliesShown(false);
            return;
        }

        if (replies.length === 0) {
            setIsLoading(true);
            try {
                const fetchedReplies = await api.get<PagedResponse<Comment>>
                (`${endpointPrefix}/replies/${comment.id}/0?sort=2`)
                setReplies(fetchedReplies.content);
                setIsRepliesShown(true);
            } 
            catch (err) {console.error("Ошибка загрузки ответов:", err)} 
            finally {setIsLoading(false)}
        } else setIsRepliesShown(true);
    };

    if (isCommentDeleted) return null;

    return (
        <>
        <div className={styles["comment"]}>
            <div className={styles['comment-header']}>
                <RemoteImage src={comment.profile.avatar} className={styles['avatar']} onClick={() => navigate(`/account/${comment.profile.id}`)} />
                <div className={styles['author-info']}>
                    <div className={styles['author-line']}>
                        <strong onClick={() => navigate(`/account/${comment.profile.id}`)}>{comment.profile.login}</strong>
                        {comment.profile.is_verified && <img src={verifiedBadge} className={styles['verified-badge']} alt="" />}
                        <time>{formatCommentDate(comment.timestamp, formatDate, t('date.invalid'))}</time>
                    </div>
                    <button type="button" className={styles['reply-button']} onClick={() => onReply?.(comment)}>
                        <img src={replyIcon} className={styles['arrow']} alt="" />
                        {t('comments.reply')}
                    </button>
                </div>
                {isOwnComment && <div className={styles['comment-menu']}>
                    <button
                        type="button"
                        className={styles['comment-menu-button']}
                        onClick={() => setIsCommentMenuOpen((isOpen) => !isOpen)}
                        aria-label={t('comments.actions')}
                        aria-expanded={isCommentMenuOpen}
                    >•••</button>
                    {isCommentMenuOpen && <div className={styles['comment-menu-options']}>
                        <button type="button" disabled={isCommentActionLoading} onClick={() => {
                            setIsCommentMenuOpen(false);
                            onEdit?.(comment);
                        }}>{t('comments.edit')}</button>
                        <button type="button" disabled={isCommentActionLoading} className={styles['delete-comment-option']} onClick={() => {
                            setIsCommentMenuOpen(false);
                            setIsDeleteConfirmationOpen(true);
                        }}>{t('comments.delete')}</button>
                    </div>}
                </div>}
            </div>
            
            <div className={styles['comment-message']}>
                {isSpoiler ? <div className={`${styles['spoiler-message']} ${!isSpoilerRevealed ? styles['spoiler-message-covered'] : ''}`}>
                    <p className={isSpoilerRevealed ? '' : styles['spoiler-message-hidden']}>{commentMessage}</p>
                    {!isSpoilerRevealed && <button
                        type="button"
                        className={styles['spoiler-reveal']}
                        onClick={() => setIsSpoilerRevealed(true)}
                    >
                        <span className={styles['spoiler-reveal-title']}>{t('comments.spoiler')}</span>
                        <span className={styles['spoiler-reveal-hint']}>{t('comments.spoilerHint')}</span>
                    </button>}
                </div> : <p>{commentMessage}</p>}
            </div>
            
            <div className={styles['vote']}>
                <button type="button" aria-label={t('comments.voteUp')} onClick={() => void handleVote(2)}>
                    <img src={upArrowIcon} className={`${styles['arrow']} ${currentVote === 2 ? styles['positive'] : ''}`} alt="" />
                </button>
                <span className={voteCount > 0 ? styles['vote-positive'] : voteCount < 0 ? styles['vote-negative'] : styles['vote-neutral']}>{voteCount}</span>
                <button type="button" aria-label={t('comments.voteDown')} onClick={() => void handleVote(1)}>
                    <img src={downArrowIcon} className={`${styles['arrow']} ${currentVote === 1 ? styles['negative'] : ''}`} alt="" />
                </button>
            </div>
            {replyCount !== 0 && (
                <div 
                    className={styles['show-replies']} 
                    onClick={toggleReplies}
                    style={{ cursor: 'pointer' }}
                >
                    <img src={arrowDownIcon} className={styles['arrow']} alt="" />
                    <p>
                        {isLoading ? t('misc.loading') : (
                            <>
                                {isRepliesShown ? `${t('comments.hideReplies')} ` : `${t('comments.showReplies')} `}
                                {replyCount} {t(`comments.showReplies${selectPlural(replyCount) === 'one' ? '1' : selectPlural(replyCount) === 'few' ? '2' : '5'}`)}
                            </>
                        )}
                    </p>
                </div>
            )}
            {isRepliesShown && replies.length > 0 && (
                <div className={styles.reply}>
                    {replies.map((reply) => (
                        <CommentComponent
                            key={reply.id}
                            comment={reply}
                            releaseId={releaseId}
                            onReply={onReply}
                            onEdit={onEdit}
                            variant={variant}
                            newReply={newReply}
                            editedComment={editedComment}
                            onDelete={onDelete}
                        />
                    ))}
                </div>
            )}
        </div>
        <Modal
            isOpen={isDeleteConfirmationOpen}
            onClose={() => setIsDeleteConfirmationOpen(false)}
            title={t('comments.deleteConfirmTitle')}
            text={t('comments.deleteConfirmText')}
            actions={[
                {
                    label: t('misc.cancel'),
                    variant: 'secondary',
                    onClick: () => setIsDeleteConfirmationOpen(false),
                },
                {
                    label: t('comments.delete'),
                    variant: 'danger',
                    onClick: () => void handleDeleteComment(),
                },
            ]}
        />
        </>
    )
}


function formatCommentDate(dateInput: Date | string | number, formatDate: (value: Date | number | string, options?: Intl.DateTimeFormatOptions) => string, invalidLabel: string): string {
    const isSeconds = typeof dateInput === 'number' && dateInput.toString().length <= 10;
    const date = new Date(isSeconds ? dateInput * 1000 : dateInput);
    if (Number.isNaN(date.getTime())) return invalidLabel;
    const options: Intl.DateTimeFormatOptions = { month: 'long', day: 'numeric' };
    if (date.getFullYear() !== new Date().getFullYear()) options.year = 'numeric';
    return formatDate(date, options);
}

function getVoteScore(vote: number): number {
    if (vote === 2) return 1;
    if (vote === 1) return -1;
    return 0;
}
