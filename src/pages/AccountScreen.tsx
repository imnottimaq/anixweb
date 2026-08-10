import { useNavigate, useParams } from "react-router-dom"
import styles from './AccountScreen.module.css'
import { useUser } from "../shared/contexts/userContext"
import { useEffect, useState } from "react"
import type { Profile } from "../shared/types/api"
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
import { useApi } from '../shared/apiClient';
import { Modal } from '../modals/ModalTemplate';
import { saveRoomIdentity } from '../shared/roomParticipant';

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
    const [isFriendActionLoading, setIsFriendActionLoading] = useState(false);
    const [friendActionError, setFriendActionError] = useState<string | null>(null);
    const [isCancelRequestModalOpen, setIsCancelRequestModalOpen] = useState(false);

    const navigate = useNavigate()
    useEffect(() => {
        if (userToken === "") navigate('/account/login')
    }, [navigate, userToken])

    useEffect(() => {
        setSearchScope({ type: 'profiles' });
        return () => setSearchScope({ type: 'releases' });
    }, [setSearchScope]);
    
    useEffect(() => {
        let isCancelled = false;

        if (!userToken) {
            setIsLoading(false);
            return () => { isCancelled = true; };
        }

        const profileId = id ? Number(id) : userId;
        if (!Number.isFinite(profileId) || profileId <= 0) {
            setIsLoading(false);
            return () => { isCancelled = true; };
        }

        const loadProfile = async () => {
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
            } finally {
                if (!isCancelled) setIsLoading(false);
            }
        };

        void loadProfile();

        return () => { isCancelled = true; };
    }, [api, id, userId, userToken])

    const watchDynamic = userObject?.watch_dynamics?.slice(-10) ?? [];
    const maxValue = Math.max(...watchDynamic.map(({ count }) => count), 1);

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

    return (
        <div className={styles['body']} key={userObject?.id}>
            <div className={styles['profile-grid']}>
                <div className={styles['profile-card']}>
                    <div className="flex-row">
                        <div className="flex-column">
                            <div className={styles['user-short']}>
                                <RemoteImage src={userObject?.avatar} />
                                <div className={styles['user-info']}>
                                    <div className={styles['user-name-row']}>
                                        <p>{userObject?.login}</p>
                                        <span className={styles['rating']}>{userObject?.rating_score}</span>
                                    </div>
                                    <p>{userObject?.status}</p>
                                </div>
                            </div>
                            <div className={styles['user-socials']}>
                                {userObject?.vk_page && <a className={styles['vk']} href={"https://vk.com/" + userObject?.vk_page}><img className={styles['social-icon']} src={VkIcon}/></a>}
                                {userObject?.tg_page && <a className={styles['tg']} href={"https://t.me/" + userObject?.tg_page}><img className={styles['social-icon']} src={TgIcon}/></a>}
                                {userObject?.discord_page && <a className={styles['discord']}><img className={styles['social-icon']} src={DiscordIcon}/></a>}
                                {userObject?.inst_page && <a className={styles['inst']} href={"https://instagram.com/" + userObject?.inst_page}><img className={styles['social-icon']} src={InstIcon}/></a>}
                                {userObject?.tt_page && <a className={styles['tt']} href={"https://tiktok.com/@" + userObject?.tt_page}><img className={styles['social-icon']} src={TtIcon}/></a>}
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
                        <div className={styles['stat-number']}>
                            <p>{userObject?.comment_count}</p>
                            <a>{t('account.comments')}</a>
                        </div>
                        <div className={styles['stat-number']}>
                            <p>{userObject?.video_count}</p>
                            <a>{t('account.videos')}</a>
                        </div>
                        <div className={styles['stat-number']}>
                            <p>{userObject?.collection_count}</p>
                            <a>{t('account.collections')}</a>
                        </div>
                        <div className={styles['stat-number']}>
                            <p>{userObject?.friend_count}</p>
                            <a>{t('account.friends')}</a>
                        </div>
                    </div>
                </div>
                <div className={styles['statistics-card']}>
                    <div className={styles['stat-line']}>
                        <h2>{t('account.stats')}</h2>
                        <a onClick={() => navigate(isMyProfile ? "/favorites" : `/favorites/${userObject?.id}`)}>{t('account.viewAll')}</a>
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
                            <strong>{formatSeconds(userObject?.watched_time || 0)}</strong>
                        </div>
                    </div>
                </div>
                <div className={styles['dynamics-card']}>
                    <h2>{t('account.dynamics')}</h2>
                    <div className={styles['chart']}>
                        {watchDynamic.map((item) => (
                            <div className={styles['column']}>
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
        </div>
            {isLoading && <div className={styles['loading-overlay']} />}
        </div>
    )

}

function formatSeconds(totalSeconds:number) {
  const days = Math.floor(totalSeconds / 1440);
  const hours = Math.floor((totalSeconds % 1440) / 60);

  return `~${days} дней ${hours} часов`;
}

function formatTimestamp(timestamp: number){
    const dateObj = new Date(timestamp * 1000)
    return `${dateObj.getDate()}.${dateObj.getMonth()}`
}
