import { Link, useNavigate } from 'react-router-dom';
import ArrowLeftIcon from '../assets/icons/arrow-left.svg';
import RemoteImage from '../components/RemoteImage';
import { useApi } from '../shared/apiClient';
import type { ReleaseNotificationsPreferencesAPIResponse } from '../shared/types/api';
import { useAsyncLoad } from '../shared/useAsyncLoad';
import styles from './ReleaseNotificationSettingsScreen.module.css';

export default function ReleaseNotificationSettingsScreen() {
    const api = useApi();
    const navigate = useNavigate();
    const { data, error, isLoading } = useAsyncLoad(
        signal => api.get<ReleaseNotificationsPreferencesAPIResponse>('/profile/preference/notification/release/all/0', { signal }),
        [api],
        { initialData: { code: 0, content: [], total_count: 0, total_page_count: 0, current_page: 0 } },
    );
    const releases = data?.content ?? [];
    const errorMessage = error instanceof Error ? error.message : error ? 'Не удалось загрузить релизы' : null;

    return <section className={styles.page}>
        <header className={styles.header}>
            <button className={styles.back} type="button" onClick={() => navigate(-1)} aria-label="Назад"><img src={ArrowLeftIcon} alt="" /></button>
            <h1>Уведомления по релизам</h1>
        </header>

        {isLoading && <p className={styles.message}>Загружаем релизы…</p>}
        {errorMessage && <p className={`${styles.message} ${styles.error}`}>{errorMessage}</p>}
        {!isLoading && !errorMessage && releases.length === 0 && <p className={styles.message}>Для отдельных релизов уведомления пока не настроены.</p>}

        <div className={styles.list}>
            {releases.map(release => <article className={styles.release} key={release.id}>
                <Link to={`/anime/${release.id}`} className={styles.poster}><RemoteImage src={release.image} alt="" /></Link>
                <div className={styles.copy}>
                    <Link to={`/anime/${release.id}`}>{release.title_ru}</Link>
                    <p>{release.episodes_released} эп. · {release.grade.toFixed(1)} ★</p>
                    <small>Выбрано озвучек: {release.profile_release_type_notification_preference_count}</small>
                </div>
            </article>)}
        </div>
    </section>;
}
