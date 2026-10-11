import { useCallback, useMemo, useState } from 'react';
import AnimeCard from '../components/AnimeCard';
import AnimeCardHorizontal from '../components/AnimeCardHorizontal';
import { PageHeader, PageLayout } from '../components/PageLayout';
import PageState from '../components/PageState';
import { useApi } from '../shared/apiClient';
import { useSettings } from '../shared/contexts/settingsContext';
import { useTranslation } from '../shared/useTranslation';
import type { Anime } from '../shared/types/api';
import styles from './ScheduleScreen.module.css';
import { DAYS_CONFIG, getTodayDayKey, type ScheduleDayKey, type ScheduleTabKey, type ScheduleResponse } from '../shared/discover/schedule';
import { useAsyncLoad } from '../shared/useAsyncLoad';
import { moveTab } from '../shared/discover/tabs';

export default function ScheduleScreen() {
    const api = useApi();
    const { t } = useTranslation();
    const { settings } = useSettings();

    const todayDayKey = useMemo(() => getTodayDayKey(), []);
    const [selectedTab, setSelectedTab] = useState<ScheduleTabKey>(() => todayDayKey);
    const { data: scheduleData, isLoading, error, reload: fetchSchedule } = useAsyncLoad(
        signal => api.get<ScheduleResponse>('/schedule', { signal }), [api]);
    const isHorizontal = settings.appearance.defaultCardType === 'horizontal';

    const totalReleasesCount = useMemo(() => {
        if (!scheduleData) return 0;
        return DAYS_CONFIG.reduce((acc, day) => {
            const list = scheduleData[day.key];
            return acc + (Array.isArray(list) ? list.length : 0);
        }, 0);
    }, [scheduleData]);

    const getDayReleases = useCallback((key: ScheduleDayKey): Anime[] => {
        if (!scheduleData) return [];
        const items = scheduleData[key];
        return Array.isArray(items) ? items : [];
    }, [scheduleData]);

    return (
        <PageLayout className={styles.page} size="wide">
            <PageHeader
                title={t('roadmap.discover.schedule.title')}
                description={t('roadmap.discover.schedule.description')}
            />

            <nav className={styles.tabNav} role="tablist" aria-label={t('roadmap.discover.schedule.title')}>
                <button
                    type="button"
                    role="tab"
                    id="schedule-tab-all"
                    aria-selected={selectedTab === 'all'}
                    aria-controls="panel-schedule"
                    className={`${styles.tabButton} ${selectedTab === 'all' ? styles.activeTab : ''}`}
                    tabIndex={selectedTab === 'all' ? 0 : -1}
                    onKeyDown={event => moveTab(event, ['all', ...DAYS_CONFIG.map(day => day.key)], 'all', setSelectedTab)}
                    onClick={() => setSelectedTab('all')}
                >
                    {t('roadmap.discover.schedule.allDays')}
                    {totalReleasesCount > 0 && <span className={styles.badge}>{totalReleasesCount}</span>}
                </button>

                {DAYS_CONFIG.map(day => {
                    const isSelected = selectedTab === day.key;
                    const isToday = day.key === todayDayKey;
                    const count = getDayReleases(day.key).length;

                    return (
                        <button
                            key={day.key}
                            type="button"
                            role="tab"
                            id={`schedule-tab-${day.key}`}
                            aria-selected={isSelected}
                            aria-controls="panel-schedule"
                            className={`${styles.tabButton} ${isSelected ? styles.activeTab : ''}`}
                            tabIndex={isSelected ? 0 : -1}
                            onKeyDown={event => moveTab(event, ['all', ...DAYS_CONFIG.map(day => day.key)], day.key, setSelectedTab)}
                            onClick={() => setSelectedTab(day.key)}
                        >
                            <span>{t(day.labelKey)}</span>
                            {isToday && (
                                <span className={styles.todayIndicator} title={t('roadmap.discover.schedule.today')}>
                                    {t('roadmap.discover.schedule.today')}
                                </span>
                            )}
                            {count > 0 && <span className={styles.badge}>{count}</span>}
                        </button>
                    );
                })}
            </nav>

            <div
                id="panel-schedule"
                role="tabpanel"
                tabIndex={0}
                aria-labelledby={`schedule-tab-${selectedTab}`}
                className={styles.tabPanel}
            >
                {isLoading && (
                    <PageState
                        status="loading"
                        message={t('roadmap.discover.schedule.loading')}
                    />
                )}

                {!isLoading && Boolean(error) && (
                    <PageState
                        status="error"
                        message={t('roadmap.discover.schedule.error')}
                        onRetry={fetchSchedule}
                    />
                )}

                {!isLoading && !error && totalReleasesCount === 0 && (
                    <PageState
                        status="empty"
                        message={t('roadmap.discover.schedule.empty')}
                    />
                )}

                {!isLoading && !error && totalReleasesCount > 0 && (
                    <>
                        {selectedTab === 'all' ? (
                            <div className={styles.allDaysContainer}>
                                {DAYS_CONFIG.map(day => {
                                    const dayReleases = getDayReleases(day.key);
                                    const isToday = day.key === todayDayKey;
                                    if (dayReleases.length === 0) return null;

                                    return (
                                        <section key={day.key} className={styles.daySection}>
                                            <header className={styles.daySectionHeader}>
                                                <h2>
                                                    {t(day.labelKey)}
                                                    {isToday && (
                                                        <span className={styles.todayBadge}>
                                                            {t('roadmap.discover.schedule.today')}
                                                        </span>
                                                    )}
                                                </h2>
                                                <span className={styles.dayCount}>
                                                    {t('roadmap.discover.schedule.badge', { count: dayReleases.length })}
                                                </span>
                                            </header>

                                            <div className={`${styles.grid} ${isHorizontal ? styles.horizontalGrid : ''}`}>
                                                {dayReleases.map(anime => (
                                                    isHorizontal
                                                        ? <AnimeCardHorizontal key={anime.id} anime={anime} />
                                                        : <AnimeCard key={anime.id} anime={anime} />
                                                ))}
                                            </div>
                                        </section>
                                    );
                                })}
                            </div>
                        ) : (
                            <div className={styles.singleDayContainer}>
                                {(() => {
                                    const dayReleases = getDayReleases(selectedTab);
                                    if (dayReleases.length === 0) {
                                        return (
                                            <PageState
                                                status="empty"
                                                message={t('roadmap.discover.schedule.dayEmpty')}
                                            />
                                        );
                                    }

                                    return (
                                        <div className={`${styles.grid} ${isHorizontal ? styles.horizontalGrid : ''}`}>
                                            {dayReleases.map(anime => (
                                                isHorizontal
                                                    ? <AnimeCardHorizontal key={anime.id} anime={anime} />
                                                    : <AnimeCard key={anime.id} anime={anime} />
                                            ))}
                                        </div>
                                    );
                                })()}
                            </div>
                        )}
                    </>
                )}
            </div>
        </PageLayout>
    );
}
