import RemoteMedia from '../components/RemoteMedia';
import { getReleaseTitle, localizeCategory, localizeReleaseStatus } from '../shared/releaseTitle';
import { useEffect, useRef, useState } from "react";
import { useParams, useLocation, useNavigate, Link } from "react-router-dom"
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
import CommentsModal from '../modals/CommentsModal';
import { useAsyncLoad } from '../shared/useAsyncLoad';
import { getReadableErrorMessage } from '../shared/errorUtils';

//Icons
import peopleIcon from "../assets/icons/users.svg"
import calendarIcon from "../assets/icons/calendar.svg"
import tagsIcon from "../assets/icons/tags.svg"
import albumIcon from "../assets/icons/album-collection.svg"
import favoriteIcon from '../assets/icons/bookmark.svg'
import leftArrowIcon from '../assets/icons/left-arrow.svg'
import rightArrowIcon from '../assets/icons/right-arrow.svg'
import commentsIcon from '../assets/icons/message-circle-dots.svg'
import folderPlusIcon from '../assets/icons/folder-plus.svg'
import bellIcon from '../assets/icons/bell.svg'

import { setPlayerSession } from '../shared/playerSession'
import { useRoomPresence } from '../shared/contexts/roomContext'
import RecommendedRelease from "../components/RecommendedRelease";
import { useApi } from "../shared/apiClient";
import type { PagedResponse } from '../shared/types/api';
import PageState from '../components/PageState';
import ImageLightbox, { type LightboxImage } from '../components/ImageLightbox';

