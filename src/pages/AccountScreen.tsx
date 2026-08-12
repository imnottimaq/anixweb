import { Link, useNavigate, useParams } from "react-router-dom"
import styles from './AccountScreen.module.css'
import { useUser } from "../shared/contexts/userContext"
import { useEffect, useState } from "react"
import type { Comment, PagedResponse, Profile } from "../shared/types/api"
import WatchlistLine from "../components/WatchlistLine"
import { useSearchScope } from '../shared/contexts/searchContext';
import { useTranslation } from '../shared/useTranslation';

//Icons
import TgIcon from '../assets/icons/telegram.svg'
import VkIcon from '../assets/icons/vk.svg'
import DiscordIcon from '../assets/icons/discord.svg'
import InstIcon from '../assets/icons/instagram.svg'
import TtIcon from '../assets/icons/tiktok.svg'
import ReleaseCard from "../components/ReleaseCard"
import RemoteImage from '../components/RemoteImage'
import { PageLayout } from '../components/PageLayout';
import PageState from '../components/PageState';
import { useApi } from '../shared/apiClient';
import { Modal } from '../modals/ModalTemplate';
import { saveRoomIdentity } from '../shared/roomParticipant';
import { useAsyncLoad } from '../shared/useAsyncLoad';
import CommentComponent from '../components/Comment';

interface ProfileAPIResponse{
    code: number;
    profile: Profile;
    is_my_profile: boolean;
}

