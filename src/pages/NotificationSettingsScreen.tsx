import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader, PageLayout } from '../components/PageLayout';
import Toggle from '../components/Toggle';
import { Modal } from '../modals/ModalTemplate';
import { useApi } from '../shared/apiClient';
import { useTranslation } from '../shared/useTranslation';
import { useSettings } from '../shared/contexts/settingsContext';
import type { Dub } from '../modals/DubSelectModal';
import type { NotificationsPreferencesAPIResponse } from '../shared/types/api';
import styles from './NotificationSettingsScreen.module.css';

const PROFILE_LISTS = [
    { id: 'favorites' },
    { id: 'watching' },
    { id: 'planned' },
    { id: 'completed' },
    { id: 'hold_on' },
    { id: 'dropped' },
] as const;

const STATUS_TO_LIST: Record<NotificationsPreferencesAPIResponse['profileStatusNotificationPreferences'][number]['status'], string> = {
    FAVORITE_STATUS: 'favorites',
    STATUS_WATCHING: 'watching',
    STATUS_PLAN: 'planned',
    STATUS_COMPLETED: 'completed',
    STATUS_HOLD_ON: 'hold_on',
    STATUS_DROPPED: 'dropped',
};

const LIST_TO_STATUS: Record<string, number> = {
    favorites: 0,
    watching: 1,
    planned: 2,
    completed: 3,
    hold_on: 4,
    dropped: 5,
};

type NotificationMode = 'all' | 'selected_lists' | 'selected_releases';

