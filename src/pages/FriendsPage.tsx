import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Modal } from '../modals/ModalTemplate';
import PageState from '../components/PageState';
import { PageHeader, PageLayout } from '../components/PageLayout';
import RemoteImage from '../components/RemoteImage';
import { useApi } from '../shared/apiClient';
import { useUser } from '../shared/contexts/userContext';
import type { PagedResponse, Profile } from '../shared/types/api';
import { useAsyncLoad } from '../shared/useAsyncLoad';
import styles from './FriendsPage.module.css';

type FriendsTab = 'friends' | 'incoming' | 'outgoing';
type ConfirmAction = 'removeFriend' | 'cancelRequest' | 'declineRequest';

type FriendsData = Record<FriendsTab, PagedResponse<Profile>>;

const tabs: Array<{ value: FriendsTab; label: string }> = [
    { value: 'friends', label: 'Друзья' },
    { value: 'incoming', label: 'Входящие' },
    { value: 'outgoing', label: 'Отправленные' },
];

const emptyPage: PagedResponse<Profile> = { code: 0, content: [], total_count: 0, total_page_count: 0, current_page: 0 };
const emptyData: FriendsData = { friends: emptyPage, incoming: emptyPage, outgoing: emptyPage };

export default function FriendsPage() {
    const api = useApi();
    const { userId, userToken } = useUser();
    const { profileId: profileIdParam } = useParams<{ profileId: string }>();
    const navigate = useNavigate();
    const [activeTab, setActiveTab] = useState<FriendsTab>('friends');
    const [pages, setPages] = useState<Record<FriendsTab, number>>({ friends: 0, incoming: 0, outgoing: 0 });
    const [actionProfile, setActionProfile] = useState<Profile | null>(null);
    const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
    const [pendingProfileId, setPendingProfileId] = useState<number | null>(null);
    const [actionError, setActionError] = useState<string | null>(null);
    const requestedProfileId = profileIdParam ? Number(profileIdParam) : userId;
    const isValidProfileId = Number.isInteger(requestedProfileId) && requestedProfileId > 0;
    const isOwnProfile = requestedProfileId === userId;

    const { data: loadedData, error, isLoading, reload } = useAsyncLoad<FriendsData>(async signal => {
        const friendsPromise = api.get<PagedResponse<Profile>>(`/profile/friend/all/${requestedProfileId}/${pages.friends}`, { signal });

        if (!isOwnProfile) {
            return { ...emptyData, friends: await friendsPromise };
        }

        const [friends, incoming, outgoing] = await Promise.all([
            friendsPromise,
            api.get<PagedResponse<Profile>>(`/profile/friend/requests/in/${pages.incoming}`, { signal }),
            api.get<PagedResponse<Profile>>(`/profile/friend/requests/out/${pages.outgoing}`, { signal }),
        ]);

        return { friends, incoming, outgoing };
    }, [api, isOwnProfile, pages, requestedProfileId], { enabled: Boolean(userToken && isValidProfileId) });

    const data = loadedData ?? emptyData;

    const currentPage = data[activeTab];
    const profiles = currentPage.content ?? [];
    const currentTabLabel = useMemo(() => tabs.find(tab => tab.value === activeTab)?.label.toLowerCase() ?? '', [activeTab]);

    const runAction = async (profile: Profile, action: ConfirmAction | 'acceptRequest') => {
        if (pendingProfileId !== null) return;

        const endpoint = action === 'acceptRequest'
            ? `/profile/friend/request/send/${profile.id}`
            : action === 'declineRequest'
                ? `/profile/friend/request/hide/${profile.id}`
                : `/profile/friend/request/remove/${profile.id}`;

        setPendingProfileId(profile.id);
        setActionError(null);
        try {
            await api.get<{ code: number }>(endpoint);
            setConfirmAction(null);
            setActionProfile(null);
            reload();
        } catch (requestError) {
            setActionError(requestError instanceof Error ? requestError.message : 'Не удалось обновить список друзей.');
        } finally {
            setPendingProfileId(null);
        }
    };

    const openConfirm = (profile: Profile, action: ConfirmAction) => {
        setActionError(null);
        setActionProfile(profile);
        setConfirmAction(action);
    };

    if (!userToken || !userId) {
        return <PageLayout>
            <PageHeader title="Друзья" back />
            <PageState status="empty" message="Войдите в аккаунт, чтобы увидеть друзей и заявки." />
            <button type="button" className={styles.loginButton} onClick={() => navigate('/account/login')}>Войти</button>
        </PageLayout>;
    }

    if (!isValidProfileId) {
        return <PageLayout>
            <PageHeader title="Друзья" back />
            <PageState status="error" message="Профиль не найден." />
        </PageLayout>;
    }

    if (isLoading && !loadedData) return <PageLayout><PageHeader title="Друзья" back /><PageState status="loading" message="Загружаем друзей…" /></PageLayout>;
    if (error && !loadedData) return <PageLayout><PageHeader title="Друзья" back /><PageState status="error" message="Не удалось загрузить друзей." onRetry={reload} /></PageLayout>;

    return <PageLayout className={styles.page}>
        <PageHeader
            title={isOwnProfile ? 'Друзья' : 'Друзья пользователя'}
            description={isOwnProfile ? 'Ваши друзья и заявки в друзья' : 'Публичный список друзей профиля'}
            back
            actions={<>
                {isOwnProfile && <div className={styles.tabs} role="tablist" aria-label="Список друзей">
                    {tabs.map(tab => <button
                        type="button"
                        role="tab"
                        key={tab.value}
                        aria-selected={activeTab === tab.value}
                        className={activeTab === tab.value ? styles.tabActive : ''}
                        onClick={() => setActiveTab(tab.value)}
                    >
                        {tab.label}
                        {tab.value !== 'friends' && data[tab.value].total_count > 0 && <span>{data[tab.value].total_count}</span>}
                    </button>)}
                </div>}
                <span className={styles.total}>{data.friends.total_count} {pluralFriends(data.friends.total_count)}</span>
            </>}
        />

        {Boolean(error) && <div className={styles.inlineError} role="alert">Не удалось обновить часть списка. <button type="button" onClick={reload}>Повторить</button></div>}
        {actionError && <div className={styles.inlineError} role="alert">{actionError}</div>}

        {profiles.length === 0 ? <PageState
            status="empty"
            message={activeTab === 'friends'
                ? isOwnProfile ? 'У вас пока нет друзей.' : 'У пользователя пока нет друзей.'
                : `Заявок во вкладке «${currentTabLabel}» нет.`}
            /> : <div className={styles.list}>
            {profiles.map(profile => <FriendCard
                key={profile.id}
                profile={profile}
                tab={activeTab}
                isPending={pendingProfileId === profile.id}
                onAccept={isOwnProfile ? () => void runAction(profile, 'acceptRequest') : undefined}
                onConfirm={isOwnProfile ? openConfirm : undefined}
            />)}
        </div>}

        {currentPage.total_page_count > 0 && <div className={styles.pagination} aria-label="Навигация по страницам">
            <button
                type="button"
                disabled={isLoading || currentPage.current_page <= 0}
                onClick={() => setPages(previous => ({ ...previous, [activeTab]: Math.max(0, currentPage.current_page - 1) }))}
            >Назад</button>
            <span>{currentPage.current_page + 1} / {currentPage.total_page_count + 1}</span>
            <button
                type="button"
                disabled={isLoading || currentPage.current_page >= currentPage.total_page_count}
                onClick={() => setPages(previous => ({ ...previous, [activeTab]: currentPage.current_page + 1 }))}
            >Далее</button>
        </div>}

        <Modal
            isOpen={Boolean(actionProfile && confirmAction)}
            onClose={() => { setActionProfile(null); setConfirmAction(null); }}
            title={confirmAction === 'removeFriend' ? 'Удалить из друзей?' : confirmAction === 'cancelRequest' ? 'Отменить заявку?' : 'Отклонить заявку?'}
        >
            {close => <div className={styles.confirmContent}>
                <p>{confirmAction === 'removeFriend'
                    ? `${actionProfile?.login} будет удалён(а) из списка друзей.`
                    : confirmAction === 'cancelRequest'
                        ? `Пользователь ${actionProfile?.login} больше не увидит вашу заявку.`
                        : `Заявка от ${actionProfile?.login} будет отклонена.`}</p>
                <div className={styles.confirmActions}>
                    <button type="button" onClick={close}>Назад</button>
                    <button
                        type="button"
                        className={styles.dangerButton}
                        disabled={!actionProfile || pendingProfileId !== null}
                        onClick={() => actionProfile && confirmAction && void runAction(actionProfile, confirmAction)}
                    >
                        {pendingProfileId !== null ? 'Загрузка…' : confirmAction === 'removeFriend' ? 'Удалить' : confirmAction === 'cancelRequest' ? 'Отменить заявку' : 'Отклонить'}
                    </button>
                </div>
            </div>}
        </Modal>
    </PageLayout>;
}

