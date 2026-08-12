import { useEffect, useRef, useState } from "react";
import { useParams, useLocation, useNavigate } from "react-router-dom"
import styles from './ReleaseScreen.module.css'
import { type Anime, type Collection } from "../shared/types/api";
import ReleaseCard from "../components/ReleaseCard";
import { useUser } from "../shared/contexts/userContext";
import { useSettings } from "../shared/contexts/settingsContext";
import Comment from "../components/Comment";
import { type Comment as CommentType } from "../shared/types/api";
import DubSelectModal from "../modals/DubSelectModal";
import type { Dub } from '../modals/DubSelectModal';
import WatchlistLine from "../components/WatchlistLine";
import RemoteImage from '../components/RemoteImage';
import { useTranslation } from '../shared/useTranslation';
import { plural } from '../shared/plural';
import { Modal } from '../modals/ModalTemplate';
import { useAsyncLoad } from '../shared/useAsyncLoad';

//Icons
import peopleIcon from "../assets/icons/users.svg"
import calendarIcon from "../assets/icons/calendar.svg"
import tagsIcon from "../assets/icons/tags.svg"
import albumIcon from "../assets/icons/album-collection.svg"
import favoriteIcon from '../assets/icons/bookmark.svg'
import sendIcon from '../assets/icons/send.svg'
import leftArrowIcon from '../assets/icons/left-arrow.svg'
import rightArrowIcon from '../assets/icons/right-arrow.svg'
import commentsIcon from '../assets/icons/message-circle-dots.svg'
import folderPlusIcon from '../assets/icons/folder-plus.svg'
import bellIcon from '../assets/icons/bell.svg'

import { setPlayerSession } from '../shared/playerSession'
import RecommendedRelease from "../components/RecommendedRelease";
import { useApi } from "../shared/apiClient";
import type { PagedResponse } from '../shared/types/api';
import PageState from '../components/PageState';