export default function AccountScreen(){
    const {id} = useParams<{id: string}>();
    const {userToken, userId} = useUser()
    const api = useApi();
    const { setSearchScope } = useSearchScope();
    const { t } = useTranslation();
    const [userObject, setUserObject] = useState<Profile | null>(null);
    const [isMyProfile, setIsMyProfile] = useState<boolean | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [loadAttempt, setLoadAttempt] = useState(0);
    const [isFriendActionLoading, setIsFriendActionLoading] = useState(false);
    const [friendActionError, setFriendActionError] = useState<string | null>(null);
    const [isCancelRequestModalOpen, setIsCancelRequestModalOpen] = useState(false);
    const [isProfileCommentsOpen, setIsProfileCommentsOpen] = useState(false);
    const [commentsTab, setCommentsTab] = useState<'release' | 'collection'>('release');
    const [commentsPage, setCommentsPage] = useState(0);

    const navigate = useNavigate()
    const profileId = id ? Number(id) : userId;
    const isValidProfileId = Number.isInteger(profileId) && profileId > 0;
    const commentsPath = commentsTab === 'release'
        ? `/release/comment/all/profile/${profileId}/${commentsPage}?sort=1`
        : `/collection/comment/all/profile/${profileId}/${commentsPage}?sort=1`;
    const { data: profileCommentsData, error: profileCommentsError, isLoading: isProfileCommentsLoading, reload: reloadProfileComments } = useAsyncLoad(
        signal => api.get<PagedResponse<Comment>>(commentsPath, { signal }),
        [api, commentsPath],
        { enabled: isProfileCommentsOpen && isValidProfileId, initialData: { code: 0, content: [], total_count: 0, total_page_count: 0, current_page: 0 } },
    );
    const profileComments = profileCommentsData?.content ?? [];
    useEffect(() => {
        if (userToken === "") navigate('/account/login')
    }, [navigate, userToken])

    useEffect(() => {
        setSearchScope({ type: 'profiles' });
        return () => setSearchScope({ type: 'releases' });
    }, [setSearchScope]);
    
    useEffect(() => {
        let isCancelled = false;

        if (!userToken) return () => { isCancelled = true; };

        if (!Number.isFinite(profileId) || profileId <= 0) {
            return () => { isCancelled = true; };
        }

        const loadProfile = async () => {
            setIsLoading(true);
            setLoadError(null);
            try {
                const data = await api.get<ProfileAPIResponse>(`/profile/${profileId}`);
                const profile = data.profile;
                setIsMyProfile(data.is_my_profile)
                if (!profile) throw new Error('Сервер вернул профиль без данных');
                if (!isCancelled && (data.is_my_profile || profile.id === userId)) {
                    saveRoomIdentity({ id: profile.id, login: profile.login, avatar: profile.avatar ?? null });
                }
                if (!isCancelled) setUserObject(profile);
            } catch (error) {
                console.error('Не удалось загрузить профиль:', error);
                if (!isCancelled) setLoadError(error instanceof Error ? error.message : 'Не удалось загрузить профиль.');
            } finally {
                if (!isCancelled) setIsLoading(false);
            }
        };

        void loadProfile();

        return () => { isCancelled = true; };
    }, [api, profileId, userId, userToken, loadAttempt])

    const watchDynamic = userObject?.watch_dynamics?.slice(-10) ?? [];
    const maxValue = Math.max(...watchDynamic.map(({ count }) => count), 1);
    const vkUrl = getSocialUrl(userObject?.vk_page, 'vk');
    const telegramUrl = getSocialUrl(userObject?.tg_page, 'telegram');
    const instagramUrl = getSocialUrl(userObject?.inst_page, 'instagram');
    const tiktokUrl = getSocialUrl(userObject?.tt_page, 'tiktok');

    const handleFriendAction = async () => {
        if (!userObject || isFriendActionLoading) return false;

        const status = userObject.friend_status;
        const isRemoval = status === 0 || status === 2;
        const endpoint = isRemoval
            ? `/profile/friend/request/remove/${userObject.id}`
            : `/profile/friend/request/send/${userObject.id}`;
        const nextStatus = status === 2 ? 1 : status === 0 ? null : status === 1 ? 2 : 0;

        setIsFriendActionLoading(true);
        setFriendActionError(null);

        try {
            await api.get<{ code: number }>(endpoint);
        } catch {
            setFriendActionError('Не удалось обновить заявку в друзья');
            setIsFriendActionLoading(false);
            return false;
        }

        setUserObject(previous => previous ? { ...previous, friend_status: nextStatus } : previous);
        setIsFriendActionLoading(false);
        return true;
    };

    const getFriendActionLabel = () => {
        if (isFriendActionLoading) return 'Загрузка…';
        if (userObject?.friend_status === 0) return 'Отменить заявку';
        if (userObject?.friend_status === 1) return 'Добавить в друзья';
        if (userObject?.friend_status === 2) return 'Друзья';
        return 'Добавить в друзья';
    };

    if (!userToken) return <PageLayout size="wide"><PageState status="loading" message="Переходим ко входу…" /></PageLayout>;
    if (!isValidProfileId) return <PageLayout size="wide"><PageState status="error" message="Профиль не найден." /></PageLayout>;
    if (isLoading) return <PageLayout size="wide"><PageState status="loading" message="Загружаем профиль…" /></PageLayout>;
    if (loadError || !userObject) return <PageLayout size="wide">
        <PageState status="error" message={loadError ?? 'Профиль не найден.'} onRetry={() => setLoadAttempt(attempt => attempt + 1)} />
    </PageLayout>;

    return (
        <PageLayout size="wide">
            <div className={styles['body']} key={userObject.id}>
            <div className={styles['profile-grid']}>
                <div className={styles['profile-card']}>
                    <div className="flex-row">
                        <div className="flex-column">
                            <div className={styles['user-short']}>
                                <RemoteImage src={userObject?.avatar} />
                                <div className={styles['user-info']}>
                                    <div className={styles['user-name-row']}>
                                        <p>{userObject?.login}</p>
                                        <span className={styles['rating']} aria-label={`Рейтинг: ${userObject.rating_score}`}>{userObject.rating_score}</span>
                                    </div>
                                    <p>{userObject?.status}</p>
                                </div>
                            </div>
                            <div className={styles['user-socials']}>
                                {vkUrl && <a className={styles.vk} href={vkUrl} aria-label="Профиль ВКонтакте"><img className={styles['social-icon']} src={VkIcon} alt="" /></a>}
                                {telegramUrl && <a className={styles.tg} href={telegramUrl} aria-label="Профиль в Telegram"><img className={styles['social-icon']} src={TgIcon} alt="" /></a>}
                                {userObject.discord_page && <span className={styles.discord} aria-label={`Discord: ${userObject.discord_page}`}><img className={styles['social-icon']} src={DiscordIcon} alt="" /></span>}
                                {instagramUrl && <a className={styles.inst} href={instagramUrl} aria-label="Профиль в Instagram"><img className={styles['social-icon']} src={InstIcon} alt="" /></a>}
                                {tiktokUrl && <a className={styles.tt} href={tiktokUrl} aria-label="Профиль в TikTok"><img className={styles['social-icon']} src={TtIcon} alt="" /></a>}
                            </div>
                            <div className={styles['user-roles']}>
                                {userObject?.roles?.map(role => {
                                    const color = role.color.startsWith('#') ? role.color : `#${role.color}`;
                                    return <div key={`${role.name}-${role.color}`} style={{ borderColor: color, color }} className={styles.role}>
                                        <span className={styles.circle} style={{ backgroundColor: color }} />
                                        <span>{role.name}</span>
                                    </div>;
                                })}
                            </div>
                        </div>

                        {isMyProfile && <button type="button" className={styles['edit-button']} onClick={() => navigate('/account/edit')}>Редактировать</button>}
                        {!isMyProfile && <div className={styles['friend-action']}>
                            <button
                                type="button"
                                className={`${styles['friend-button']} ${styles[`friend-status-${userObject?.friend_status ?? 'none'}`]}`}
                                disabled={isFriendActionLoading}
                                onClick={() => {
                                    if (userObject?.friend_status === 0 || userObject?.friend_status === 2) setIsCancelRequestModalOpen(true);
                                    else void handleFriendAction();
                                }}
                            >
                                {getFriendActionLabel()}
                            </button>
                            {userObject?.friend_status === 1 && <span className={styles['friend-request-notice']}>Отправил(а) вам заявку в друзья</span>}
                            {friendActionError && <span>{friendActionError}</span>}
                        </div>}
                    </div>
                    
                    <div className={styles['stat-number-div']}>
                        <button type="button" className={`${styles['stat-number']} ${styles['comments-stat']}`} onClick={() => {
                            setCommentsTab('release');
                            setCommentsPage(0);
                            setIsProfileCommentsOpen(true);
                        }}>
                            <p>{userObject?.comment_count}</p>
                            <span>{t('account.comments')}</span>
                        </button>
                        <div className={styles['stat-number']}>
                            <p>{userObject?.video_count}</p>
                            <span>{t('account.videos')}</span>
                        </div>
                        <button
                            type="button"
                            className={`${styles['stat-number']} ${styles['collections-stat']}`}
                            onClick={() => navigate(isMyProfile ? '/collections?view=mine' : `/collections?profileId=${userObject.id}`)}
                        >
                            <p>{userObject?.collection_count}</p>
                            <span>{t('account.collections')}</span>
                        </button>
                        <button type="button" className={`${styles['stat-number']} ${styles['friends-stat']}`} onClick={() => navigate(isMyProfile ? '/friends' : `/friends/${userObject.id}`)}>
                            <p>{userObject?.friend_count}</p>
                            <span>{t('account.friends')}</span>
                        </button>
                    </div>
                </div>
                <div className={styles['statistics-card']}>
                    <div className={styles['stat-line']}>
                        <h2>{t('account.stats')}</h2>
                        <button type="button" className={styles['view-all']} onClick={() => navigate(isMyProfile ? "/favorites" : `/favorites/${userObject.id}`)}>{t('account.viewAll')}</button>
                    </div>
                    <p className={styles['statistics-caption']}>{t('account.distribution')}</p>
                    <WatchlistLine watching_count={userObject?.watching_count || 0}
                        plan_count={userObject?.plan_count || 0}
                        completed_count={userObject?.completed_count || 0}
                        hold_on_count={userObject?.hold_on_count || 0}
                        dropped_count={userObject?.dropped_count || 0}/>
                    <div className={styles['statistics-summary']}>
                        <div>
                            <span>{t('account.watchedEpisodes')}</span>
                            <strong>{userObject?.watched_episode_count || 0}</strong>
                        </div>
                        <div>
                            <span>{t('account.watchedTime')}</span>
                            <strong>{formatMinutes(userObject?.watched_time || 0)}</strong>
                        </div>
                    </div>
                </div>
                <div className={styles['dynamics-card']}>
                    <h2>{t('account.dynamics')}</h2>
                    <div className={styles['chart']}>
                        {watchDynamic.map((item) => (
                            <div className={styles['column']} key={`${item.timestamp}-${item.count}`}>
                                <span>{item.count}</span>
                                <div className={styles['bar']} style={{height:`${Math.max(10, (item.count / maxValue) * 180)}px`}}/>
                                <span className={styles['date']}>{formatTimestamp(item.timestamp)}</span>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
            <div className={styles['lists-grid']}>
                <div>
                    <h2>{t('account.releaseRating')}</h2>
                        {userObject?.votes.map(item => 
                        <ReleaseCard key={item.id} variant="rated" id={item.id} name={item.title_ru} 
                            poster={item.image} 
                            grade={item.my_vote} 
                            timestamp={item.voted_at}/>
                    )}
                </div>
                <div>
                    <h2>{t('account.watchedRecently')}</h2>
                        {userObject?.history.map(item => 
                        <ReleaseCard key={item.id} variant="history" id={item.id} name={item.title_ru}
                            poster={item.image}
                            grade={item.last_view_episode?.position ?? 0}
                            timestamp={item.last_view_timestamp}
                            />
                    )}
                </div>
            </div>
            <Modal
                isOpen={isCancelRequestModalOpen}
                onClose={() => setIsCancelRequestModalOpen(false)}
                title={userObject?.friend_status === 2 ? 'Удалить из друзей?' : 'Отменить заявку в друзья?'}
            >
                {close => <>
                    <p className={styles['confirm-text']}>{userObject?.friend_status === 2
                        ? 'Пользователь будет удалён из списка ваших друзей.'
                        : 'Пользователь больше не увидит вашу заявку в друзья.'}</p>
                    <div className={styles['confirm-actions']}>
                        <button type="button" onClick={close}>Назад</button>
                        <button
                            type="button"
                            className={styles['confirm-danger']}
                            disabled={isFriendActionLoading}
                            onClick={() => void handleFriendAction().then(isSuccess => { if (isSuccess) close(); })}
                        >
                            {userObject?.friend_status === 2 ? 'Удалить из друзей' : 'Отменить заявку'}
                        </button>
                    </div>
                </>}
            </Modal>
            <Modal
                isOpen={isProfileCommentsOpen}
                onClose={() => setIsProfileCommentsOpen(false)}
                title={`Комментарии ${userObject.login}`}
                stickyHeader
                contentClassName={styles['profile-comments-modal']}
                contentStyle={{ width: 'min(1040px, calc(100vw - 32px))', maxHeight: '80vh' }}
            >
                <div className={styles['profile-comments-tabs']} role="tablist" aria-label="Тип комментариев">
                    <button type="button" role="tab" aria-selected={commentsTab === 'release'} className={commentsTab === 'release' ? styles.active : ''} onClick={() => { setCommentsTab('release'); setCommentsPage(0); }}>Под релизами</button>
                    <button type="button" role="tab" aria-selected={commentsTab === 'collection'} className={commentsTab === 'collection' ? styles.active : ''} onClick={() => { setCommentsTab('collection'); setCommentsPage(0); }}>Под коллекциями</button>
                </div>
                {isProfileCommentsLoading && <p className={styles['profile-comments-state']}>Загружаем комментарии…</p>}
                {!isProfileCommentsLoading && Boolean(profileCommentsError) && <p className={styles['profile-comments-error']}>Не удалось загрузить комментарии. <button type="button" onClick={reloadProfileComments}>Повторить</button></p>}
                {!isProfileCommentsLoading && !profileCommentsError && profileComments.length === 0 && <p className={styles['profile-comments-state']}>Комментариев пока нет.</p>}
                {!isProfileCommentsLoading && !profileCommentsError && profileComments.map(comment => <div className={styles['profile-comment']} key={comment.id}>
                    <ProfileCommentContextLink comment={comment} variant={commentsTab} />
                    <CommentComponent
                        comment={comment}
                        variant={commentsTab === 'collection' ? 'collection' : 'release'}
                        onDelete={reloadProfileComments}
                    />
                </div>)}
                {!isProfileCommentsLoading && !profileCommentsError && (profileCommentsData?.total_page_count ?? 0) > 0 && <div className={styles['profile-comments-pagination']}>
                    <button type="button" disabled={commentsPage <= 0} onClick={() => setCommentsPage(page => page - 1)}>Назад</button>
                    <span>{commentsPage + 1} / {(profileCommentsData?.total_page_count ?? 0) + 1}</span>
                    <button type="button" disabled={commentsPage >= (profileCommentsData?.total_page_count ?? 0)} onClick={() => setCommentsPage(page => page + 1)}>Далее</button>
                </div>}
            </Modal>
        </div>
        </PageLayout>
    )

}

type CommentContextEntity = {
    id?: number;
    '@id'?: number;
    title?: string;
    title_ru?: string;
};

function ProfileCommentContextLink({ comment, variant }: { comment: Comment; variant: 'release' | 'collection' }) {
    const contextualComment = comment as Comment & {
        collection?: CommentContextEntity | number;
        release_id?: number;
        collection_id?: number;
    };
    const entity = variant === 'release' ? contextualComment.release : contextualComment.collection;
    const entityObject = typeof entity === 'object' && entity !== null ? entity as CommentContextEntity : null;
    const rawId = typeof entity === 'number'
        ? entity
        : entityObject?.id ?? entityObject?.['@id'] ?? (variant === 'release' ? contextualComment.release_id : contextualComment.collection_id);
    const entityId = Number(rawId);
    const title = entityObject?.title_ru ?? entityObject?.title;
    const entityLabel = variant === 'release' ? 'релизу' : 'коллекции';
    const route = variant === 'release' ? `/anime/${entityId}` : `/collection/${entityId}`;
    const content = <>
        <span>Комментарий к {entityLabel}</span>
        <strong>{title || (variant === 'release' ? 'Открыть релиз' : 'Открыть коллекцию')}</strong>
    </>;

    return Number.isInteger(entityId) && entityId > 0
        ? <Link className={styles['profile-comment-context']} to={route}>{content}</Link>
        : <div className={styles['profile-comment-context']}>{content}</div>;
}

function formatMinutes(totalMinutes:number) {
  const days = Math.floor(totalMinutes / 1_440);
  const hours = Math.floor((totalMinutes % 1_440) / 60);

  return `~${days} дней ${hours} часов`;
}

function formatTimestamp(timestamp: number){
    const dateObj = new Date(timestamp * 1000)
    return `${dateObj.getDate()}.${dateObj.getMonth() + 1}`
}

type SocialPlatform = 'vk' | 'telegram' | 'instagram' | 'tiktok';

const SOCIAL_LINKS: Record<SocialPlatform, { baseUrl: string; hosts: string[]; requiresAt?: boolean }> = {
    vk: { baseUrl: 'https://vk.com/', hosts: ['vk.com'] },
    telegram: { baseUrl: 'https://t.me/', hosts: ['t.me', 'telegram.me'] },
    instagram: { baseUrl: 'https://instagram.com/', hosts: ['instagram.com'] },
    tiktok: { baseUrl: 'https://tiktok.com/@', hosts: ['tiktok.com'], requiresAt: true },
};

function getSocialUrl(value: string | null | undefined, platform: SocialPlatform): string | null {
    const trimmed = value?.trim();
    if (!trimmed) return null;

    const config = SOCIAL_LINKS[platform];
    if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith('//')) {
        try {
            const url = new URL(trimmed.startsWith('//') ? `https:${trimmed}` : trimmed);
            const host = url.hostname.toLowerCase().replace(/^www\./, '');
            if (!config.hosts.includes(host)) return null;
            url.protocol = 'https:';
            return url.toString();
        } catch {
            return null;
        }
    }

    const knownHostPattern = new RegExp(`^(?:www\\.)?(?:${config.hosts.map(host => host.replace('.', '\\.')).join('|')})/`, 'i');
    const username = trimmed.replace(knownHostPattern, '').replace(/^@/, '').split(/[/?#]/, 1)[0]?.trim();
    if (!username || /\s/.test(username) || username.includes(':')) return null;

    return `${config.baseUrl}${config.requiresAt ? username.replace(/^@/, '') : username}`;
}