export default function ReleaseScreen(){
    const {id} = useParams<{id: string}>();
    const {userToken, userId} = useUser();
    const {settings} = useSettings();
    const { t } = useTranslation();
    const navigate = useNavigate();
    const location = useLocation();
    const api = useApi();
    const roomParams = new URLSearchParams(location.search);
    const roomId = roomParams.get('room');
    const { send: sendRoom, room, status: roomStatus } = useRoomPresence();
    const [roomSelectionError, setRoomSelectionError] = useState<string | null>(null);
    const partialData = location.state?.partialAnime || null;

    const [animeData, setAnimeData] = useState<Anime>(partialData);
    const [screenshots, setScreenshots] = useState<string[]>([]);
    const [activeScreenshotIndex, setActiveScreenshotIndex] = useState(0);
    const [imageViewer, setImageViewer] = useState<{ releaseId: string | undefined; images: LightboxImage[]; index: number } | null>(null);
    const [loadedPoster, setLoadedPoster] = useState<string | null>(null);
    const [loadedScreenshots, setLoadedScreenshots] = useState<Record<string, boolean>>({});
    const [isDubScreenOpen, setIsDubScreenOpen] = useState(() => Boolean(location.state?.openEpisodePicker));
    const playRef = useRef<HTMLButtonElement>(null);
    const [entryNotice] = useState(() => Boolean(location.state?.openEpisodePicker));
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
    const [isCommentsOpen, setIsCommentsOpen] = useState(false);
    const [commentsInitialAction, setCommentsInitialAction] = useState<{ type: 'compose' } | { type: 'reply' | 'edit'; comment: CommentType } | null>(null);
    const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false);
    const [quickCommentText, setQuickCommentText] = useState('');
    const [quickCommentIsSpoiler, setQuickCommentIsSpoiler] = useState(false);
    const [isPostingQuickComment, setIsPostingQuickComment] = useState(false);
    const [quickCommentError, setQuickCommentError] = useState<string | null>(null);

    useEffect(() => {
        if (!location.state?.openEpisodePicker && !location.state?.focusPlay) return;
        if (!animeData) return;
        if (location.state?.focusPlay) window.requestAnimationFrame(() => playRef.current?.focus());
        navigate(location.pathname + location.search, { replace: true, state: { ...location.state, openEpisodePicker: false, focusPlay: false } });
    }, [animeData, location, navigate]);

    const releaseAttemptKey = `${requestKey}:${releaseLoadAttempt}`;
    const isReleaseLoading = loadedRequestKey !== releaseAttemptKey;
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
    const firstPageComments = commentsData?.content ?? [];

    const openCommentEditor = () => {
        setCommentsInitialAction({ type: 'compose' });
        setIsCommentsOpen(true);
    };

    const openCollectionPicker = async () => {
        if (!userToken || !userId) {
            setReleaseVoteError(t('release.loginToChangeStatus'));
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
            console.error('Failed to load collections:', error);
            setCollectionActionError(getReadableErrorMessage(error, t) || t('release.collectionsLoadError'));
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
            setCollectionActionNotice(t('release.collectionAdded', { title: collection.title }));
        } catch (error) {
            console.error('Failed to add release to collection:', error);
            setCollectionActionError(error instanceof Error && error.message === 'API error: 5'
                ? t('release.alreadyInCollection')
                : (getReadableErrorMessage(error, t) || t('release.collectionAddError')));
        } finally {
            setCollectionActionId(null);
        }
    };

    const openReleaseNotifications = async () => {
        if (!userToken) {
            setReleaseVoteError(t('release.loginToChangeStatus'));
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
            console.error('Failed to load release notification settings:', error);
            setNotificationSettingsError(t('release.notificationsLoadError'));
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
            console.error('Failed to save release notification settings:', error);
            setNotificationSettingsError(t('release.notificationsSaveError'));
        } finally {
            setIsNotificationSettingsSaving(false);
        }
    };

    const rateRelease = async (grade: number) => {
        if (isReleaseVoteLoading) return;
        if (!userToken) {
            setReleaseVoteError(t('release.loginToChangeStatus'));
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
                ? t('release.ratingChangeError')
                : t('release.ratingRestoreError'));
            if (!wasRestored) setReleaseLoadAttempt(attempt => attempt + 1);
            console.error('Не удалось поставить оценку релизу:', error);
        } finally {
            setIsReleaseVoteLoading(false);
        }
    };

    const startReply = (comment: CommentType) => {
        setCommentsInitialAction({ type: 'reply', comment });
        setIsCommentsOpen(true);
    };

    const handleStatusChange = (newStatus: number) => {
        if (!userToken) {
            setReleaseVoteError(t('release.loginToChangeStatus'));
            return;
        }
        setAnimeData((prev: Anime) => ({
            ...prev,
            profile_list_status: newStatus
        }));
        api.get<{ code: number }>(`/profile/list/add/${newStatus}/${animeData.id}`)
            .catch(err => console.error(err));
    };

    const handleToggleFavorite = async () => {
        if (!userToken) {
            setReleaseVoteError(t('release.loginToFavorite'));
            return;
        }
        try {
            await api.get<{ code: number }>(animeData.is_favorite ? `/favorite/delete/${animeData.id}` : `/favorite/add/${animeData.id}`);
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
    };

    const scrollToComments = () => {
        const el = document.getElementById('mobile-comments-section');
        if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } else {
            setIsCommentsOpen(true);
        }
    };

    const handleQuickCommentSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const text = quickCommentText.trim();
        if (!text || text.length < 5 || isPostingQuickComment) return;
        if (!userToken) {
            setReleaseVoteError(t('release.loginToChangeStatus'));
            return;
        }
        setIsPostingQuickComment(true);
        setQuickCommentError(null);
        try {
            await api.postViaAgent(`/release/comment/add/${animeData.id}`, {
                message: text,
                spoiler: quickCommentIsSpoiler,
            });
            setQuickCommentText('');
            setQuickCommentIsSpoiler(false);
            reloadComments();
        } catch (err) {
            console.error('Failed to post quick comment:', err);
            setQuickCommentError(err instanceof Error ? err.message : String(err));
        } finally {
            setIsPostingQuickComment(false);
        }
    };

    const startEdit = (comment: CommentType) => {
        setCommentsInitialAction({ type: 'edit', comment });
        setIsCommentsOpen(true);
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
                setReleaseLoadError({ key: releaseAttemptKey, message: getReadableErrorMessage(error, t) || t('release.loadError') });
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
        return <div className={styles['loading-overlay']} role="status" aria-live="polite" aria-busy="true"><span>{t('misc.loading')}</span></div>;
    }

    if (releaseLoadError?.key === releaseAttemptKey) {
        return <div className={styles.body}><PageState status="error" message={releaseLoadError.message} onRetry={() => setReleaseLoadAttempt(attempt => attempt + 1)} /></div>;
    }

    if (!animeData) {
        return <div className={styles['body']}>{t('release.loadError')}</div>;
    }

    const displayTitle = getReleaseTitle(animeData, settings.appearance.language);
    const isReleaseNotStarted = !animeData.episodes_released;
    const currentVote = selectedReleaseVote ?? animeData.your_vote ?? animeData.my_vote ?? 0;
    const comingSoonText = getComingSoonText(animeData, settings.appearance.language, t('release.soon'));
    const visibleScreenshots = screenshots.length > 1
        ? [screenshots[activeScreenshotIndex], screenshots[(activeScreenshotIndex + 1) % screenshots.length]]
        : screenshots;

    const flagNode = ({
        "Япония": <div className={styles["japan-flag"]}></div>,
        "Китай": <div className={styles["china-flag"]}></div>
    } as Record<string, React.ReactNode>)[animeData?.country ?? ''];

    const localizedCountry = ({
        'Япония': t('country.japan'),
        'Китай': t('country.china'),
        'Южная Корея': t('country.southKorea')
    } as Record<string, string>)[animeData?.country ?? ''] ?? animeData?.country ?? '';

    const seasonYearText = (() => {
        if (!animeData) return '';
        const s = [t('seasons.winter'), t('seasons.spring'), t('seasons.summer'), t('seasons.autumn')][animeData.season - 1];
        const cap = s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
        return cap ? `${cap} ${animeData.year}` : `${animeData.year}`;
    })();

    const genresList: string[] = (animeData?.genres || '')
        .split(',')
        .map((g: string) => g.trim())
        .filter(Boolean);

    const renderDesktopHeader = () => (
        <div className={styles['release-header']}>
            <h1>{displayTitle}</h1>
            <div className={styles['release-title-row']}>
                <p>{settings.appearance.language === 'english' ? animeData.title_ru : animeData.title_original}</p>
                <span className={styles['age-rating']}>{
                    ({
                        1: "0+",
                        2: "6+",
                        3: "12+",
                        4: "16+",
                        5: "18+"
                    } as Record<number, string>)[animeData.age_rating] || ""
                }</span>
            </div>
        </div>
    );

    return(
        <div className={styles['body']}>
            {/* Desktop Layout (2 columns, visible on screens > 768px) */}
            <div className={styles['desktop-layout']}>
                <div className={styles['side-panel']}>
                    <div className={styles['poster-wrapper']}>
                        <RemoteMedia src={animeData.image} alt={displayTitle} interactiveRetry onStateChange={state => setLoadedPoster(state === 'loaded' ? animeData.image : null)} />
                        {loadedPoster === animeData.image && <button type="button" className={styles.imageOpenOverlay} aria-label={t('imageViewer.open')} onClick={() => setImageViewer({ releaseId: id, images: [{ src: animeData.image, alt: displayTitle }], index: 0 })} />}
                    </div>
                    <div className={styles['action-panel']}>
                        <select id="watchlist-select" className={`${styles['list-select']} ${styles['action-btn']} ${styles[`status-${animeData?.profile_list_status ?? 0}`]}`} onChange={e => handleStatusChange(+e.target.value)} value={animeData?.profile_list_status ?? 0}>
                            <option value={0}>{t('release.notWatching')}</option>
                            <option value={1}>{t('status.watching')}</option>
                            <option value={2}>{t('status.planned')}</option>
                            <option value={3}>{t('status.watched')}</option>
                            <option value={4}>{t('status.hold_on')}</option>
                            <option value={5}>{t('status.dropped')}</option>
                        </select>
                        <button className={`${styles['favorite-btn']} ${styles['action-btn']} ${animeData.is_favorite ? styles['favorited'] : ''}`} onClick={handleToggleFavorite}>
                            <img src={favoriteIcon} className={`${styles['icon-smaller']} ${animeData.is_favorite ? styles['favorited'] : ''}`} alt="" />
                            {animeData?.favorites_count || 0}
                        </button>
                        <div className={styles['release-quick-actions']}>
                            <button
                                type="button"
                                className={styles['release-quick-action']}
                                aria-label={t('release.addCollection')}
                                title={t('release.addCollection')}
                                onClick={() => void openCollectionPicker()}
                            ><img src={folderPlusIcon} alt="" /></button>
                            <button
                                type="button"
                                className={styles['release-quick-action']}
                                aria-label={t('release.configureNotifications')}
                                title={t('release.configureNotifications')}
                                onClick={() => void openReleaseNotifications()}
                            ><img src={bellIcon} alt="" /></button>
                        </div>
                    </div>
                    <div className={styles['watch-actions']}>
                        {isReleaseNotStarted ? (
                            <button type="button" disabled className={`${styles['watch-btn']} ${styles['watch-btn-soon']}`}>{comingSoonText}</button>
                        ) : (
                            <button onClick={() => setIsDubScreenOpen(true)} ref={playRef} className={styles['watch-btn']}>{t('release.play')}</button>
                        )}
                    </div>
                    <div className={styles['ratings-panel']}>
                        <div className={styles['grade-container']}>
                            <div className={styles['grade']}>
                                <p>{t('release.rating')}</p>
                                <h1>{(animeData.grade ?? 0).toFixed(2)}</h1>
                                <p>{animeData.vote_count ?? 0} {plural(animeData.vote_count ?? 0, t('release.votes1'), t('release.votes2'), t('release.votes5'))}</p>
                            </div>
                            <div className={styles['grade-bars']}>
                                {[5,4,3,2,1].map(grade => {
                                    const voteCount = animeData[`vote_${grade}_count` as keyof Anime] || 0;
                                    return (
                                        <div key={grade} style={{display:"flex", flexDirection:"row", alignItems: "center", gap: "5px"}}>
                                            <p style={{margin: 0, minWidth: "12px"}}>{grade}</p>
                                            <progress value={+voteCount} max={animeData.vote_count || 1}></progress>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                        <div className={styles['release-rating-control']} aria-label={t('release.yourRating')}>
                            <div>
                                {[1, 2, 3, 4, 5].map(value => <button
                                    type="button"
                                    key={value}
                                    disabled={isReleaseVoteLoading}
                                    className={value <= currentVote ? styles['release-rating-selected'] : ''}
                                    onClick={() => void rateRelease(value)}
                                    aria-label={t('release.rateValue', { value })}
                                    title={t('release.ratingOutOfFive', { value })}
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
                </div>

                <div className={styles['release-info']}>
                    {renderDesktopHeader()}
                    <div className={styles['release-summary']}>
                        {animeData.note && <div style={{display:"flex", flexDirection:"row"}}>
                            <div className={styles['note']}>{animeData.note.replace(/<br\s*\/?>/gi, '\n')}</div>
                        </div>}
                        <p>{animeData.description?.trim() || t('release.noDescription')}</p>
                    </div>
                    <div className={`${styles['release-details']} ${screenshots.length === 0 ? styles['release-details-no-screenshots'] : ''}`}>
                        <div className={styles['release-media']}>
                            {screenshots.length > 0 && (
                                <div className={styles['screenshot-gallery']} aria-label={t('release.gallery')}>
                                    <div className={styles['screenshot-track']}>
                                        {visibleScreenshots.map((url, offset) => {
                                            const index = (activeScreenshotIndex + offset) % screenshots.length;

                                            return <div key={url} className={styles['screenshot-wrapper']}>
                                                <RemoteMedia src={url} alt={t('release.screenshotAlt', { number: index + 1 })} interactiveRetry onStateChange={state => setLoadedScreenshots(previous => ({ ...previous, [url]: state === 'loaded' }))} />
                                                {loadedScreenshots[url] && <button type="button" className={styles.imageOpenOverlay} aria-label={t('release.screenshotAlt', { number: index + 1 })} onClick={() => setImageViewer({ releaseId: id, images: screenshots.map((src, imageIndex) => ({ src, alt: t('release.screenshotAlt', { number: imageIndex + 1 }) })), index })} />}
                                            </div>;
                                        })}
                                    </div>
                                    {screenshots.length > 1 && <>
                                        <button type="button" className={`${styles['screenshot-arrow']} ${styles['screenshot-arrow-prev']}`} aria-label={t('release.previousScreenshot')} onClick={() => setActiveScreenshotIndex(index => (index - 1 + screenshots.length) % screenshots.length)}><img src={leftArrowIcon} alt="" /></button>
                                        <button type="button" className={`${styles['screenshot-arrow']} ${styles['screenshot-arrow-next']}`} aria-label={t('release.nextScreenshot')} onClick={() => setActiveScreenshotIndex(index => (index + 1) % screenshots.length)}><img src={rightArrowIcon} alt="" /></button>
                                        <div className={styles['screenshot-pagination']}>
                                            {screenshots.map((url, index) => <button key={url} type="button" className={`${styles['screenshot-dot']} ${index === activeScreenshotIndex ? styles['screenshot-dot-active'] : ''}`} aria-label={t('release.showScreenshot', { number: index + 1 })} onClick={() => setActiveScreenshotIndex(index)} />)}
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
                            <div className={styles['fact-row']}>
                                {flagNode}
                                <p>{localizedCountry}, {seasonYearText}</p>
                            </div>
                            <div className={styles['fact-row']}>
                                <img src={albumIcon} className={styles['icon']} alt="" />
                                <p>{animeData.episodes_released} {t('misc.outOf')} {animeData.episodes_total || "?"} {t('misc.episodes')}{animeData.duration ? `, ~${animeData.duration} ${t('misc.min')}` : ""}</p>
                            </div>
                            <div className={styles['fact-row']}>
                                <img src={calendarIcon} className={styles['icon']} alt="" />
                                <p>{animeData.category.name ? localizeCategory(animeData.category.name, t) : ''}, {animeData.status.name ? localizeReleaseStatus(animeData.status.name, t).toLocaleLowerCase() : ''}</p>
                            </div>
                            <div className={styles['fact-row']}> 
                                <img src={peopleIcon} className={styles['icon']} alt="" />
                                <p>{t('ux.studio')}: {animeData.studio}{animeData.author ? `, ${t('ux.author')}: ${animeData.author}`:""}{animeData.director ? `, ${t('ux.director')}: ${animeData.director}`:""}</p>
                            </div>
                            <div className={styles['fact-row']}>
                                <img src={tagsIcon} className={styles['icon']} alt="" />
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
                        {Boolean(commentsLoadError) && <p className={styles['comment-error']}>{getReadableErrorMessage(commentsLoadError, t) || t('release.loadError')}</p>}
                        {!isCommentsLoading && !commentsLoadError && firstPageComments.length === 0 && <p className={styles['empty-comments']}>{t('release.noComments')}</p>}
                        {!isCommentsLoading && <div className={styles['comments-page-list']}>
                            {firstPageComments.map((comment: CommentType) => (
                                <Comment
                                    key={comment.id}
                                    comment={comment}
                                    releaseId={animeData.id}
                                    onReply={startReply}
                                    onEdit={startEdit}
                                    onDelete={reloadComments}
                                />
                            ))}
                        </div>}
                    </section>
                </div>
            </div>

            {/* Mobile Native App Layout (Matching user screenshots) */}
            <div className={styles['mobile-layout']}>
                {/* 1. Mobile top bar */}
                <div className={styles['mobile-top-bar']}>
                    <button
                        type="button"
                        className={styles['mobile-back-btn']}
                        onClick={() => navigate(-1)}
                        aria-label={t('page.back')}
                    >
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                            <path d="m15 18-6-6 6-6" />
                        </svg>
                    </button>
                    <div className={styles['mobile-top-actions']}>
                        <button
                            type="button"
                            className={styles['mobile-top-action-btn']}
                            onClick={() => void openReleaseNotifications()}
                            aria-label={t('release.configureNotifications')}
                            title={t('release.configureNotifications')}
                        >
                            <img src={bellIcon} alt="" />
                        </button>
                        <button
                            type="button"
                            className={styles['mobile-top-action-btn']}
                            onClick={() => void openCollectionPicker()}
                            aria-label={t('release.addCollection')}
                            title={t('release.addCollection')}
                        >
                            <img src={folderPlusIcon} alt="" />
                        </button>
                    </div>
                </div>

                {/* 2. Poster with ambient glow */}
                <div className={styles['mobile-poster-section']}>
                    <div
                        className={styles['poster-glow']}
                        style={{ backgroundImage: `url(${animeData.image})` }}
                        aria-hidden="true"
                    />
                    <div className={styles['poster-wrapper']}>
                        <RemoteMedia
                            src={animeData.image}
                            alt={displayTitle}
                            interactiveRetry
                            onStateChange={state => setLoadedPoster(state === 'loaded' ? animeData.image : null)}
                        />
                        {loadedPoster === animeData.image && (
                            <button
                                type="button"
                                className={styles.imageOpenOverlay}
                                aria-label={t('imageViewer.open')}
                                onClick={() => setImageViewer({ releaseId: id, images: [{ src: animeData.image, alt: displayTitle }], index: 0 })}
                            />
                        )}
                    </div>
                </div>

                {/* 3. Title & Age rating */}
                <div className={styles['mobile-title-section']}>
                    <div className={styles['mobile-title-row']}>
                        <span className={styles['mobile-info-icon']} aria-hidden="true">ⓘ</span>
                        <h1 className={styles['mobile-release-title']}>{displayTitle}</h1>
                    </div>
                    <div className={styles['mobile-subtitle-row']}>
                        <span className={styles['mobile-sub-title']}>
                            {settings.appearance.language === 'english' ? animeData.title_ru : animeData.title_original}
                        </span>
                        {animeData.age_rating ? (
                            <span className={styles['age-rating']}>
                                {({
                                    1: "0+",
                                    2: "6+",
                                    3: "12+",
                                    4: "16+",
                                    5: "18+"
                                } as Record<number, string>)[animeData.age_rating] || ""}
                            </span>
                        ) : null}
                    </div>
                </div>

                {/* 4. Action buttons (Watchlist, Favorites, Comments) */}
                <div className={styles['mobile-action-bar']}>
                    <div className={styles['mobile-select-wrapper']}>
                        <select
                            id="mobile-watchlist-select"
                            className={`${styles['mobile-action-pill']} ${styles[`status-${animeData?.profile_list_status ?? 0}`]}`}
                            value={animeData?.profile_list_status ?? 0}
                            onChange={e => handleStatusChange(+e.target.value)}
                        >
                            <option value={0}>{t('release.notWatching')}</option>
                            <option value={1}>{t('status.watching')}</option>
                            <option value={2}>{t('status.planned')}</option>
                            <option value={3}>{t('status.watched')}</option>
                            <option value={4}>{t('status.hold_on')}</option>
                            <option value={5}>{t('status.dropped')}</option>
                        </select>
                        <span className={styles['mobile-select-arrow']} aria-hidden="true">▾</span>
                    </div>

                    <button
                        type="button"
                        className={`${styles['mobile-action-pill']} ${styles['mobile-favorite-btn']} ${animeData.is_favorite ? styles.favorited : ''}`}
                        onClick={handleToggleFavorite}
                        aria-label={t('release.addToFavorites')}
                    >
                        <span>{formatCompactNumber(animeData?.favorites_count || 0)}</span>
                        <img src={favoriteIcon} className={`${styles['icon-smaller']} ${animeData.is_favorite ? styles.favorited : ''}`} alt="" />
                    </button>

                    <button
                        type="button"
                        className={`${styles['mobile-action-pill']} ${styles['mobile-comments-btn']}`}
                        onClick={scrollToComments}
                        aria-label={t('release.commentSection')}
                    >
                        <img src={commentsIcon} className={styles['icon-smaller']} alt="" />
                        <span>{formatCompactNumber(animeData?.comments_count || animeData?.comment_count || 0)}</span>
                    </button>
                </div>

                {/* 5. Primary Play Button */}
                <div className={styles['mobile-play-section']}>
                    <div className={styles['mobile-play-row']}>
                        <button
                            type="button"
                            className={styles['mobile-main-play-btn']}
                            disabled={isReleaseNotStarted}
                            onClick={() => setIsDubScreenOpen(true)}
                        >
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                                <polygon points="6 3 20 12 6 21 6 3" />
                            </svg>
                            <span>{isReleaseNotStarted ? comingSoonText : t('release.play')}</span>
                        </button>
                        <button
                            type="button"
                            className={styles['mobile-play-options-btn']}
                            onClick={() => setIsDubScreenOpen(true)}
                            aria-label={t('release.selectDubAndEpisode')}
                            title={t('release.selectDubAndEpisode')}
                        >
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                                <circle cx="12" cy="5" r="2" />
                                <circle cx="12" cy="12" r="2" />
                                <circle cx="12" cy="19" r="2" />
                            </svg>
                        </button>
                    </div>
                    <div className={styles['mobile-play-subtext']}>
                        {animeData.episodes_released
                            ? t('release.addedEpisode', { episodes: animeData.episodes_released })
                            : comingSoonText}
                    </div>
                </div>

                {/* 6. Meta / Facts List */}
                <div className={styles['mobile-facts-list']}>
                    <div className={styles['fact-row']}>
                        {flagNode}
                        <p>{localizedCountry}, {seasonYearText}</p>
                    </div>
                    <div className={styles['fact-row']}>
                        <img src={albumIcon} className={styles.icon} alt="" />
                        <p>{animeData.episodes_released} {t('misc.outOf')} {animeData.episodes_total || '?'} {t('misc.episodes')}{animeData.duration ? `, по ~${animeData.duration} ${t('misc.min')}` : ''}</p>
                    </div>
                    <div className={styles['fact-row']}>
                        <img src={calendarIcon} className={styles.icon} alt="" />
                        <p>{animeData.category.name ? localizeCategory(animeData.category.name, t) : ''}, {animeData.status.name ? localizeReleaseStatus(animeData.status.name, t).toLocaleLowerCase() : ''}</p>
                    </div>
                    <div className={styles['fact-row']}>
                        <img src={peopleIcon} className={styles.icon} alt="" />
                        <p>{t('ux.studio')}: {animeData.studio}{animeData.author ? `, ${t('ux.author')}: ${animeData.author}` : ''}{animeData.director ? `, ${t('ux.director')}: ${animeData.director}` : ''}</p>
                    </div>
                </div>

                {/* 7. Genres */}
                {genresList.length > 0 && (
                    <div className={styles['mobile-genres-row']}>
                        {genresList.map((genre, i) => (
                            <Link
                                key={genre}
                                to={`/overview?genre=${encodeURIComponent(genre)}`}
                                className={styles['mobile-genre-tag']}
                            >
                                {genre}{i < genresList.length - 1 ? ',' : ''}
                            </Link>
                        ))}
                    </div>
                )}

                {/* 8. Description */}
                <div className={styles['mobile-description-block']}>
                    {animeData.note && (
                        <div className={styles.note}>{animeData.note.replace(/<br\s*\/?>/gi, '\n')}</div>
                    )}
                    <p className={`${styles['mobile-description-text']} ${!isDescriptionExpanded ? styles['description-clamped'] : ''}`}>
                        {animeData.description?.trim() || t('release.noDescription')}
                    </p>
                    {animeData.description && animeData.description.length > 180 && (
                        <button
                            type="button"
                            className={styles['mobile-expand-btn']}
                            onClick={() => setIsDescriptionExpanded(v => !v)}
                        >
                            {isDescriptionExpanded ? t('release.collapse') : t('release.more')}
                        </button>
                    )}
                </div>

                {/* 9. Video section SKIPPED per user request! */}

                {/* 10. Ratings Panel */}
                <div className={styles['ratings-panel']}>
                    <h3 className={styles['section-heading']}>{t('release.rating')}</h3>
                    <div className={styles['grade-container']}>
                        <div className={styles.grade}>
                            <h1>{(animeData.grade ?? 0).toFixed(1)}</h1>
                            <p>{animeData.vote_count ?? 0} {plural(animeData.vote_count ?? 0, t('release.votes1'), t('release.votes2'), t('release.votes5'))}</p>
                        </div>
                        <div className={styles['grade-bars']}>
                            {[5, 4, 3, 2, 1].map(grade => {
                                const voteCount = animeData[`vote_${grade}_count` as keyof Anime] || 0;
                                return (
                                    <div key={grade} style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '5px' }}>
                                        <p style={{ margin: 0, minWidth: '12px' }}>{grade}</p>
                                        <progress value={+voteCount} max={animeData.vote_count || 1}></progress>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                    <div className={styles['release-rating-control']} aria-label={t('release.yourRating')}>
                        <div>
                            {[1, 2, 3, 4, 5].map(value => (
                                <button
                                    type="button"
                                    key={value}
                                    disabled={isReleaseVoteLoading}
                                    className={value <= currentVote ? styles['release-rating-selected'] : ''}
                                    onClick={() => void rateRelease(value)}
                                    aria-label={t('release.rateValue', { value })}
                                    title={t('release.ratingOutOfFive', { value })}
                                >
                                    {value <= currentVote ? (
                                        <svg className={styles['release-rating-filled']} viewBox="0 0 24 24" aria-hidden="true"><path d="m12 2.8 2.86 5.8 6.4.93-4.63 4.51 1.09 6.37L12 17.4l-5.72 3.01 1.09-6.37L2.74 9.53l6.4-.93L12 2.8Z" /></svg>
                                    ) : (
                                        <svg className={styles['release-rating-outline']} viewBox="0 0 24 24" aria-hidden="true"><path d="m12 2.8 2.86 5.8 6.4.93-4.63 4.51 1.09 6.37L12 17.4l-5.72 3.01 1.09-6.37L2.74 9.53l6.4-.93L12 2.8Z" /></svg>
                                    )}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                {/* 11. Watchlist Line ("В списках у людей") */}
                <div className={styles['mobile-watchlist-section']}>
                    <h3 className={styles['section-heading']}>{t('release.inPeopleLists')}</h3>
                    <WatchlistLine
                        watching_count={animeData.watching_count}
                        plan_count={animeData.plan_count}
                        completed_count={animeData.completed_count}
                        hold_on_count={animeData.hold_on_count}
                        dropped_count={animeData.dropped_count}
                    />
                </div>

                {/* 12. Screenshots ("Кадры") */}
                {screenshots.length > 0 && (
                    <div className={styles['mobile-screenshots-section']}>
                        <h3 className={styles['section-heading']}>{t('release.frames')}</h3>
                        <div className={styles['mobile-screenshots-scroll']}>
                            {screenshots.map((url, index) => (
                                <div
                                    key={url}
                                    className={styles['mobile-screenshot-card']}
                                    onClick={() => setImageViewer({
                                        releaseId: id,
                                        images: screenshots.map((src, i) => ({ src, alt: t('release.screenshotAlt', { number: i + 1 }) })),
                                        index
                                    })}
                                >
                                    <RemoteMedia src={url} alt={t('release.screenshotAlt', { number: index + 1 })} />
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* 13. Collection rows */}
                <div className={styles['mobile-collection-rows']}>
                    <button
                        type="button"
                        className={styles['mobile-list-row']}
                        onClick={() => void openCollectionPicker()}
                    >
                        <span className={styles['mobile-list-row-label']}>{t('release.showInCollections')}</span>
                        <span className={styles['mobile-collection-badge']}>{myCollections.length}</span>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                            <path d="m9 18 6-6-6-6" />
                        </svg>
                    </button>
                    <button
                        type="button"
                        className={styles['mobile-list-row']}
                        onClick={() => void openCollectionPicker()}
                    >
                        <span className={styles['mobile-list-row-label']}>{t('release.addToMyCollection')}</span>
                        <span className={styles['mobile-plus-icon']}>+</span>
                    </button>
                </div>

                {/* 14. Recommended Releases */}
                {animeData.recommended_releases?.length > 0 && (
                    <section className={styles['also-recommend']}>
                        <h3 className={styles['section-heading']}>{t('release.recommendedReleases')}</h3>
                        <div className={styles['recommend-grid']}>
                            {animeData.recommended_releases.map(item => (
                                <RecommendedRelease key={item.id} anime={item} />
                            ))}
                        </div>
                    </section>
                )}

                {/* 15. Comments */}
                <section className={styles['comments-section']} id="mobile-comments-section">
                    <div className={styles['comments-heading']}>
                        <div className={styles['comments-heading-left']}>
                            <h3>{t('release.commentSection')}</h3>
                            <small className={styles['comments-subheading']}>{t('release.commentsPopularRelevant')}</small>
                        </div>
                        <button
                            type="button"
                            className={styles['comments-show-all-btn']}
                            onClick={() => setIsCommentsOpen(true)}
                        >
                            {t('release.showAll')}
                        </button>
                    </div>

                    {/* Comments preview */}
                    {isCommentsLoading && <p className={styles['empty-comments']}>{t('misc.loading')}</p>}
                    {Boolean(commentsLoadError) && <p className={styles['comment-error']}>{getReadableErrorMessage(commentsLoadError, t) || t('release.loadError')}</p>}
                    {!isCommentsLoading && !commentsLoadError && firstPageComments.length === 0 && (
                        <p className={styles['empty-comments']}>{t('release.noComments')}</p>
                    )}
                    {!isCommentsLoading && firstPageComments.length > 0 && (
                        <div className={styles['comments-page-list']}>
                            {firstPageComments.slice(0, 4).map((comment: CommentType) => (
                                <Comment
                                    key={comment.id}
                                    comment={comment}
                                    releaseId={animeData.id}
                                    onReply={startReply}
                                    onEdit={startEdit}
                                    onDelete={reloadComments}
                                />
                            ))}
                        </div>
                    )}

                    {/* Quick comment box */}
                    <div className={styles['mobile-quick-comment-bar']}>
                        <div className={styles['quick-comment-top-row']}>
                            <label className={styles['quick-comment-spoiler-label']}>
                                <input
                                    type="checkbox"
                                    checked={quickCommentIsSpoiler}
                                    onChange={e => setQuickCommentIsSpoiler(e.target.checked)}
                                />
                                <span>{t('release.noSpoiler')}</span>
                            </label>
                            <button
                                type="button"
                                className={styles['quick-comment-rules-btn']}
                                onClick={openCommentEditor}
                            >
                                {t('release.rules')}
                            </button>
                        </div>
                        {quickCommentError && <p className={styles['collection-picker-error']}>{quickCommentError}</p>}
                        <form className={styles['quick-comment-form']} onSubmit={handleQuickCommentSubmit}>
                            <input
                                type="text"
                                className={styles['quick-comment-input']}
                                placeholder={t('release.yourComment')}
                                value={quickCommentText}
                                onChange={e => setQuickCommentText(e.target.value)}
                            />
                            <button
                                type="submit"
                                className={styles['quick-comment-send-btn']}
                                disabled={!quickCommentText.trim() || isPostingQuickComment}
                                aria-label={t('comments.send')}
                            >
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                                    <polygon points="5 3 19 12 5 21 5 3" />
                                </svg>
                            </button>
                        </form>
                    </div>
                </section>
            </div>
            {isCommentsOpen && <CommentsModal
                isOpen
                entityId={animeData.id}
                variant="release"
                title={t('release.commentSection')}
                initialAction={commentsInitialAction}
                onCommentsChanged={reloadComments}
                onClose={() => {
                    setIsCommentsOpen(false);
                    setCommentsInitialAction(null);
                }}
            />}
            <Modal
                isOpen={isCollectionPickerOpen}
                onClose={() => setIsCollectionPickerOpen(false)}
                title={t('release.addCollection')}
                stickyHeader
                contentClassName={styles['collection-picker-modal']}
            >
                <p className={styles['collection-picker-caption']}>{t('release.selectCollection')}</p>
                {isCollectionsLoading && <p className={styles['collection-picker-state']}>{t('misc.loading')}</p>}
                {!isCollectionsLoading && collectionActionError && <p className={styles['collection-picker-error']} role="alert">{collectionActionError}</p>}
                {!isCollectionsLoading && !collectionActionError && myCollections.length === 0 && <p className={styles['collection-picker-state']}>{t('release.noCollections')}</p>}
                {!isCollectionsLoading && myCollections.length > 0 && <div className={styles['collection-picker-list']}>
                    {myCollections.map(collection => <button
                        key={collection.id}
                        type="button"
                        disabled={collectionActionId !== null}
                        className={styles['collection-picker-item']}
                        onClick={() => void addReleaseToCollection(collection)}
                    >
                        <RemoteImage src={collection.image} alt="" />
                        <span><strong>{collection.title}</strong><small>{collection.description?.trim() || t('release.noDescription')}</small></span>
                        {collectionActionId === collection.id && <em>{t('release.addingCollection')}</em>}
                    </button>)}
                </div>}
                {collectionActionNotice && <p className={styles['collection-picker-notice']} role="status">{collectionActionNotice}</p>}
            </Modal>
            <Modal
                isOpen={isReleaseNotificationsOpen}
                onClose={() => setIsReleaseNotificationsOpen(false)}
                title={t('release.notificationsTitle')}
                contentClassName={styles['release-notifications-modal']}
            >
                <p className={styles['release-notifications-caption']}>{t('release.notificationsCaption')}</p>
                {isNotificationSettingsLoading && <p className={styles['collection-picker-state']}>{t('misc.loading')}</p>}
                {!isNotificationSettingsLoading && <div className={styles['release-notification-options']}>
                    <button type="button" className={releaseNotificationMode === 'none' ? styles['release-notification-active'] : ''} onClick={() => setReleaseNotificationMode('none')}>
                        <strong>{t('release.notificationsNone')}</strong>
                        <span>{t('release.notificationsNoneDescription')}</span>
                    </button>
                    <button type="button" className={releaseNotificationMode === 'all_dubs' ? styles['release-notification-active'] : ''} onClick={() => setReleaseNotificationMode('all_dubs')}>
                        <strong>{t('release.notificationsAll')}</strong>
                        <span>{t('release.notificationsAllDescription')}</span>
                    </button>
                    <button type="button" className={releaseNotificationMode === 'selected_dubs' ? styles['release-notification-active'] : ''} onClick={() => setReleaseNotificationMode('selected_dubs')}>
                        <strong>{t('release.notificationsSelected')}</strong>
                        <span>{t('release.notificationsSelectedDescription')}</span>
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
                    <button type="button" onClick={() => setIsReleaseNotificationsOpen(false)}>{t('misc.cancel')}</button>
                    <button type="button" disabled={isNotificationSettingsLoading || isNotificationSettingsSaving} onClick={() => void saveReleaseNotifications()}>{isNotificationSettingsSaving ? t('collection.saving') : t('collection.saveChanges')}</button>
                </div>
            </Modal>
            {imageViewer && imageViewer.releaseId === id && <ImageLightbox images={imageViewer.images} initialIndex={imageViewer.index} onClose={() => setImageViewer(null)} />}
            {entryNotice && <p role="status">{t('ux.selectEpisodeAgain')}</p>}
            {roomSelectionError && <p role="alert">{roomSelectionError}</p>}
            {(isDubScreenOpen) && <DubSelectModal
                isOpen={isDubScreenOpen}
                resolveSources={!roomId}
                onClose={() => {
                    setIsDubScreenOpen(false);
                }}
                releaseId={animeData?.id}
                onEpisodeSelect={async (sources, episode, episodes, sourceId, dubId) => {
                    if (roomId) {
                        try {
                            if (room?.roomId !== roomId || roomStatus !== 'connected') throw new Error('Сначала подключитесь к комнате');
                            await sendRoom({ type: 'set_media', media: {
                                releaseId: animeData.id,
                                releaseName: getReleaseTitle(animeData, settings.appearance.language),
                                dubId, sourceId, episode: episode.position, episodeName: episode.name,
                            } });
                            setIsDubScreenOpen(false);
                            navigate('/anime/' + animeData.id + '/watch?room=' + encodeURIComponent(roomId));
                        } catch (error) { setRoomSelectionError(error instanceof Error ? error.message : String(error)); }
                        return;
                    }
                    setIsDubScreenOpen(false)
                    setPlayerSession({
                        sources,
                        animeId: animeData.id,
                        animeName: getReleaseTitle(animeData, settings.appearance.language),
                        image: animeData.image,
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

function formatCompactNumber(num: number): string {
    if (!num) return '0';
    return num.toLocaleString('ru-RU');
}