export default function NotificationSettingsScreen() {
    const api = useApi();
    const { t } = useTranslation();
    const { settings, setSettings } = useSettings();
    const [isListsModalOpen, setIsListsModalOpen] = useState(false);
    const [isDubsModalOpen, setIsDubsModalOpen] = useState(false);
    const [draftLists, setDraftLists] = useState<string[]>(settings.notifications.selectedLists ?? []);
    const [draftDubs, setDraftDubs] = useState<Dub[]>(settings.notifications.selectedDubs ?? []);
    const [allDubs, setAllDubs] = useState<Dub[]>([]);
    const [savingToggle, setSavingToggle] = useState<string | null>(null);
    const [saveError, setSaveError] = useState<string | null>(null);
    const [loadState, setLoadState] = useState<'loading' | 'loaded' | 'error'>('loading');
    const [loadAttempt, setLoadAttempt] = useState(0);
    const [dubsState, setDubsState] = useState<'idle' | 'loading' | 'loaded' | 'error'>('idle');
    const [dubsAttempt, setDubsAttempt] = useState(0);
    const [dubsSaveError, setDubsSaveError] = useState<string | null>(null);
    const saving = useRef(false);
    const editsDisabled = loadState !== 'loaded' || savingToggle !== null;

    const updateNotifications = (notifications: Partial<typeof settings.notifications>) => {
        setSettings(previous => ({
            ...previous,
            notifications: { ...previous.notifications, ...notifications },
        }));
    };

    const notificationMode = settings.notifications.notificationsType;
    const selectedListsText = useMemo(() => {
        const selected = settings.notifications.selectedLists ?? [];
        if (selected.length === 0) return t('notificationSettings.noLists');
        return PROFILE_LISTS.filter(list => selected.includes(list.id)).map(list => t(`notificationSettings.list.${list.id}` as const)).join(', ');
    }, [settings.notifications.selectedLists, t]);

    const selectedDubsText = settings.notifications.selectedDubs?.length
        ? settings.notifications.selectedDubs.map(dub => dub.name).join(', ')
        : t('notificationSettings.allDubs');

    useEffect(() => {
        if (!isDubsModalOpen) return;
        let cancelled = false;
        void api.get<{ code: number; types: Dub[] }>('/type/all')
            .then(response => {
                if (cancelled) return;
                setAllDubs(response.types ?? []);
                setDubsState('loaded');
            })
            .catch(() => { if (!cancelled) setDubsState('error'); });
        return () => { cancelled = true; };
    }, [api, dubsAttempt, isDubsModalOpen]);

    useEffect(() => {
        let cancelled = false;

        void api.get<NotificationsPreferencesAPIResponse>('/profile/preference/notification/my')
            .then(response => {
                if (cancelled) return;

                const selectedLists = response.profileStatusNotificationPreferences
                    .map(preference => STATUS_TO_LIST[preference.status]);
                const selectedDubs = response.profileTypeNotificationPreferences
                    .map(preference => preference.type);

                setLoadState('loaded');
                setSettings(previous => ({
                    ...previous,
                    notifications: {
                        ...previous.notifications,
                        recieveNotifications: response.is_episode_notifications_enabled,
                        notificationsType: response.is_release_type_notifications_enabled
                            ? 'selected_releases'
                            : selectedLists.length === PROFILE_LISTS.length ? 'all' : 'selected_lists',
                        selectedLists,
                        selectedDubs,
                        getOnlyOneNotification: response.is_first_episode_notification_enabled,
                        notificationOnRelatedRelease: response.is_related_release_notifications_enabled,
                        repliesNotifications: response.is_comment_notifications_enabled,
                        commentsOnCollectionNotification: response.is_my_collection_comment_notifications_enabled,
                    },
                }));
            })
            .catch(() => { if (!cancelled) setLoadState('error'); });

        return () => { cancelled = true; };
    }, [api, loadAttempt, setSettings]);

    const saveStatuses = async (mode: Exclude<NotificationMode, 'selected_releases'>, selectedLists: string[]) => {
        if (loadState !== 'loaded' || saving.current) return false;
        saving.current = true;
        const profileStatusNotificationPreferences = mode === 'all'
            ? [0, 1, 2, 3, 4, 5]
            : selectedLists.map(list => LIST_TO_STATUS[list]).filter((status): status is number => status !== undefined);

        setSavingToggle('statuses');
        setSaveError(null);
        try {
            await api.post<{ code: number }>('/profile/preference/notification/status/edit', { profileStatusNotificationPreferences });
            updateNotifications({ notificationsType: mode, selectedLists });
            return true;
        } catch {
            setSaveError(t('notificationSettings.saveError'));
            return false;
        } finally {
            saving.current = false;
            setSavingToggle(null);
        }
    };

    const chooseMode = (mode: NotificationMode) => {
        if (editsDisabled || saving.current) return;
        if (mode === 'selected_lists') {
            setDraftLists(settings.notifications.selectedLists ?? []);
            setIsListsModalOpen(true);
            return;
        }

        if (mode === 'all') {
            void saveStatuses('all', PROFILE_LISTS.map(list => list.id));
            return;
        }

        saving.current = true;
        setSavingToggle('statuses');
        setSaveError(null);
        void api.get<{ code: number }>('/profile/preference/notification/selected/releases/edit')
            .then(() => updateNotifications({ notificationsType: 'selected_releases' }))
            .catch(() => setSaveError(t('notificationSettings.saveError')))
            .finally(() => { saving.current = false; setSavingToggle(null); });
    };

    const saveLists = () => saveStatuses('selected_lists', draftLists);

    const saveDubs = async () => {
        if (loadState !== 'loaded' || dubsState !== 'loaded' || saving.current) return false;
        saving.current = true;
        setSavingToggle('dubs');
        setDubsSaveError(null);
        try {
            await api.post<{ code: number }>('/profile/preference/notification/type/edit', {
                profileTypeNotificationPreferences: draftDubs.map(dub => dub.id),
            });
            updateNotifications({ selectedDubs: draftDubs });
            return true;
        } catch {
            setDubsSaveError(t('notificationSettings.saveError'));
            return false;
        } finally {
            saving.current = false;
            setSavingToggle(null);
        }
    };

    const toggleRemoteSetting = async (key: string, endpoint: string, update: () => void) => {
        if (loadState !== 'loaded' || saving.current) return;
        saving.current = true;
        setSavingToggle(key);
        setSaveError(null);

        try {
            await api.get<{ code: number }>(endpoint);
        } catch (error) {
            console.error('Failed to save notification setting', error);
            setSaveError(t('notificationSettings.saveError'));
            return;
        } finally {
            saving.current = false;
            setSavingToggle(null);
        }

        update();
    };

    return <PageLayout>
        <PageHeader title={t('notificationSettings.title')} description={t('notificationSettings.description')} back />

        {loadState === 'loading' && <p role="status">{t('page.loading')}</p>}
        {loadState === 'error' && <div>
            <p className={styles.saveError} role="alert">{t('ux.preferencesLoadError')}</p>
            <p>{t('ux.cachedPreferences')}</p>
            <button type="button" onClick={() => { setLoadState('loading'); setLoadAttempt(value => value + 1); }}>{t('page.retry')}</button>
        </div>}
        {saveError && <p className={styles.saveError} role="alert">{saveError}</p>}

        <SettingsGroup title={t('notificationSettings.episodes')}>
            <SettingToggle
                title={t('notificationSettings.receive')}
                description={t('notificationSettings.newEpisodes')}
                checked={settings.notifications.recieveNotifications}
                disabled={editsDisabled}
                onChange={recieveNotifications => void toggleRemoteSetting(
                    'episodes',
                    '/profile/preference/notification/episode/edit',
                    () => updateNotifications({ recieveNotifications }),
                )}
            />

            {settings.notifications.recieveNotifications && <>
                <div className={styles.modes} aria-label={t('notificationSettings.modeAria')}>
                    <ModeCard label={t('notificationSettings.modeAll')} mode="all" active={notificationMode === 'all'} disabled={editsDisabled} onClick={() => chooseMode('all')} />
                    <ModeCard label={t('notificationSettings.modeLists')} mode="selected_lists" active={notificationMode === 'selected_lists'} disabled={editsDisabled} onClick={() => chooseMode('selected_lists')} />
                    <ModeCard label={t('notificationSettings.modeReleases')} mode="selected_releases" active={notificationMode === 'selected_releases'} disabled={editsDisabled} onClick={() => chooseMode('selected_releases')} />
                </div>

                {notificationMode === 'selected_lists' && <button className={styles.summaryButton} type="button" disabled={editsDisabled} onClick={() => chooseMode('selected_lists')}>
                    <strong>{t('notificationSettings.listsSummary')}</strong>
                    <span>{selectedListsText}</span>
                </button>}
                {notificationMode === 'selected_releases' && loadState === 'loaded' && <Link className={styles.summaryButton} to="/notifications/releases">
                    <strong>{t('notificationSettings.configureReleases')}</strong>
                </Link>}

                <button className={styles.summaryButton} type="button" disabled={editsDisabled} onClick={() => {
                    setDraftDubs(settings.notifications.selectedDubs ?? []);
                    setDubsSaveError(null);
                    setDubsState('loading');
                    setIsDubsModalOpen(true);
                }}>
                    <strong>{t('notificationSettings.dubs')}</strong>
                    <span>{selectedDubsText}</span>
                </button>
                <SettingToggle
                    title={t('notificationSettings.onlyOne')}
                    description={t('notificationSettings.onlyOneDescription')}
                    checked={settings.notifications.getOnlyOneNotification}
                    disabled={editsDisabled}
                    onChange={getOnlyOneNotification => void toggleRemoteSetting(
                        'first-episode',
                        '/profile/preference/notification/episode/first/edit',
                        () => updateNotifications({ getOnlyOneNotification }),
                    )}
                />
            </>}
        </SettingsGroup>

        <SettingsGroup title={t('notificationSettings.related')}>
            <SettingToggle
                title={t('notificationSettings.receive')}
                description={t('notificationSettings.relatedDescription')}
                checked={settings.notifications.notificationOnRelatedRelease}
                disabled={editsDisabled}
                onChange={notificationOnRelatedRelease => void toggleRemoteSetting(
                    'related-release',
                    '/profile/preference/notification/related/release/edit',
                    () => updateNotifications({ notificationOnRelatedRelease }),
                )}
            />
        </SettingsGroup>

        <SettingsGroup title={t('notificationSettings.comments')}>
            <SettingToggle
                title={t('notificationSettings.replies')}
                description={t('notificationSettings.repliesDescription')}
                checked={settings.notifications.repliesNotifications}
                disabled={editsDisabled}
                onChange={repliesNotifications => void toggleRemoteSetting(
                    'comments',
                    '/profile/preference/notification/comment/edit',
                    () => updateNotifications({ repliesNotifications }),
                )}
            />
            <SettingToggle
                title={t('notificationSettings.collectionComments')}
                description={t('notificationSettings.collectionCommentsDescription')}
                checked={settings.notifications.commentsOnCollectionNotification}
                disabled={editsDisabled}
                onChange={commentsOnCollectionNotification => void toggleRemoteSetting(
                    'collection-comments',
                    '/profile/preference/notification/my/collection/comment/edit',
                    () => updateNotifications({ commentsOnCollectionNotification }),
                )}
            />
        </SettingsGroup>

        <Modal
            isOpen={isListsModalOpen}
            onClose={() => { if (!saving.current) setIsListsModalOpen(false); }}
            title={t('notificationSettings.selectLists')}
            stickyHeader
        >
            {close => <>
                {saveError && <p className={styles.saveError} role="alert">{saveError}</p>}
                <div className={styles.checkList}>
                    {PROFILE_LISTS.map(list => <label key={list.id}>
                        <input
                            type="checkbox"
                            disabled={editsDisabled}
                            checked={draftLists.includes(list.id)}
                            onChange={() => setDraftLists(previous => previous.includes(list.id)
                                ? previous.filter(id => id !== list.id)
                                : [...previous, list.id])}
                        />
                        <span>{t(`notificationSettings.list.${list.id}` as const)}</span>
                    </label>)}
                </div>
                <div className={styles.modalActions}>
                    <button type="button" disabled={savingToggle !== null} onClick={close}>{t('notificationSettings.cancel')}</button>
                    <button className={styles.primaryAction} type="button" disabled={editsDisabled} onClick={() => void saveLists().then(saved => { if (saved) close(); })}>{t('notificationSettings.select')}</button>
                </div>
            </>}
        </Modal>

        <Modal
            isOpen={isDubsModalOpen}
            onClose={() => { if (!saving.current) setIsDubsModalOpen(false); }}
            title={t('notificationSettings.selectDubs')}
            stickyHeader
        >
            {close => <>
                {dubsSaveError && <p className={styles.saveError} role="alert">{dubsSaveError}</p>}
                {dubsState === 'loading' && <p role="status">{t('page.loading')}</p>}
                {dubsState === 'error' && <div>
                    <p className={styles.saveError} role="alert">{t('notificationSettings.dubsError')}</p>
                    <button type="button" onClick={() => { setDubsState('loading'); setDubsAttempt(value => value + 1); }}>{t('page.retry')}</button>
                </div>}
                <div className={styles.checkList}>
                    {dubsState === 'loaded' && allDubs.map(dub => <label key={dub.id}>
                        <input
                            type="checkbox"
                            disabled={editsDisabled}
                            checked={draftDubs.some(item => item.id === dub.id)}
                            onChange={() => setDraftDubs(previous => previous.some(item => item.id === dub.id)
                                ? previous.filter(item => item.id !== dub.id)
                                : [...previous, dub])}
                        />
                        <span>{dub.name}</span>
                    </label>)}
                    {dubsState === 'loaded' && allDubs.length === 0 && <p className={styles.empty} role="status">{t('page.empty')}</p>}
                </div>
                <div className={styles.modalActions}>
                    <button type="button" disabled={savingToggle !== null} onClick={close}>{t('notificationSettings.cancel')}</button>
                    <button className={styles.primaryAction} type="button" disabled={editsDisabled || dubsState !== 'loaded'} onClick={() => void saveDubs().then(saved => { if (saved) close(); })}>{t('notificationSettings.select')}</button>
                </div>
            </>}
        </Modal>
    </PageLayout>;
}

function SettingsGroup({ title, children }: { title: string; children: ReactNode }) {
    return <section className={styles.group}>
        <h2>{title}</h2>
        {children}
    </section>;
}

function SettingToggle({ title, description, checked, disabled = false, onChange }: {
    title: string;
    description: string;
    checked: boolean;
    disabled?: boolean;
    onChange: (checked: boolean) => void;
}) {
    return <div className={styles.toggleRow}>
        <div><h3>{title}</h3><p>{description}</p></div>
        <Toggle checked={checked} disabled={disabled} onChange={onChange} label={title} />
    </div>;
}

function ModeCard({ label, mode, active, disabled, onClick }: { label: string; mode: NotificationMode; active: boolean; disabled: boolean; onClick: () => void }) {
    return <button type="button" className={`${styles.modeCard} ${active ? styles.active : ''}`} disabled={disabled} onClick={onClick}>
        <span className={`${styles.preview} ${styles[mode]}`} aria-hidden="true"><i /><i /><i /><i /></span>
        <span>{label}</span>
    </button>;
}
