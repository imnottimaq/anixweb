import { Link } from 'react-router-dom';
import { PageHeader, PageLayout } from '../components/PageLayout';
import PageState from '../components/PageState';
import RemoteImage from '../components/RemoteImage';
import { useApi } from '../shared/apiClient';
import type { ReleaseNotificationsPreferencesAPIResponse } from '../shared/types/api';
import { useAsyncLoad } from '../shared/useAsyncLoad';
import styles from './ReleaseNotificationSettingsScreen.module.css';

export default function ReleaseNotificationSettingsScreen() {
    const api = useApi();
    const { data, error, isLoading, reload } = useAsyncLoad(
        signal => api.get<ReleaseNotificationsPreferencesAPIResponse>('/profile/preference/notification/release/all/0', { signal }),
        [api],
        { initialData: { code: 0, content: [], total_count: 0, total_page_count: 0, current_page: 0 } },
    );
    const releases = data?.content ?? [];
    const errorMessage = error instanceof Error ? error.message : error ? 'Не удалось загрузить релизы' : null;

    return <PageLayout>
        <PageHeader title="Уведомления по релизам" description="Отдельные настройки для выбранных релизов." back />

        {isLoading && <PageState status="loading" message="Загружаем релизы…" />}
        {!isLoading && errorMessage && <PageState status="error" message={errorMessage} onRetry={reload} />}
        {!isLoading && !errorMessage && releases.length === 0 && <PageState status="empty" message="Для отдельных релизов уведомления пока не настроены." />}

        {!isLoading && !errorMessage && <div className={styles.list}>
            {releases.map(release => <article className={styles.release} key={release.id}>
                <Link to={`/anime/${release.id}`} className={styles.poster}><RemoteImage src={release.image} alt="" /></Link>
                <div className={styles.copy}>
                    <Link to={`/anime/${release.id}`}>{release.title_ru}</Link>
                    <p>{release.episodes_released} эп. · {release.grade.toFixed(1)} ★</p>
                    <small>Выбрано озвучек: {release.profile_release_type_notification_preference_count}</small>
                </div>
            </article>)}
        </div>}
    </PageLayout>;
}
