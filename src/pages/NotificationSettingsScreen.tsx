import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader, PageLayout } from '../components/PageLayout';
import Toggle from '../components/Toggle';
import { Modal } from '../modals/ModalTemplate';
import { useApi } from '../shared/apiClient';
import { useSettings } from '../shared/contexts/settingsContext';
import type { Dub } from '../modals/DubSelectModal';
import type { NotificationsPreferencesAPIResponse } from '../shared/types/api';
import styles from './NotificationSettingsScreen.module.css';

const PROFILE_LISTS = [
    { id: 'favorites', label: 'Избранное' },
    { id: 'watching', label: 'Смотрю' },
    { id: 'planned', label: 'В планах' },
    { id: 'completed', label: 'Просмотрено' },
    { id: 'hold_on', label: 'Отложено' },
    { id: 'dropped', label: 'Брошено' },
];

const STATUS_TO_LIST: Record<NotificationsPreferencesAPIResponse['profileStatusNotificationPreferences'][number]['status'], string> = {
    FAVORITE_STATUS: 'favorites',
    STATUS_WATCHING: 'watching',
    STATUS_PLAN: 'planned',
    STATUS_COMPLETED: 'completed',
    STATUS_HOLD_ON: 'hold_on',
    STATUS_DROPPED: 'dropped',
};

type NotificationMode = 'all' | 'selected_lists' | 'selected_releases';