type FriendCardProps = {
    profile: Profile;
    tab: FriendsTab;
    isPending: boolean;
    onAccept?: () => void;
    onConfirm?: (profile: Profile, action: ConfirmAction) => void;
};

function FriendCard({ profile, tab, isPending, onAccept, onConfirm }: FriendCardProps) {
    return <article className={styles.card}>
        <Link to={`/account/${profile.id}`} className={styles.profileLink}>
            <div className={styles.avatar}>
                <RemoteImage src={profile.avatar} alt="" />
                {profile.is_online && <span className={styles.online} title="В сети" />}
            </div>
            <div className={styles.profileInfo}>
                <strong>{profile.login}</strong>
                {profile.status && <span>{profile.status}</span>}
                {profile.is_online && <small>В сети</small>}
            </div>
        </Link>
        <div className={styles.cardActions}>
            {tab === 'friends' && onConfirm && <button type="button" disabled={isPending} onClick={() => onConfirm(profile, 'removeFriend')}>Удалить</button>}
            {tab === 'outgoing' && onConfirm && <button type="button" disabled={isPending} onClick={() => onConfirm(profile, 'cancelRequest')}>Отменить заявку</button>}
            {tab === 'incoming' && onAccept && onConfirm && <>
                <button type="button" className={styles.acceptButton} disabled={isPending} onClick={onAccept}>{isPending ? 'Загрузка…' : 'Принять'}</button>
                <button type="button" disabled={isPending} onClick={() => onConfirm(profile, 'declineRequest')}>Отклонить</button>
            </>}
        </div>
    </article>;
}

function pluralFriends(count: number) {
    const remainder = count % 100;
    if (remainder >= 11 && remainder <= 14) return 'друзей';
    const last = count % 10;
    if (last === 1) return 'друг';
    if (last >= 2 && last <= 4) return 'друга';
    return 'друзей';
}
