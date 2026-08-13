import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import RemoteImage from '../components/RemoteImage';
import { PageHeader, PageLayout } from '../components/PageLayout';
import PageState from '../components/PageState';
import { useApi } from '../shared/apiClient';
import { useTranslation, type TranslationParams } from '../shared/useTranslation';
import type { TranslationKey } from '../shared/i18n';
import type { AnixartNotification, NotificationProfile } from '../shared/types/api';
import SettingsIcon from '../assets/icons/gear.svg';
import styles from './NotificationsScreen.module.css';

type NotificationFilter = 'all' | 'episode' | 'comments' | 'friend' | 'collection';
const FILTERS: NotificationFilter[] = ['all', 'episode', 'comments', 'friend', 'collection'];
type T = (key: TranslationKey, params?: TranslationParams) => string;

export default function NotificationsScreen() {
    const api = useApi();
    const { t, language, formatRelativeTime } = useTranslation();
    const [notifications, setNotifications] = useState<AnixartNotification[]>([]);
    const [filter, setFilter] = useState<NotificationFilter>('all');
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(false);
    const [loadAttempt, setLoadAttempt] = useState(0);

    useEffect(() => {
        let cancelled = false;
        let wasMarkedAsRead = false;
        void api.get<{ code: number }>('/notification/read').then(() => {
            wasMarkedAsRead = true;
            if (!cancelled) setNotifications(current => current.map(item => ({ ...item, is_new: false })));
        }).catch(error => console.error('Failed to mark notifications as read', error));
        void api.get<{ code: number; content: AnixartNotification[] }>('/notification/all/0').then(data => {
            if (!cancelled) setNotifications(wasMarkedAsRead ? data.content.map(item => ({ ...item, is_new: false })) : data.content);
        }).catch(requestError => {
            console.error('Failed to load notifications', requestError);
            if (!cancelled) setError(true);
        }).finally(() => { if (!cancelled) setIsLoading(false); });
        return () => { cancelled = true; };
    }, [api, loadAttempt]);

    const visible = useMemo(() => notifications.filter(item => filter === 'all' ||
        (filter === 'episode' && item.type === 'episode') || (filter === 'friend' && item.type === 'friend') ||
        (filter === 'collection' && item.type === 'myCollection') || (filter === 'comments' && item.type === 'releaseComment')), [filter, notifications]);

    return <PageLayout>
        <PageHeader title={t('notifications.title')} description={t('notifications.description')} actions={<>
            <label className={styles.filter}><span className={styles.visuallyHidden}>{t('notifications.filterAria')}</span>
                <select value={filter} onChange={event => setFilter(event.target.value as NotificationFilter)}>
                    {FILTERS.map(value => <option key={value} value={value}>{t(`notifications.filter.${value}` as TranslationKey)}</option>)}
                </select>
            </label>
            <Link className={styles.settingsLink} to="/notifications/settings" aria-label={t('notifications.settings')} title={t('notifications.settings')}><img src={SettingsIcon} alt="" /></Link>
        </>} />
        {isLoading && <PageState status="loading" message={t('notifications.loading')} />}
        {!isLoading && error && <PageState status="error" message={t('notifications.error')} onRetry={() => { setIsLoading(true); setError(false); setLoadAttempt(value => value + 1); }} />}
        {!isLoading && !error && visible.length === 0 && <PageState status="empty" message={t('notifications.empty')} />}
        {!isLoading && !error && <div className={styles.list}>{visible.map(item => <NotificationItem key={`${item.type}-${item.id}`} notification={item} t={t} language={language} relative={formatRelativeTime} />)}</div>}
    </PageLayout>;
}

function NotificationItem({ notification, t, language, relative }: { notification: AnixartNotification; t: T; language: string; relative: (value: number, unit?: Intl.RelativeTimeFormatUnit) => string }) {
    if (notification.type === 'episode') {
        const { episode } = notification;
        const title = language === 'english' ? episode.release.title_original || episode.release.title_ru : episode.release.title_ru || episode.release.title_original;
        return <NotificationRow notification={notification} image={episode.release.image} imageAlt={t('notifications.releaseImageAlt', { title })} to={`/anime/${episode.release.id}`} text={t('notifications.episode', { episode: episode.name, release: title, dub: episode.source.type?.name ?? episode.source.name, source: episode.source.name })} t={t} relative={relative} />;
    }
    if (notification.type === 'releaseComment') {
        const comment = notification.comment; const parent = notification.parentComment; const release = comment?.release ?? parent?.release; const profile = comment?.profile;
        return <NotificationRow notification={notification} profile={profile} to={release ? `/anime/${release.id}` : undefined} text={t(parent ? 'notifications.reply' : 'notifications.comment', { user: profile?.login ?? t('notifications.unknownUser'), message: comment?.message ?? '' })} t={t} relative={relative} />;
    }
    if (notification.type === 'friend') return <NotificationRow notification={notification} profile={notification.by_profile} to={`/account/${notification.by_profile.id}`} text={t(notification.status === 'REQUEST' ? 'notifications.friendRequest' : 'notifications.friendUpdate', { user: notification.by_profile.login })} t={t} relative={relative} />;
    if (notification.type === 'myCollection') { const comment = notification.collection_comment; return <NotificationRow notification={notification} profile={comment.profile} to={`/collection/${comment.collection.id}`} text={t('notifications.collectionComment', { collection: comment.collection.title, user: comment.profile?.login ?? t('notifications.unknownUser'), message: comment.message })} t={t} relative={relative} />; }
    return <NotificationRow notification={notification} text={t('notifications.unknown')} t={t} relative={relative} />;
}

function NotificationRow({ notification, text, image, imageAlt = '', profile, to, t, relative }: { notification: AnixartNotification; text: string; image?: string | null; imageAlt?: string; profile?: NotificationProfile; to?: string; t: T; relative: (value: number, unit?: Intl.RelativeTimeFormatUnit) => string }) {
    const [now] = useState(Date.now);
    const seconds = Math.max(0, Math.floor(now / 1000) - notification.timestamp);
    const time = seconds < 45 ? t('notifications.justNow') : seconds < 3600 ? relative(-Math.round(seconds / 60), 'minute') : seconds < 86400 ? relative(-Math.round(seconds / 3600), 'hour') : relative(-Math.round(seconds / 86400), 'day');
    const content = <><span className={styles.avatar}>{image ? <RemoteImage src={image} alt={imageAlt} /> : profile?.avatar ? <RemoteImage src={profile.avatar} alt={t('notifications.avatarAlt', { user: profile.login })} /> : <span aria-hidden="true">✦</span>}</span><span className={styles.content}><span className={styles.text}>{text}</span><time dateTime={new Date(notification.timestamp * 1000).toISOString()}>{time}</time></span>{notification.is_new && <span className={styles.dot} aria-label={t('notifications.new')} />}</>;
    return to ? <Link className={styles.notification} to={to}>{content}</Link> : <article className={styles.notification}>{content}</article>;
}