export default function NotificationSettingsScreen() {
    const api = useApi();
    const { settings, setSettings } = useSettings();
    const [isListsModalOpen, setIsListsModalOpen] = useState(false);
    const [isDubsModalOpen, setIsDubsModalOpen] = useState(false);
    const [draftLists, setDraftLists] = useState<string[]>(settings.notifications.selectedLists ?? []);
    const [draftDubs, setDraftDubs] = useState<Dub[]>(settings.notifications.selectedDubs ?? []);
    const [allDubs, setAllDubs] = useState<Dub[]>([]);
    const [savingToggle, setSavingToggle] = useState<string | null>(null);

    const updateNotifications = (notifications: Partial<typeof settings.notifications>) => {
        setSettings(previous => ({
            ...previous,
            notifications: { ...previous.notifications, ...notifications },
        }));
    };

    const notificationMode = settings.notifications.notificationsType;
    const selectedListsText = useMemo(() => {
        const selected = settings.notifications.selectedLists ?? [];
        if (selected.length === 0) return 'Списки не выбраны';
        return PROFILE_LISTS.filter(list => selected.includes(list.id)).map(list => list.label).join(', ');
    }, [settings.notifications.selectedLists]);

    const selectedDubsText = settings.notifications.selectedDubs?.length
        ? settings.notifications.selectedDubs.map(dub => dub.name).join(', ')
        : 'Все варианты озвучки';

    useEffect(() => {
        if (!isDubsModalOpen || allDubs.length > 0) return;

        void api.get<{ code: number; types: Dub[] }>('/type/all')
            .then(response => setAllDubs(response.types ?? []))
            .catch(() => setAllDubs([]));
    }, [api, allDubs.length, isDubsModalOpen]);

    useEffect(() => {
        let cancelled = false;

        void api.get<NotificationsPreferencesAPIResponse>('/profile/preference/notification/my')
            .then(response => {
                if (cancelled) return;

                const selectedLists = response.profileStatusNotificationPreferences
                    .map(preference => STATUS_TO_LIST[preference.status]);
                const selectedDubs = response.profileTypeNotificationPreferences
                    .map(preference => preference.type);

                setSettings(previous => ({
                    ...previous,
                    notifications: {
                        ...previous.notifications,
                        recieveNotifications: response.is_episode_notifications_enabled,
                        notificationsType: selectedLists.length === PROFILE_LISTS.length ? 'all' : 'selected_lists',
                        selectedLists,
                        selectedDubs,
                        getOnlyOneNotification: response.is_first_episode_notification_enabled,
                        notificationOnRelatedRelease: response.is_related_release_notifications_enabled,
                        repliesNotifications: response.is_comment_notifications_enabled,
                        commentsOnCollectionNotification: response.is_my_collection_comment_notifications_enabled,
                    },
                }));
            })
            .catch(() => undefined);

        return () => { cancelled = true; };
    }, [api, setSettings]);

    const chooseMode = (mode: NotificationMode) => {
        if (mode === 'selected_lists') {
            setDraftLists(settings.notifications.selectedLists ?? []);
            setIsListsModalOpen(true);
            return;
        }

        updateNotifications({ notificationsType: mode });
    };

    const saveLists = () => {
        updateNotifications({
            notificationsType: 'selected_lists',
            selectedLists: draftLists,
        });
    };

    const saveDubs = async () => {
        const body = { profileTypeNotificationPreferences: draftDubs.map(dub => dub.id) };

        try {
            await api.post<{ code: number }>('/profile/preference/notification/type/edit', body);
        } catch {
            return false;
        }

        updateNotifications({ selectedDubs: draftDubs });
        return true;
    };

    const toggleRemoteSetting = async (key: string, endpoint: string, update: () => void) => {
        setSavingToggle(key);

        try {
            await api.get<{ code: number }>(endpoint);
        } catch {
            return;
        } finally {
            setSavingToggle(null);
        }

        update();
    };

    return <PageLayout>
        <PageHeader title="Настройки уведомлений" description="Выберите, о каких событиях вы хотите узнавать." back />

        <SettingsGroup title="Уведомления о сериях">
            <SettingToggle
                title="Получать уведомления"
                description="О выходе новых серий"
                checked={settings.notifications.recieveNotifications}
                disabled={savingToggle === 'episodes'}
                onChange={recieveNotifications => void toggleRemoteSetting(
                    'episodes',
                    '/profile/preference/notification/episode/edit',
                    () => updateNotifications({ recieveNotifications }),
                )}
            />

            {settings.notifications.recieveNotifications && <>
                <div className={styles.modes} aria-label="Режим подписки на серии">
                    <ModeCard label="Из всех моих списков" mode="all" active={notificationMode === 'all'} onClick={() => chooseMode('all')} />
                    <ModeCard label="Из выбранных списков" mode="selected_lists" active={notificationMode === 'selected_lists'} onClick={() => chooseMode('selected_lists')} />
                    <ModeCard label="По выбранным релизам" mode="selected_releases" active={notificationMode === 'selected_releases'} onClick={() => chooseMode('selected_releases')} />
                </div>

                {notificationMode === 'selected_lists' && <button className={styles.summaryButton} type="button" onClick={() => chooseMode('selected_lists')}>
                    <strong>Уведомления из списков</strong>
                    <span>{selectedListsText}</span>
                </button>}
                {notificationMode === 'selected_releases' && <Link className={styles.summaryButton} to="/notifications/releases">
                    <strong>Настроить уведомления по отдельным релизам</strong>
                </Link>}

                <button className={styles.summaryButton} type="button" onClick={() => {
                    setDraftDubs(settings.notifications.selectedDubs ?? []);
                    setIsDubsModalOpen(true);
                }}>
                    <strong>Уведомления от озвучек</strong>
                    <span>{selectedDubsText}</span>
                </button>
                <SettingToggle
                    title="Получать только одно уведомление"
                    description="Только от одной из выбранных озвучек, которая выпустит новую серию первой"
                    checked={settings.notifications.getOnlyOneNotification}
                    disabled={savingToggle === 'first-episode'}
                    onChange={getOnlyOneNotification => void toggleRemoteSetting(
                        'first-episode',
                        '/profile/preference/notification/episode/first/edit',
                        () => updateNotifications({ getOnlyOneNotification }),
                    )}
                />
            </>}
        </SettingsGroup>

        <SettingsGroup title="Уведомления о новых релизах">
            <SettingToggle
                title="Получать уведомления"
                description="Если в приложении будет добавлен связанный релиз, который находится у вас в закладках"
                checked={settings.notifications.notificationOnRelatedRelease}
                disabled={savingToggle === 'related-release'}
                onChange={notificationOnRelatedRelease => void toggleRemoteSetting(
                    'related-release',
                    '/profile/preference/notification/related/release/edit',
                    () => updateNotifications({ notificationOnRelatedRelease }),
                )}
            />
        </SettingsGroup>

        <SettingsGroup title="Уведомления о комментариях">
            <SettingToggle
                title="Уведомления об ответах"
                description="Если кто-то отвечает на ваши комментарии"
                checked={settings.notifications.repliesNotifications}
                disabled={savingToggle === 'comments'}
                onChange={repliesNotifications => void toggleRemoteSetting(
                    'comments',
                    '/profile/preference/notification/comment/edit',
                    () => updateNotifications({ repliesNotifications }),
                )}
            />
            <SettingToggle
                title="Уведомления о комментариях своих коллекций"
                description="Если кто-то комментирует ваши коллекции"
                checked={settings.notifications.commentsOnCollectionNotification}
                disabled={savingToggle === 'collection-comments'}
                onChange={commentsOnCollectionNotification => void toggleRemoteSetting(
                    'collection-comments',
                    '/profile/preference/notification/my/collection/comment/edit',
                    () => updateNotifications({ commentsOnCollectionNotification }),
                )}
            />
        </SettingsGroup>

        <Modal
            isOpen={isListsModalOpen}
            onClose={() => setIsListsModalOpen(false)}
            title="Выберите списки"
            stickyHeader
        >
            {close => <>
                <div className={styles.checkList}>
                    {PROFILE_LISTS.map(list => <label key={list.id}>
                        <input
                            type="checkbox"
                            checked={draftLists.includes(list.id)}
                            onChange={() => setDraftLists(previous => previous.includes(list.id)
                                ? previous.filter(id => id !== list.id)
                                : [...previous, list.id])}
                        />
                        <span>{list.label}</span>
                    </label>)}
                </div>
                <div className={styles.modalActions}>
                    <button type="button" onClick={close}>Отмена</button>
                    <button className={styles.primaryAction} type="button" onClick={() => { saveLists(); close(); }}>Выбрать</button>
                </div>
            </>}
        </Modal>

        <Modal
            isOpen={isDubsModalOpen}
            onClose={() => setIsDubsModalOpen(false)}
            title="Выберите озвучки"
            stickyHeader
        >
            {close => <>
                <div className={styles.checkList}>
                    {allDubs.map(dub => <label key={dub.id}>
                        <input
                            type="checkbox"
                            checked={draftDubs.some(item => item.id === dub.id)}
                            onChange={() => setDraftDubs(previous => previous.some(item => item.id === dub.id)
                                ? previous.filter(item => item.id !== dub.id)
                                : [...previous, dub])}
                        />
                        <span>{dub.name}</span>
                    </label>)}
                    {allDubs.length === 0 && <p className={styles.empty}>Не удалось загрузить варианты озвучки.</p>}
                </div>
                <div className={styles.modalActions}>
                    <button type="button" onClick={close}>Отмена</button>
                    <button className={styles.primaryAction} type="button" onClick={() => void saveDubs().then(saved => { if (saved) close(); })}>Выбрать</button>
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

function ModeCard({ label, mode, active, onClick }: { label: string; mode: NotificationMode; active: boolean; onClick: () => void }) {
    return <button type="button" className={`${styles.modeCard} ${active ? styles.active : ''}`} onClick={onClick}>
        <span className={`${styles.preview} ${styles[mode]}`} aria-hidden="true"><i /><i /><i /><i /></span>
        <span>{label}</span>
    </button>;
}
