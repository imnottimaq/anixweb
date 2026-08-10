import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import RemoteImage from '../components/RemoteImage';
import { useApi } from '../shared/apiClient';
import type { AnixartNotification, NotificationProfile } from '../shared/types/api';
import SettingsIcon from '../assets/icons/gear.svg';
import styles from './NotificationsScreen.module.css';

type NotificationFilter = 'all' | 'episode' | 'comments' | 'friend' | 'collection';

const FILTERS: Array<{ value: NotificationFilter; label: string }> = [
    { value: 'all', label: 'Все уведомления' },
    { value: 'episode', label: 'Новые эпизоды' },
    { value: 'comments', label: 'Комментарии' },
    { value: 'friend', label: 'Друзья' },
    { value: 'collection', label: 'Коллекции' },
];

export default function NotificationsScreen() {
    const api = useApi();
    const [notifications, setNotifications] = useState<AnixartNotification[]>([]);
    const [filter, setFilter] = useState<NotificationFilter>('all');
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        let wasMarkedAsRead = false;
        setIsLoading(true);
        setError(null);

        const markAsRead = api.get<{ code: number }>('/notification/read')
            .then(() => {
                wasMarkedAsRead = true;
                if (!cancelled) {
                    setNotifications(current => current.map(notification => ({ ...notification, is_new: false })));
                }
            })
            .catch(() => undefined);

        void api.get<{ code: number; content: AnixartNotification[] }>('/notification/all/0')
            .then(data => {
                if (!cancelled) {
                    setNotifications(wasMarkedAsRead
                        ? data.content.map(notification => ({ ...notification, is_new: false }))
                        : data.content);
                }
            })
            .catch(requestError => {
                if (!cancelled) setError(requestError instanceof Error ? requestError.message : 'Не удалось загрузить уведомления');
            })
            .finally(() => { if (!cancelled) setIsLoading(false); });

        void markAsRead;

        return () => { cancelled = true; };
    }, [api]);

    const visibleNotifications = useMemo(() => notifications.filter(notification => {
        if (filter === 'all') return true;
        if (filter === 'episode') return notification.type === 'episode';
        if (filter === 'friend') return notification.type === 'friend';
        if (filter === 'collection') return notification.type === 'myCollection';
        return notification.type === 'releaseComment';
    }), [filter, notifications]);

    return <section className={styles.page}>
        <header className={styles.header}>
            <div className={styles.headerCopy}>
                <h1>Уведомления</h1>
                <div className={styles.headerMeta}>
                    <p>Всё важное по твоим релизам и активности.</p>
                    <label className={styles.filter}>
                        <select value={filter} onChange={event => setFilter(event.target.value as NotificationFilter)}>
                            {FILTERS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
                        </select>
                    </label>
                </div>
            </div>
            <div className={styles.actions}>
                <Link className={styles.settingsLink} to="/notifications/settings" aria-label="Настройки уведомлений" title="Настройки уведомлений"><img src={SettingsIcon} alt="" /></Link>
            </div>
        </header>

        {isLoading && <p className={styles.message}>Загружаем уведомления…</p>}
        {error && <p className={`${styles.message} ${styles.error}`}>{error}</p>}
        {!isLoading && !error && visibleNotifications.length === 0 && <p className={styles.message}>Здесь пока ничего нет.</p>}

        <div className={styles.list}>
            {visibleNotifications.map(notification => <NotificationItem key={`${notification.type}-${notification.id}`} notification={notification} />)}
        </div>
    </section>;
}

function NotificationItem({ notification }: { notification: AnixartNotification }) {
    if (notification.type === 'episode') {
        const { episode } = notification;
        return <NotificationRow
            notification={notification}
            image={episode.release.image}
            to={`/anime/${episode.release.id}`}
            text={<><b>Вышла «{episode.name}»</b> релиза <b>«{episode.release.title_ru}»</b> в варианте <b>«{episode.source.type?.name ?? episode.source.name}»</b> на источнике «{episode.source.name}»</>}
        />;
    }

    if (notification.type === 'releaseComment') {
        const comment = notification.comment;
        const parentComment = notification.parentComment;
        const release = comment?.release ?? parentComment?.release;
        const profile = comment?.profile;
        return <NotificationRow
            notification={notification}
            profile={profile}
            to={release ? `/anime/${release.id}` : undefined}
            text={<>{parentComment ? 'Новый ответ от пользователя' : 'Новый комментарий от пользователя'} <b>{profile?.login ?? 'пользователя'}</b>: {comment?.message ?? ''}</>}
        />;
    }

    if (notification.type === 'friend') {
        const status = notification.status === 'REQUEST' ? 'хочет внести вас в список друзей' : 'обновил статус дружбы';
        return <NotificationRow notification={notification} profile={notification.by_profile} to={`/account/${notification.by_profile.id}`} text={<><b>{notification.by_profile.login}</b> {status}</>} />;
    }

    if (notification.type === 'myCollection') {
        const { collection_comment: comment } = notification;
        return <NotificationRow
            notification={notification}
            profile={comment.profile}
            text={<>Новый комментарий к вашей коллекции <b>{comment.collection.title}</b> от пользователя <b>{comment.profile?.login ?? 'пользователя'}</b>: {comment.message}</>}
        />;
    }

    return <NotificationRow notification={notification} text="Новое уведомление" />;
}

function NotificationRow({ notification, text, image, profile, to }: {
    notification: AnixartNotification;
    text: ReactNode;
    image?: string | null;
    profile?: NotificationProfile;
    to?: string;
}) {
    const content = <>
        <span className={styles.avatar}>{image ? <RemoteImage src={image} alt="" /> : profile?.avatar ? <RemoteImage src={profile.avatar} alt="" /> : <span>✦</span>}</span>
        <span className={styles.content}><span className={styles.text}>{text}</span><time>{formatRelativeTime(notification.timestamp)}</time></span>
        {notification.is_new && <span className={styles.dot} aria-label="Новое" />}
    </>;

    return to ? <Link className={styles.notification} to={to}>{content}</Link> : <article className={styles.notification}>{content}</article>;
}

function formatRelativeTime(timestamp: number) {
    const seconds = Math.max(0, Math.floor(Date.now() / 1000) - timestamp);
    if (seconds < 60) return 'Только что';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes} мин назад`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} ч назад`;
    const days = Math.floor(hours / 24);
    return `${days} дн назад`;
}
