import { Link } from 'react-router-dom';
import { PageHeader, PageLayout } from '../components/PageLayout';
import PageState from '../components/PageState';
import RemoteImage from '../components/RemoteImage';
import { useApi } from '../shared/apiClient';
import type { ReleaseNotificationsPreferencesAPIResponse } from '../shared/types/api';
import { useTranslation } from '../shared/useTranslation';
import { useAsyncLoad } from '../shared/useAsyncLoad';
import styles from './ReleaseNotificationSettingsScreen.module.css';

export default function ReleaseNotificationSettingsScreen() {
    const api = useApi();
    const { t, language, formatNumber } = useTranslation();
    const { data, error, isLoading, reload } = useAsyncLoad(
        signal => api.get<ReleaseNotificationsPreferencesAPIResponse>('/profile/preference/notification/release/all/0', { signal }),
        [api],
        { initialData: { code: 0, content: [], total_count: 0, total_page_count: 0, current_page: 0 } },
    );
    const releases = data?.content ?? [];
    if (error) console.error('Failed to load release notification settings', error);
    const hasError = Boolean(error);

    return <PageLayout>
        <PageHeader title={t('releaseNotifications.title')} description={t('releaseNotifications.description')} back />

        {isLoading && <PageState status="loading" message={t('releaseNotifications.loading')} />}
        {!isLoading && hasError && <PageState status="error" message={t('releaseNotifications.error')} onRetry={reload} />}
        {!isLoading && !hasError && releases.length === 0 && <PageState status="empty" message={t('releaseNotifications.empty')} />}

        {!isLoading && !hasError && <div className={styles.list}>
            {releases.map(release => { const title = language === 'english' ? release.title_original || release.title_ru : release.title_ru || release.title_original; return <article className={styles.release} key={release.id}>
                <Link to={`/anime/${release.id}`} className={styles.poster}><RemoteImage src={release.image} alt={t('releaseNotifications.posterAlt', { title })} /></Link>
                <div className={styles.copy}>
                    <Link to={`/anime/${release.id}`}>{title}</Link>
                    <p>{t('releaseNotifications.meta', { episodes: formatNumber(release.episodes_released), grade: formatNumber(release.grade, { maximumFractionDigits: 1, minimumFractionDigits: 1 }) })}</p>
                    <small>{t('releaseNotifications.dubsCount', { count: formatNumber(release.profile_release_type_notification_preference_count) })}</small>
                </div>
            </article>; })}
        </div>}
    </PageLayout>;
}