export default function ReleaseScreen(){
    const {id} = useParams<{id: string}>();
    const {userToken, userId, setUserId} = useUser();
    const {settings} = useSettings();
    const { t } = useTranslation();
    const navigate = useNavigate();
    const location = useLocation();
    const api = useApi();
    const roomParams = new URLSearchParams(location.search);
    const roomId = roomParams.get('room');
    const roomAutoSelect = roomId
        && Number.isInteger(Number(roomParams.get('dub')))
        && Number.isInteger(Number(roomParams.get('source')))
        && Number.isInteger(Number(roomParams.get('episode')))
        ? { dubId: Number(roomParams.get('dub')), sourceId: Number(roomParams.get('source')), episode: Number(roomParams.get('episode')) }
        : null;
    const partialData = location.state?.partialAnime || null;

    const [animeData, setAnimeData] = useState<Anime>(partialData);
    const [screenshots, setScreenshots] = useState<string[]>([]);
    const [activeScreenshotIndex, setActiveScreenshotIndex] = useState(0);
    const [loadedPoster, setLoadedPoster] = useState<string | null>(null);
    const [loadedScreenshots, setLoadedScreenshots] = useState<Record<string, boolean>>({});
    const [isDubScreenOpen, setIsDubScreenOpen] = useState(false);
    const [isCollectionPickerOpen, setIsCollectionPickerOpen] = useState(false);
    const [isReleaseNotificationsOpen, setIsReleaseNotificationsOpen] = useState(false);
    const [releaseNotificationMode, setReleaseNotificationMode] = useState<'none' | 'all_dubs' | 'selected_dubs'>('none');
    const [notificationDubs, setNotificationDubs] = useState<Dub[]>([]);
    const [selectedNotificationDubIds, setSelectedNotificationDubIds] = useState<number[]>([]);
    const [isNotificationSettingsLoading, setIsNotificationSettingsLoading] = useState(false);
    const [isNotificationSettingsSaving, setIsNotificationSettingsSaving] = useState(false);
    const [notificationSettingsError, setNotificationSettingsError] = useState<string | null>(null);
    const [isReleaseVoteLoading, setIsReleaseVoteLoading] = useState(false);
    const [releaseVoteError, setReleaseVoteError] = useState<string | null>(null);
    const [selectedReleaseVote, setSelectedReleaseVote] = useState<number | null>(null);
    const [myCollections, setMyCollections] = useState<Collection[]>([]);
    const [isCollectionsLoading, setIsCollectionsLoading] = useState(false);
    const [collectionActionId, setCollectionActionId] = useState<number | null>(null);
    const [collectionActionError, setCollectionActionError] = useState<string | null>(null);
    const [collectionActionNotice, setCollectionActionNotice] = useState<string | null>(null);
    const requestKey = `${id ?? ''}:${userToken}`;
    const [loadedRequestKey, setLoadedRequestKey] = useState<string | null>(null);
    const [releaseLoadError, setReleaseLoadError] = useState<{ key: string; message: string } | null>(null);
    const [releaseLoadAttempt, setReleaseLoadAttempt] = useState(0);
    const [commentText, setCommentText] = useState('');
    const [commentSpoiler, setCommentSpoiler] = useState(false);
    const [isSendingComment, setIsSendingComment] = useState(false);
    const [commentError, setCommentError] = useState<string | null>(null);
    const [replyTarget, setReplyTarget] = useState<CommentType | null>(null);
    const [newReply, setNewReply] = useState<{ parentCommentId: number; comment: CommentType } | null>(null);
    const [editTarget, setEditTarget] = useState<CommentType | null>(null);
    const [editedComment, setEditedComment] = useState<{ commentId: number; message: string; spoiler: boolean } | null>(null);
    const [isCommentsOpen, setIsCommentsOpen] = useState(false);
    const [shouldFocusCommentInput, setShouldFocusCommentInput] = useState(false);
    const commentInputRef = useRef<HTMLTextAreaElement>(null);

    const releaseAttemptKey = `${requestKey}:${releaseLoadAttempt}`;
    const isReleaseLoading = loadedRequestKey !== releaseAttemptKey;
    const isCommentTooShort = commentText.trim().length < 5;
    const releaseId = Number(id);
    const isValidReleaseId = Number.isInteger(releaseId) && releaseId > 0;
    const { data: commentsData, error: commentsLoadError, isLoading: isCommentsLoading, reload: reloadComments } = useAsyncLoad(
        signal => api.get<PagedResponse<CommentType>>(`/release/comment/all/${releaseId}/0`, { signal }),
        [api, releaseId],
        {
            enabled: isValidReleaseId,
            initialData: { code: 0, content: [], total_count: 0, total_page_count: 0, current_page: 0 },
        },
    );
    const releaseComments = commentsData?.content ?? [];

    useEffect(() => {
        if (!isCommentsOpen || !shouldFocusCommentInput) return;

        const frame = window.requestAnimationFrame(() => {
            commentInputRef.current?.focus();
            setShouldFocusCommentInput(false);
        });
        return () => window.cancelAnimationFrame(frame);
    }, [isCommentsOpen, shouldFocusCommentInput]);

    const openCommentEditor = () => {
        setShouldFocusCommentInput(true);
        setIsCommentsOpen(true);
    };

    const openCollectionPicker = async () => {
        if (!userToken || !userId) {
            alert(t('release.loginToChangeStatus'));
            return;
        }

        setIsCollectionPickerOpen(true);
        setCollectionActionError(null);
        setCollectionActionNotice(null);
        setIsCollectionsLoading(true);
        try {
            const collections = await loadAllPagesOrEmpty(page => (
                api.get<PagedResponse<Collection>>(`/collection/all/profile/${userId}/${page}?previous_page=${page - 1}&sort=5`)
            ));
            setMyCollections(collections);
        } catch (error) {
            setMyCollections([]);
            setCollectionActionError(error instanceof Error ? error.message : 'Не удалось загрузить ваши коллекции.');
        } finally {
            setIsCollectionsLoading(false);
        }
    };

    const addReleaseToCollection = async (collection: Collection) => {
        if (collectionActionId !== null) return;

        setCollectionActionId(collection.id);
        setCollectionActionError(null);
        setCollectionActionNotice(null);
        try {
            await api.getViaAgent<{ code: number }>(`/collectionMy/release/add/${collection.id}?release_id=${animeData.id}`);
            setCollectionActionNotice(`Релиз добавлен в коллекцию «${collection.title}».`);
        } catch (error) {
            setCollectionActionError(error instanceof Error && error.message === 'API error: 5'
                ? 'Этот релиз уже есть в коллекции.'
                : error instanceof Error ? error.message : 'Не удалось добавить релиз в коллекцию.');
        } finally {
            setCollectionActionId(null);
        }
    };

    const openReleaseNotifications = async () => {
        if (!userToken) {
            alert(t('release.loginToChangeStatus'));
            return;
        }

        setIsReleaseNotificationsOpen(true);
        setNotificationSettingsError(null);
        setIsNotificationSettingsLoading(true);
        try {
            const [preferences, types] = await Promise.all([
                api.get<{ code: number; profile_release_type_notification_preferences: Dub[] }>(`/profile/preference/notification/release/type/${animeData.id}`),
                api.get<{ code: number; types: Dub[] }>('/type/all'),
            ]);
            const allTypes = types.types ?? [];
            const selectedIds = (preferences.profile_release_type_notification_preferences ?? []).map(dub => dub.id);
            const allTypeIds = new Set(allTypes.map(dub => dub.id));
            const hasEveryDub = allTypeIds.size > 0 && selectedIds.length === allTypeIds.size && selectedIds.every(id => allTypeIds.has(id));

            setNotificationDubs(allTypes);
            setSelectedNotificationDubIds(selectedIds);
            setReleaseNotificationMode(selectedIds.length === 0 ? 'none' : hasEveryDub ? 'all_dubs' : 'selected_dubs');
        } catch (error) {
            setNotificationSettingsError(error instanceof Error ? error.message : 'Не удалось загрузить настройки уведомлений.');
        } finally {
            setIsNotificationSettingsLoading(false);
        }
    };

    const saveReleaseNotifications = async () => {
        if (isNotificationSettingsSaving) return;

        const profile_release_type_notification_preferences = releaseNotificationMode === 'none'
            ? []
            : releaseNotificationMode === 'all_dubs'
                ? notificationDubs.map(dub => dub.id)
                : selectedNotificationDubIds;

        setIsNotificationSettingsSaving(true);
        setNotificationSettingsError(null);
        try {
            await api.post<{ code: number }>('/profile/preference/notification/release/type/edit', {
                profile_release_type_notification_preferences,
                release_id: animeData.id,
            });
            setIsReleaseNotificationsOpen(false);
        } catch (error) {
            setNotificationSettingsError(error instanceof Error ? error.message : 'Не удалось сохранить настройки уведомлений.');
        } finally {
            setIsNotificationSettingsSaving(false);
        }
    };

    const rateRelease = async (grade: number) => {
        if (isReleaseVoteLoading) return;
        if (!userToken) {
            alert(t('release.loginToChangeStatus'));
            return;
        }

        const ratedReleaseId = animeData.id;
        const previousVote = selectedReleaseVote ?? animeData.your_vote ?? animeData.my_vote ?? 0;
        if (grade === previousVote) return;

        setSelectedReleaseVote(grade);
        setIsReleaseVoteLoading(true);
        setReleaseVoteError(null);
        let removedPreviousVote = false;
        try {
            if (previousVote >= 1 && previousVote <= 5) {
                await api.get<{ code: number }>(`/release/vote/delete/${ratedReleaseId}`, { cache: 'no-store' });
                removedPreviousVote = true;
            }
            await api.get<{ code: number }>(`/release/vote/add/${ratedReleaseId}/${grade}`, { cache: 'no-store' });
            setAnimeData(previous => {
                if (previous.id !== ratedReleaseId) return previous;
                const oldGrade = previous.your_vote ?? previous.my_vote ?? 0;
                const counts = [0, previous.vote_1_count, previous.vote_2_count, previous.vote_3_count, previous.vote_4_count, previous.vote_5_count];
                if (oldGrade >= 1 && oldGrade <= 5) counts[oldGrade] = Math.max(0, counts[oldGrade] - 1);
                counts[grade] += 1;
                const voteCount = counts.slice(1).reduce((sum, count) => sum + count, 0);
                const total = counts.slice(1).reduce((sum, count, index) => sum + count * (index + 1), 0);

                return {
                    ...previous,
                    my_vote: grade,
                    your_vote: grade,
                    vote_count: voteCount,
                    grade: voteCount ? total / voteCount : 0,
                    vote_1_count: counts[1],
                    vote_2_count: counts[2],
                    vote_3_count: counts[3],
                    vote_4_count: counts[4],
                    vote_5_count: counts[5],
                };
            });
        } catch (error) {
            let wasRestored = !removedPreviousVote;
            if (removedPreviousVote && previousVote >= 1 && previousVote <= 5) {
                try {
                    await api.get<{ code: number }>(`/release/vote/add/${ratedReleaseId}/${previousVote}`, { cache: 'no-store' });
                    wasRestored = true;
                } catch (restoreError) {
                    console.error('Не удалось восстановить предыдущую оценку релиза:', restoreError);
                }
            }
            setSelectedReleaseVote(previousVote);
            setReleaseVoteError(wasRestored
                ? 'Не удалось изменить оценку. Предыдущая оценка сохранена.'
                : 'Не удалось изменить и восстановить оценку. Данные будут загружены заново.');
            if (!wasRestored) setReleaseLoadAttempt(attempt => attempt + 1);
            console.error('Не удалось поставить оценку релизу:', error);
        } finally {
            setIsReleaseVoteLoading(false);
        }
    };

    const startReply = (comment: CommentType) => {
        setReplyTarget(comment);
        setEditTarget(null);
        setCommentText(`${comment.profile.login}, `);
        setCommentError(null);
        openCommentEditor();
    };

    const startEdit = (comment: CommentType) => {
        setEditTarget(comment);
        setReplyTarget(null);
        setCommentText(comment.message);
        setCommentSpoiler(comment.is_spoiler);
        setCommentError(null);
        openCommentEditor();
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
                await api.post<{code?:number}>(`/release/comment/edit/${editTarget.id}`, {message, spoiler: commentSpoiler});
                setEditedComment({ commentId: editTarget.id, message, spoiler: commentSpoiler });
            } else {
                const result = await api.postViaAgent<{code: number, comment: CommentType | null}>
                    (`/release/comment/add/${animeData.id}`, {
                    message,
                    spoiler: commentSpoiler,
                    parentCommentId: replyTarget?.id ?? null, 
                    replyToProfileId: replyTarget?.profile.id ?? null
                })

                if (!result.comment) throw new Error('Server hasnt returned created comment')

                const createdComment = result.comment;
                if (createdComment) {
                    setUserId(createdComment.profile.id);
                    if (replyTarget) {
                        setNewReply({ parentCommentId: replyTarget.id, comment: createdComment });
                    } else {
                        setAnimeData((previous) => ({
                            ...previous,
                            comments: [createdComment, ...previous.comments],
                        }));
                    }
                }
            }
            setCommentText('');
            setCommentSpoiler(false);
            setReplyTarget(null);
            setEditTarget(null);
            reloadComments();
        } catch (error) {
            setCommentError(error instanceof Error ? error.message : t('release.loadError'));
        } finally {
            setIsSendingComment(false);
        }
    };

    useEffect(() => {
        const controller = new AbortController();
        let isCurrent = true;
        api.get<{code: number, release: Anime}>(`/release/${id}`, { signal: controller.signal })
            .then(data => {
                if (!isCurrent) return;
                const release = data.release;
                setAnimeData(release);
                setSelectedReleaseVote(release.your_vote ?? release.my_vote ?? 0);
                setScreenshots(release.screenshot_images);
                setActiveScreenshotIndex(0);
                setReleaseLoadError(current => current?.key === releaseAttemptKey ? null : current);
            })
            .catch(error => {
                if (!isCurrent || controller.signal.aborted) return;
                console.error('Не удалось загрузить релиз:', error);
                setReleaseLoadError({ key: releaseAttemptKey, message: t('release.loadError') });
            })
            .finally(() => {
                if (isCurrent) setLoadedRequestKey(releaseAttemptKey);
            });

        return () => {
            isCurrent = false;
            controller.abort();
        };
    }, [api, id, releaseAttemptKey, t]);

    if (isReleaseLoading) {
        return <div className={styles['loading-overlay']} aria-label={t('misc.loading')} />;
    }

    if (releaseLoadError?.key === releaseAttemptKey) {
        return <div className={styles.body}><PageState status="error" message={releaseLoadError.message} onRetry={() => setReleaseLoadAttempt(attempt => attempt + 1)} /></div>;
    }

    if (!animeData) {
        return <div className={styles['body']}>{t('release.loadError')}</div>;
    }

    const isReleaseNotStarted = !animeData.episodes_released;
    const currentVote = selectedReleaseVote ?? animeData.your_vote ?? animeData.my_vote ?? 0;
    const comingSoonText = getComingSoonText(animeData, settings.appearance.language, t('release.soon'));
    const visibleScreenshots = screenshots.length > 1
        ? [screenshots[activeScreenshotIndex], screenshots[(activeScreenshotIndex + 1) % screenshots.length]]
        : screenshots;

    return(
        <div className={styles['body']}>
            <div className={styles['side-panel']}>
                <div className={`${styles['poster-wrapper']} ${loadedPoster === animeData.image ? styles['media-loaded'] : styles['media-loading']}`}>
                    <RemoteImage
                        src={animeData.image}
                        className={styles.poster}
                        onLoad={() => setLoadedPoster(animeData.image)}
                        onError={() => setLoadedPoster(animeData.image)}
                    />
                </div>
                <div className={`${styles['action-panel']}`}>
                    <select id="watchlist-select" className={`${styles['list-select']} ${styles['action-btn']} ${styles[`status-${animeData?.profile_list_status ?? 0}`]}`} onChange={e => {
                            const newStatus = +e.target.value
                            if (!userToken){
                                alert(t('release.loginToChangeStatus'))
                                return
                            }
                            setAnimeData((prev: Anime) => ({
                                ...prev,
                                profile_list_status: newStatus
                            }));
                            api.get<{code: number}>(`/profile/list/add/${newStatus}/${animeData.id}`)
                                .catch(err => console.error(err));
                        }} 
                        value={animeData?.profile_list_status ?? 0}>
                        <option value={0}>{t('release.notWatching')}</option>
                        <option value={1}>{t('status.watching')}</option>
                        <option value={2}>{t('status.planned')}</option>
                        <option value={3}>{t('status.watched')}</option>
                        <option value={4}>{t('status.hold_on')}</option>
                        <option value={5}>{t('status.dropped')}</option>
                    </select>
                    <button className={`${styles['favorite-btn']} ${styles['action-btn']} ${animeData.is_favorite ? styles['favorited'] : ''}`}
                            onClick={async () => {
                                if (!userToken) {
                                    alert(t('release.loginToFavorite'));
                                    return;
                                }
                                try {
                                    await api.get<{code: number}>(animeData.is_favorite ? `/favorite/delete/${animeData.id}` : `/favorite/add/${animeData.id}`)
                                    
                                    setAnimeData(previous => ({
                                        ...previous,
                                        is_favorite: !previous.is_favorite,
                                        favorites_count: previous.is_favorite
                                            ? previous.favorites_count - 1
                                            : previous.favorites_count + 1,
                                    }));
                                } catch (err) {
                                    console.error(err);
                                }
                            }}
                    ><img src={favoriteIcon} className={`${styles['icon-smaller']} ${animeData.is_favorite ? styles['favorited'] : ''}`}></img>{animeData?.favorites_count || 0}</button>
                    <div className={styles['release-quick-actions']}>
                        <button
                            type="button"
                            className={styles['release-quick-action']}
                            aria-label="Добавить в коллекцию"
                            title="Добавить в коллекцию"
                            onClick={() => void openCollectionPicker()}
                        ><img src={folderPlusIcon} alt="" /></button>
                        <button
                            type="button"
                            className={styles['release-quick-action']}
                            aria-label="Настроить уведомления"
                            title="Настроить уведомления"
                            onClick={() => void openReleaseNotifications()}
                        ><img src={bellIcon} alt="" /></button>
                    </div>
                </div>
                <div className={styles['watch-actions']}>
                    {isReleaseNotStarted ? (
                        <button type="button" disabled className={`${styles['watch-btn']} ${styles['watch-btn-soon']}`}>{comingSoonText}</button>
                    ) : (
                        <button onClick={() => setIsDubScreenOpen(true)} className={styles['watch-btn']}>{t('release.play')}</button>
                    )}
                </div>
                <div className={`${styles['grade-container']}`}>
                    <div className={styles['grade']}>
                        <p>{t('release.rating')}</p>
                        <h1>{(animeData.grade ?? 0).toFixed(2)}</h1>
                        <p>{animeData.vote_count ?? 0} {plural(animeData.vote_count ?? 0, t('release.votes1'), t('release.votes2'), t('release.votes5'))}</p>
                    </div>
                    <div className={styles['grade-bars']}>
                    {[5,4,3,2,1].map(grade => {
                        const voteCount = animeData[`vote_${grade}_count` as keyof Anime] || 0
                        return (
                            <div key={grade} style={{display:"flex", flexDirection:"row", alignItems: "center", gap: "5px"}}>
                                <p style={{margin: 0, minWidth: "12px"}}>{grade}</p>
                                <progress value={+voteCount} max={animeData.vote_count || 1}></progress>
                            </div>
                        )
                    })}
                    </div>
                </div>
                <div className={styles['release-rating-control']} aria-label="Ваша оценка">
                    <div>
                        {[1, 2, 3, 4, 5].map(value => <button
                            type="button"
                            key={value}
                            disabled={isReleaseVoteLoading}
                            className={value <= currentVote ? styles['release-rating-selected'] : ''}
                            onClick={() => void rateRelease(value)}
                            aria-label={`Оценить на ${value}`}
                            title={`${value} из 5`}
                                >{value <= currentVote
                                    ? <svg className={styles['release-rating-filled']} viewBox="0 0 24 24" aria-hidden="true"><path d="m12 2.8 2.86 5.8 6.4.93-4.63 4.51 1.09 6.37L12 17.4l-5.72 3.01 1.09-6.37L2.74 9.53l6.4-.93L12 2.8Z" /></svg>
                                    : <svg className={styles['release-rating-outline']} viewBox="0 0 24 24" aria-hidden="true"><path d="m12 2.8 2.86 5.8 6.4.93-4.63 4.51 1.09 6.37L12 17.4l-5.72 3.01 1.09-6.37L2.74 9.53l6.4-.93L12 2.8Z" /></svg>
                                }</button>)}
                    </div>
                </div>
                {releaseVoteError && <p className={styles['collection-picker-error']} role="alert">{releaseVoteError}</p>}
                <div className={styles['watchlist-info']}>
                    <WatchlistLine
                        watching_count={animeData.watching_count}
                        plan_count={animeData.plan_count}
                        completed_count={animeData.completed_count}
                        hold_on_count={animeData.hold_on_count}
                        dropped_count={animeData.dropped_count}
                    />
                </div>
                
            </div>
            <div className={styles['release-info']}>
                <div>
                    <div className={styles['release-base-info']}>
                        <h2>{animeData.title_ru}</h2>
                        <div style={{display: "flex", flexDirection: "row", gap: "10px", alignItems: "center"}}>
                            <p>{animeData.title_original}</p>
                            <a className={styles['age-rating']}>{
                                    ({
                                        1: "0+",
                                        2: "6+",
                                        3: "12+",
                                        4: "16+",
                                        5: "18+"
                                    } as Record<number, string>)[animeData.age_rating] || ""
                                }</a>
                        </div>
                        {animeData.note && <div style={{display:"flex", flexDirection:"row"}}>
                            <a className={styles['note']}>{animeData.note.replace(/<br\s*\/?>/gi, '\n')}</a>
                            </div>}
                        <p>{animeData.description}</p>
                    </div>
                    <div className={`${styles['release-details']} ${screenshots.length === 0 ? styles['release-details-no-screenshots'] : ''}`}>
                        <div className={styles['release-media']}>
                            {screenshots.length > 0 && (
                                <div className={styles['screenshot-gallery']} aria-label="Галерея кадров">
                                    <div className={styles['screenshot-track']}>
                                        {visibleScreenshots.map((url, offset) => {
                                            const index = (activeScreenshotIndex + offset) % screenshots.length;

                                            return <div key={url} className={`${styles['screenshot-wrapper']} ${loadedScreenshots[url] ? styles['media-loaded'] : styles['media-loading']}`}>
                                                <RemoteImage
                                                    src={url}
                                                    alt={`Скриншот ${index + 1}`}
                                                    className={styles['screenshot-img']}
                                                    onLoad={() => setLoadedScreenshots(previous => ({ ...previous, [url]: true }))}
                                                    onError={() => setLoadedScreenshots(previous => ({ ...previous, [url]: true }))}
                                                />
                                            </div>;
                                        })}
                                    </div>
                                    {screenshots.length > 1 && <>
                                        <button type="button" className={`${styles['screenshot-arrow']} ${styles['screenshot-arrow-prev']}`} aria-label="Предыдущий кадр" onClick={() => setActiveScreenshotIndex(index => (index - 1 + screenshots.length) % screenshots.length)}><img src={leftArrowIcon} alt="" /></button>
                                        <button type="button" className={`${styles['screenshot-arrow']} ${styles['screenshot-arrow-next']}`} aria-label="Следующий кадр" onClick={() => setActiveScreenshotIndex(index => (index + 1) % screenshots.length)}><img src={rightArrowIcon} alt="" /></button>
                                        <div className={styles['screenshot-pagination']}>
                                            {screenshots.map((url, index) => <button key={url} type="button" className={`${styles['screenshot-dot']} ${index === activeScreenshotIndex ? styles['screenshot-dot-active'] : ''}`} aria-label={`Показать кадр ${index + 1}`} onClick={() => setActiveScreenshotIndex(index)} />)}
                                        </div>
                                    </>}
                                </div>
                            )}
                            <div>
                                {animeData.related_releases.length !== 0 && <h3 style={{marginTop: '0px'}}>{t('release.relatedReleases')}</h3>}
                                {animeData.related_releases && animeData.related_releases.map((anime:Anime) =>(
                                        <ReleaseCard key={anime.id} variant="related" anime={anime}/>
                                    ))}
                            </div>
                        </div>
                            <aside className={styles['release-facts']}>
                                <div className={styles['fact-row']}>{({
                                    "Япония": <div className={styles["japan-flag"]}></div>,
                                    "Китай": <div className={styles["china-flag"]}></div>
                                } as Record<string, React.ReactNode>)[animeData.country]
                                }
                                <p>{animeData.country}, {(["зима","весна","лето","осень"])[animeData.season]} {animeData.year} г.</p>
                                </div>
                                <div className={styles['fact-row']}>
                                    <img src={albumIcon} className={styles['icon']} />
                                    <p>{animeData.episodes_released} {t('misc.outOf')} {animeData.episodes_total || "?"} {t('misc.episodes')}{animeData.duration ? `, ~${animeData.duration} ${t('misc.min')}` : ""}</p>
                                </div>
                                <div className={styles['fact-row']}>
                                    <img src={calendarIcon} className={styles['icon']} />
                                    <p>{animeData.category.name}, {animeData.status.name.toLocaleLowerCase()}</p>
                                </div>
                                <div className={styles['fact-row']}> 
                                    <img src={peopleIcon} className={styles['icon']} />
                                    <p>{t('misc.studio')} {animeData.studio}{animeData.author ? `, ${t('misc.author')} ${animeData.author}`:""}{animeData.director ? `, ${t('misc.director')} ${animeData.director}`:""}</p>
                                </div>
                                <div className={styles['fact-row']}>
                                    <img src={tagsIcon} className={styles['icon']} />
                                    <p>{animeData.genres}</p>
                                </div>
                            </aside>
                    </div>

                    {animeData.recommended_releases?.length > 0 && <section className={styles['also-recommend']}>
                        <h3>{t('release.recommendedReleases')}</h3>
                        <div className={styles['recommend-grid']}>
                            {animeData.recommended_releases.map(item => (
                                <RecommendedRelease key={item.id} anime={item}/>
                            ))}
                        </div>
                    </section>}
                    <section className={styles['comments-section']}>
                        <div className={styles['comments-heading']}>
                            <h3>{t('release.commentSection')}</h3>
                            <button type="button" className={styles['comments-open-btn']} onClick={() => setIsCommentsOpen(true)}>
                                <img src={commentsIcon} alt="" />
                                {animeData.comments_count || animeData.comment_count || 0}
                            </button>
                        </div>
                        <button type="button" className={styles['comment-page-trigger']} onClick={openCommentEditor}>
                            {t('comments.writePlaceholder')}
                        </button>
                        {isCommentsLoading && <p className={styles['empty-comments']}>{t('misc.loading')}</p>}
                        {Boolean(commentsLoadError) && <p className={styles['comment-error']}>{t('release.loadError')}</p>}
                        {!isCommentsLoading && !commentsLoadError && releaseComments.length === 0 && <p className={styles['empty-comments']}>{t('release.noComments')}</p>}
                        {!isCommentsLoading && <div className={styles['comments-page-list']}>
                            {releaseComments.map((comment: CommentType) => (
                                <Comment
                                    key={comment.id}
                                    comment={comment}
                                    releaseId={animeData.id}
                                    onReply={startReply}
                                    onEdit={startEdit}
                                    newReply={newReply}
                                    editedComment={editedComment}
                                    onDelete={reloadComments}
                                />
                            ))}
                        </div>}
                    </section>
                    <Modal
                        isOpen={isCommentsOpen}
                        onClose={() => setIsCommentsOpen(false)}
                        title={t('release.commentSection')}
                        stickyHeader
                        contentClassName={styles['comments-modal']}
                        contentStyle={{ width: 'min(1180px, calc(100vw - 32px))', maxHeight: '80vh' }}
                    >
                        {isCommentsLoading && <p className={styles['empty-comments']}>{t('misc.loading')}</p>}
                        {Boolean(commentsLoadError) && <p className={styles['comment-error']}>{t('release.loadError')}</p>}
                        {!isCommentsLoading && !commentsLoadError && releaseComments.length === 0 && <p className={styles['empty-comments']}>{t('release.noComments')}</p>}
                        {!isCommentsLoading && releaseComments.map((comment: CommentType) => (
                            <Comment
                                key={comment.id}
                                comment={comment}
                                releaseId={animeData.id}
                                onReply={startReply}
                                onEdit={startEdit}
                                newReply={newReply}
                                editedComment={editedComment}
                                onDelete={reloadComments}
                            />
                        ))}
                        <form className={styles['comment-area']} onSubmit={(event) => {
                            event.preventDefault();
                            void sendComment();
                        }}>
                            {replyTarget && <div className={styles['reply-context']}>
                                <span>{t('comments.replyFor')}<strong>{replyTarget.profile.login}</strong></span>
                                <button type="button" onClick={() => setReplyTarget(null)} aria-label={t('release.cancelReply')}>×</button>
                            </div>}
                            {editTarget && <div className={styles['reply-context']}>
                                <span>{t('comments.editing')}</span>
                                <button type="button" onClick={() => setEditTarget(null)} aria-label={t('release.cancelEdit')}>×</button>
                            </div>}
                            <textarea
                                ref={commentInputRef}
                                placeholder={t('comments.writePlaceholder')}
                                value={commentText}
                                maxLength={1000}
                                onChange={(event) => {
                                    setCommentText(event.target.value);
                                    setCommentError(null);
                                }}
                            />
                            <div className={styles['comment-controls']}>
                                <label className={styles['spoiler-toggle']}>
                                    <input
                                        type="checkbox"
                                        checked={commentSpoiler}
                                        onChange={(event) => setCommentSpoiler(event.target.checked)}
                                    />
                                    <span>{t('comments.spoiler')}</span>
                                </label>
                                <span className={styles['comment-counter']}>{commentText.length}/1000</span>
                                <button
                                    type="submit"
                                    className={styles['send-btn']}
                                    disabled={isCommentTooShort || isSendingComment}
                                >
                                    <img src={sendIcon} alt="" />
                                    {isSendingComment ? t('comments.sending') : t('comments.send')}
                                </button>
                            </div>
                            {commentError && <p className={styles['comment-error']}>{commentError}</p>}
                        </form>
                    </Modal>
                </div>
            </div>
            <Modal
                isOpen={isCollectionPickerOpen}
                onClose={() => setIsCollectionPickerOpen(false)}
                title="Добавить в коллекцию"
                stickyHeader
                contentClassName={styles['collection-picker-modal']}
            >
                <p className={styles['collection-picker-caption']}>Выберите одну из своих коллекций.</p>
                {isCollectionsLoading && <p className={styles['collection-picker-state']}>{t('misc.loading')}</p>}
                {!isCollectionsLoading && collectionActionError && <p className={styles['collection-picker-error']} role="alert">{collectionActionError}</p>}
                {!isCollectionsLoading && !collectionActionError && myCollections.length === 0 && <p className={styles['collection-picker-state']}>У вас пока нет коллекций.</p>}
                {!isCollectionsLoading && myCollections.length > 0 && <div className={styles['collection-picker-list']}>
                    {myCollections.map(collection => <button
                        key={collection.id}
                        type="button"
                        disabled={collectionActionId !== null}
                        className={styles['collection-picker-item']}
                        onClick={() => void addReleaseToCollection(collection)}
                    >
                        <RemoteImage src={collection.image} alt="" />
                        <span><strong>{collection.title}</strong><small>{collection.description || 'Без описания'}</small></span>
                        {collectionActionId === collection.id && <em>Добавляем…</em>}
                    </button>)}
                </div>}
                {collectionActionNotice && <p className={styles['collection-picker-notice']} role="status">{collectionActionNotice}</p>}
            </Modal>
            <Modal
                isOpen={isReleaseNotificationsOpen}
                onClose={() => setIsReleaseNotificationsOpen(false)}
                title="Уведомления о релизе"
                contentClassName={styles['release-notifications-modal']}
            >
                <p className={styles['release-notifications-caption']}>Выберите, когда присылать уведомление о новой серии.</p>
                {isNotificationSettingsLoading && <p className={styles['collection-picker-state']}>{t('misc.loading')}</p>}
                {!isNotificationSettingsLoading && <div className={styles['release-notification-options']}>
                    <button type="button" className={releaseNotificationMode === 'none' ? styles['release-notification-active'] : ''} onClick={() => setReleaseNotificationMode('none')}>
                        <strong>Не получать</strong>
                        <span>Уведомления для этого релиза отключены</span>
                    </button>
                    <button type="button" className={releaseNotificationMode === 'all_dubs' ? styles['release-notification-active'] : ''} onClick={() => setReleaseNotificationMode('all_dubs')}>
                        <strong>От всех озвучек</strong>
                        <span>При выходе серии в любой озвучке</span>
                    </button>
                    <button type="button" className={releaseNotificationMode === 'selected_dubs' ? styles['release-notification-active'] : ''} onClick={() => setReleaseNotificationMode('selected_dubs')}>
                        <strong>От выбранных озвучек</strong>
                        <span>Вы сможете отметить нужные варианты озвучки</span>
                    </button>
                </div>}
                {!isNotificationSettingsLoading && releaseNotificationMode === 'selected_dubs' && <div className={styles['notification-dub-list']}>
                    {notificationDubs.map(dub => <label key={dub.id}>
                        <input
                            type="checkbox"
                            checked={selectedNotificationDubIds.includes(dub.id)}
                            onChange={() => setSelectedNotificationDubIds(previous => previous.includes(dub.id)
                                ? previous.filter(id => id !== dub.id)
                                : [...previous, dub.id])}
                        />
                        <span>{dub.name}</span>
                    </label>)}
                </div>}
                {notificationSettingsError && <p className={styles['collection-picker-error']} role="alert">{notificationSettingsError}</p>}
                <div className={styles['release-notifications-actions']}>
                    <button type="button" onClick={() => setIsReleaseNotificationsOpen(false)}>Отмена</button>
                    <button type="button" disabled={isNotificationSettingsLoading || isNotificationSettingsSaving} onClick={() => void saveReleaseNotifications()}>{isNotificationSettingsSaving ? 'Сохраняем…' : 'Сохранить'}</button>
                </div>
            </Modal>
            {(isDubScreenOpen || roomAutoSelect) && <DubSelectModal 
                isOpen={isDubScreenOpen || Boolean(roomAutoSelect)}
                autoSelect={roomAutoSelect}
                onClose={() => {
                    setIsDubScreenOpen(false);
                    if (roomAutoSelect) navigate(`/anime/${animeData.id}?room=${encodeURIComponent(roomId!)}`, { replace: true });
                }}
                releaseId={animeData?.id}
                onEpisodeSelect={(sources, episode, episodes, sourceId, dubId) => {
                    setIsDubScreenOpen(false)
                    setPlayerSession({
                        sources,
                        animeId: animeData.id,
                        animeName: settings.appearance.language === 'english' ? animeData.title_original : animeData.title_ru,
                        episodeNumber: episode.position,
                        episodeName: episode.name,
                        episodes,
                        dubId,
                        sourceId,
                    });
                    navigate(`/anime/${animeData.id}/watch${roomId ? `?room=${encodeURIComponent(roomId)}` : ''}`);
                }}
                token={userToken}
            />}
        </div>
    )
}

