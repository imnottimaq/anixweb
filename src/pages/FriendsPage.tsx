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
import { useTranslation } from '../shared/useTranslation';

type FriendsTab = 'friends' | 'incoming' | 'outgoing';
type ConfirmAction = 'removeFriend' | 'cancelRequest' | 'declineRequest';

type FriendsData = Record<FriendsTab, PagedResponse<Profile>>;

const tabKeys: Record<FriendsTab, 'friends.tab.friends' | 'friends.tab.incoming' | 'friends.tab.outgoing'> = { friends: 'friends.tab.friends', incoming: 'friends.tab.incoming', outgoing: 'friends.tab.outgoing' };

const emptyPage: PagedResponse<Profile> = { code: 0, content: [], total_count: 0, total_page_count: 0, current_page: 0 };
const emptyData: FriendsData = { friends: emptyPage, incoming: emptyPage, outgoing: emptyPage };

export default function FriendsPage() {
    const api = useApi();
    const { t, formatNumber, selectPlural } = useTranslation();
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
    const tabs = useMemo(() => (Object.keys(tabKeys) as FriendsTab[]).map(value => ({ value, label: t(tabKeys[value]) })), [t]);
    const currentTabLabel = t(tabKeys[activeTab]).toLocaleLowerCase();

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
            console.error('Friend action failed:', requestError);
            setActionError(t('friends.actionError'));
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
            <PageHeader title={t('friends.title')} back />
            <PageState status="empty" message={t('friends.signInRequired')} />
            <button type="button" className={styles.loginButton} onClick={() => navigate('/account/login')}>{t('auth.login')}</button>
        </PageLayout>;
    }

    if (!isValidProfileId) {
        return <PageLayout>
            <PageHeader title={t('friends.title')} back />
            <PageState status="error" message={t('account.notFound')} />
        </PageLayout>;
    }

    if (isLoading && !loadedData) return <PageLayout><PageHeader title={t('friends.title')} back /><PageState status="loading" message={t('friends.loading')} /></PageLayout>;
    if (error && !loadedData) return <PageLayout><PageHeader title={t('friends.title')} back /><PageState status="error" message={t('friends.loadError')} onRetry={reload} /></PageLayout>;

    return <PageLayout className={styles.page}>
        <PageHeader
            title={isOwnProfile ? t('friends.title') : t('friends.userTitle')}
            description={isOwnProfile ? t('friends.description') : t('friends.userDescription')}
            back
            actions={<>
                {isOwnProfile && <div className={styles.tabs} role="tablist" aria-label={t('friends.listAria')}>
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
                <span className={styles.total}>{t(`friends.count.${selectPlural(data.friends.total_count)}` as 'friends.count.one', { count: formatNumber(data.friends.total_count) })}</span>
            </>}
        />

        {Boolean(error) && <div className={styles.inlineError} role="alert">{t('friends.partialError')} <button type="button" onClick={reload}>{t('page.retry')}</button></div>}
        {actionError && <div className={styles.inlineError} role="alert">{actionError}</div>}

        {profiles.length === 0 ? <PageState
            status="empty"
            message={activeTab === 'friends'
                ? isOwnProfile ? t('friends.emptyOwn') : t('friends.emptyUser')
                : t('friends.emptyTab', { tab: currentTabLabel })}
            /> : <div className={styles.list}>
            {profiles.map(profile => <FriendCard
                t={t}
                key={profile.id}
                profile={profile}
                tab={activeTab}
                isPending={pendingProfileId === profile.id}
                onAccept={isOwnProfile ? () => void runAction(profile, 'acceptRequest') : undefined}
                onConfirm={isOwnProfile ? openConfirm : undefined}
            />)}
        </div>}

        {currentPage.total_page_count > 0 && <div className={styles.pagination} aria-label={t('friends.paginationAria')}>
            <button
                type="button"
                disabled={isLoading || currentPage.current_page <= 0}
                onClick={() => setPages(previous => ({ ...previous, [activeTab]: Math.max(0, currentPage.current_page - 1) }))}
            >{t('page.back')}</button>
            <span>{currentPage.current_page + 1} / {currentPage.total_page_count + 1}</span>
            <button
                type="button"
                disabled={isLoading || currentPage.current_page >= currentPage.total_page_count}
                onClick={() => setPages(previous => ({ ...previous, [activeTab]: currentPage.current_page + 1 }))}
            >{t('friends.next')}</button>
        </div>}

        <Modal
            isOpen={Boolean(actionProfile && confirmAction)}
            onClose={() => { setActionProfile(null); setConfirmAction(null); }}
            title={t(confirmAction === 'removeFriend' ? 'friends.removeTitle' : confirmAction === 'cancelRequest' ? 'friends.cancelTitle' : 'friends.declineTitle')}
        >
            {close => <div className={styles.confirmContent}>
                <p>{confirmAction === 'removeFriend'
                    ? t('friends.removeConfirm', { login: actionProfile?.login })
                    : confirmAction === 'cancelRequest'
                        ? t('friends.cancelConfirm', { login: actionProfile?.login })
                        : t('friends.declineConfirm', { login: actionProfile?.login })}</p>
                <div className={styles.confirmActions}>
                    <button type="button" onClick={close}>{t('page.back')}</button>
                    <button
                        type="button"
                        className={styles.dangerButton}
                        disabled={!actionProfile || pendingProfileId !== null}
                        onClick={() => actionProfile && confirmAction && void runAction(actionProfile, confirmAction)}
                    >
                        {pendingProfileId !== null ? t('page.loading') : t(confirmAction === 'removeFriend' ? 'misc.remove' : confirmAction === 'cancelRequest' ? 'friends.cancelRequest' : 'friends.decline')}
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
    t: ReturnType<typeof useTranslation>['t'];
    onConfirm?: (profile: Profile, action: ConfirmAction) => void;
};

function FriendCard({ profile, tab, isPending, onAccept, onConfirm, t }: FriendCardProps) {
    return <article className={styles.card}>
        <Link to={`/account/${profile.id}`} className={styles.profileLink}>
            <div className={styles.avatar}>
                <RemoteImage src={profile.avatar} alt="" />
                {profile.is_online && <span className={styles.online} title={t('friends.online')} />}
            </div>
            <div className={styles.profileInfo}>
                <strong>{profile.login}</strong>
                {profile.status && <span>{profile.status}</span>}
                {profile.is_online && <small>{t('friends.online')}</small>}
            </div>
        </Link>
        <div className={styles.cardActions}>
            {tab === 'friends' && onConfirm && <button type="button" disabled={isPending} onClick={() => onConfirm(profile, 'removeFriend')}>{t('misc.remove')}</button>}
            {tab === 'outgoing' && onConfirm && <button type="button" disabled={isPending} onClick={() => onConfirm(profile, 'cancelRequest')}>{t('friends.cancelRequest')}</button>}
            {tab === 'incoming' && onAccept && onConfirm && <>
                <button type="button" className={styles.acceptButton} disabled={isPending} onClick={onAccept}>{isPending ? t('page.loading') : t('friends.accept')}</button>
                <button type="button" disabled={isPending} onClick={() => onConfirm(profile, 'declineRequest')}>{t('friends.decline')}</button>
            </>}
        </div>
    </article>;
}