async function loadAllPages<T extends { id: number }>(loadPage: (page: number) => Promise<PagedResponse<T>>): Promise<T[]> {
    const firstPage = await loadPage(0);
    const lastPage = Math.max(0, firstPage.total_page_count ?? 0);
    const remainingPages = lastPage > 0
        ? await Promise.all(Array.from({ length: lastPage }, (_, index) => loadPage(index + 1)))
        : [];
    const items = [firstPage, ...remainingPages].flatMap(page => page.content ?? []);
    return [...new Map(items.map(item => [item.id, item])).values()];
}

async function loadAllPagesOrEmpty<T extends { id: number }>(loadPage: (page: number) => Promise<PagedResponse<T>>): Promise<T[]> {
    try {
        return await loadAllPages(loadPage);
    } catch (error) {
        if (error instanceof Error && error.message === 'API error: 1') return [];
        throw error;
    }
}

function getComingSoonText(release: Anime, language: 'russian' | 'english', fallback: string) {
    if (release.aired_on_date > 0) {
        return new Intl.DateTimeFormat(language === 'english' ? 'en-US' : 'ru-RU', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
        }).format(new Date(release.aired_on_date * 1000));
    }

    if (release.year) {
        const seasons = language === 'english'
            ? ['', 'Winter', 'Spring', 'Summer', 'Autumn']
            : ['', 'Зима', 'Весна', 'Лето', 'Осень'];
        const season = seasons[release.season] ?? '';
        return season ? `${season}, ${release.year}` : release.year;
    }
    return fallback;
}
