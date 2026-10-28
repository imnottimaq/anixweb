import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader, PageLayout } from '../components/PageLayout';
import OfflinePlayerModal from '../components/OfflinePlayerModal';
import {
    clearAllDownloads,
    deleteDownloadedEpisode,
    getDownloadedEpisodeBlob,
    getDownloadedEpisodes,
    getStorageEstimate,
    type StoredEpisodeMetadata,
} from '../shared/storage/opfsStorage';
import { formatBytes, triggerBrowserFileDownload } from '../shared/player/download';
import { useTranslation } from '../shared/useTranslation';
import { useAsyncLoad } from '../shared/useAsyncLoad';
import styles from './DownloadsScreen.module.css';

export default function DownloadsScreen() {
    const { t } = useTranslation();
    const { data, isLoading, reload } = useAsyncLoad(async () => {
        const [loadedEpisodes, estimate] = await Promise.all([
            getDownloadedEpisodes(),
            getStorageEstimate(),
        ]);
        return { episodes: loadedEpisodes, estimate };
    }, []);

    const episodes = useMemo(() => data?.episodes ?? [], [data?.episodes]);
    const storageEstimate = data?.estimate ?? null;
    const [searchQuery, setSearchQuery] = useState('');
    const [activeEpisode, setActiveEpisode] = useState<StoredEpisodeMetadata | null>(null);
    const [busyId, setBusyId] = useState<string | null>(null);
    const [statusToast, setStatusToast] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

    const showToast = useCallback((text: string, type: 'success' | 'error') => {
        setStatusToast({ text, type });
        window.setTimeout(() => {
            setStatusToast(current => (current?.text === text ? null : current));
        }, 3000);
    }, []);

    const filteredEpisodes = useMemo(() => {
        if (!searchQuery.trim()) return episodes;
        const q = searchQuery.trim().toLowerCase();
        return episodes.filter(ep => {
            const titleMatch = ep.releaseTitle.toLowerCase().includes(q);
            const nameMatch = ep.episodeName ? ep.episodeName.toLowerCase().includes(q) : false;
            const epNumMatch = ep.episodeNumber.toString().includes(q);
            return titleMatch || nameMatch || epNumMatch;
        });
    }, [episodes, searchQuery]);

    const handlePlay = useCallback((ep: StoredEpisodeMetadata) => {
        setActiveEpisode(ep);
    }, []);

    const handleExport = useCallback(async (ep: StoredEpisodeMetadata) => {
        setBusyId(ep.id);
        try {
            const blob = await getDownloadedEpisodeBlob(ep.id);
            if (!blob) {
                showToast(t('downloads.notFoundError'), 'error');
                return;
            }
            triggerBrowserFileDownload(blob, ep.filename);
            showToast(t('downloads.exportedSuccess'), 'success');
        } catch (err) {
            console.error('Failed to export episode:', err);
            showToast(t('downloads.notFoundError'), 'error');
        } finally {
            setBusyId(null);
        }
    }, [showToast, t]);

    const handleDelete = useCallback(async (ep: StoredEpisodeMetadata) => {
        const confirmed = window.confirm(t('downloads.confirmDelete'));
        if (!confirmed) return;

        setBusyId(ep.id);
        try {
            await deleteDownloadedEpisode(ep.id);
            showToast(t('downloads.deleteSuccess'), 'success');
            reload();
        } catch (err) {
            console.error('Failed to delete episode:', err);
        } finally {
            setBusyId(null);
        }
    }, [reload, showToast, t]);

    const handleClearAll = useCallback(async () => {
        if (episodes.length === 0) return;
        const confirmed = window.confirm(t('downloads.confirmDeleteAll', { count: episodes.length }));
        if (!confirmed) return;

        try {
            await clearAllDownloads();
            showToast(t('downloads.deleteAllSuccess'), 'success');
            reload();
        } catch (err) {
            console.error('Failed to clear downloads:', err);
        }
    }, [episodes.length, reload, showToast, t]);

    const storageUsagePercent = useMemo(() => {
        if (!storageEstimate || !storageEstimate.quota || storageEstimate.quota <= 0) return null;
        return storageEstimate.percentUsed;
    }, [storageEstimate]);

    const storageSummaryText = useMemo(() => {
        if (!storageEstimate) return null;
        if (storageEstimate.quota > 0) {
            return t('downloads.storageUsed', {
                used: storageEstimate.formattedUsage,
                total: storageEstimate.formattedQuota,
            });
        }
        return t('downloads.storageUsedOnly', {
            used: storageEstimate.formattedUsage,
        });
    }, [storageEstimate, t]);

    return (
        <PageLayout className={styles.page}>
            <PageHeader
                title={t('downloads.title')}
                description={t('downloads.subtitle')}
                back
                actions={
                    episodes.length > 0 ? (
                        <button
                            type="button"
                            className={styles['delete-all-btn']}
                            onClick={handleClearAll}
                            disabled={isLoading}
                        >
                            {t('downloads.deleteAll')}
                        </button>
                    ) : null
                }
            />

            {/* Storage usage bar */}
            {storageEstimate && (
                <section className={styles['storage-bar-card']} aria-label={t('downloads.storageUsedOnly', { used: '' })}>
                    <div className={styles['storage-info-row']}>
                        <div className={styles['storage-labels']}>
                            <span className={styles['storage-used-tag']}>{storageSummaryText}</span>
                            {storageUsagePercent !== null && (
                                <span className={styles['storage-badge']}>{storageUsagePercent}%</span>
                            )}
                        </div>
                        {episodes.length > 0 && (
                            <span className={styles['items-counter']}>
                                {t('downloads.episodesCount.many', { count: episodes.length })}
                            </span>
                        )}
                    </div>
                    {storageUsagePercent !== null && (
                        <div className={styles['storage-progress-track']} role="progressbar" aria-valuenow={storageUsagePercent} aria-valuemin={0} aria-valuemax={100}>
                            <div className={styles['storage-progress-fill']} style={{ width: `${storageUsagePercent}%` }} />
                        </div>
                    )}
                </section>
            )}

            {/* Toolbar: Search input */}
            {episodes.length > 0 && (
                <div className={styles.toolbar}>
                    <div className={styles['search-wrap']}>
                        <span className={styles['search-icon']} aria-hidden="true">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <circle cx="11" cy="11" r="8" />
                                <line x1="21" y1="21" x2="16.65" y2="16.65" />
                            </svg>
                        </span>
                        <input
                            type="search"
                            className={styles['search-input']}
                            placeholder={t('downloads.searchPlaceholder')}
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            aria-label={t('downloads.searchPlaceholder')}
                        />
                        {searchQuery && (
                            <button
                                type="button"
                                className={styles['clear-search-btn']}
                                onClick={() => setSearchQuery('')}
                                aria-label={t('search.clear')}
                            >
                                ×
                            </button>
                        )}
                    </div>
                    <div className={styles['items-counter']}>
                        {t('downloads.episodesCount.many', { count: filteredEpisodes.length })}
                    </div>
                </div>
            )}

            {/* Content: List or Empty */}
            {filteredEpisodes.length > 0 ? (
                <div className={styles['downloads-grid']}>
                    {filteredEpisodes.map(ep => {
                        const isBusy = busyId === ep.id;
                        const formattedDate = new Date(ep.downloadedAt).toLocaleDateString();

                        return (
                            <article key={ep.id} className={styles['download-card']} aria-label={`${ep.releaseTitle} - ${ep.episodeNumber}`}>
                                <div
                                    className={styles['poster-wrap']}
                                    onClick={() => handlePlay(ep)}
                                    role="button"
                                    tabIndex={0}
                                    onKeyDown={e => {
                                        if (e.key === 'Enter' || e.key === ' ') {
                                            e.preventDefault();
                                            handlePlay(ep);
                                        }
                                    }}
                                    aria-label={`${t('downloads.play')}: ${ep.releaseTitle}`}
                                >
                                    {ep.posterUrl ? (
                                        <img src={ep.posterUrl} alt="" className={styles['poster-img']} loading="lazy" />
                                    ) : (
                                        <div className={styles['poster-placeholder']}>
                                            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                                                <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18" />
                                                <line x1="7" y1="2" x2="7" y2="22" />
                                                <line x1="17" y1="2" x2="17" y2="22" />
                                                <line x1="2" y1="12" x2="22" y2="12" />
                                            </svg>
                                        </div>
                                    )}
                                    <div className={styles['poster-play-overlay']} aria-hidden="true">
                                        <div className={styles['poster-play-btn']}>
                                            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                                                <polygon points="5 3 19 12 5 21 5 3" />
                                            </svg>
                                        </div>
                                    </div>
                                </div>

                                <div className={styles['card-content']}>
                                    <div className={styles['card-header-info']}>
                                        <h2 className={styles['card-title']} title={ep.releaseTitle}>
                                            {ep.releaseTitle}
                                        </h2>
                                        <div className={styles['card-episode']}>
                                            {ep.episodeName
                                                ? `${t('release.episodeNumber', { number: ep.episodeNumber })} — ${ep.episodeName}`
                                                : t('release.episodeNumber', { number: ep.episodeNumber })}
                                        </div>
                                        <div className={styles['card-tags']}>
                                            <span className={styles['quality-badge']}>{ep.quality}p</span>
                                            <span className={styles['size-badge']}>{formatBytes(ep.fileSize)}</span>
                                            <span className={styles['date-badge']}>{formattedDate}</span>
                                        </div>
                                    </div>

                                    <div className={styles['card-actions']}>
                                        <button
                                            type="button"
                                            className={styles['play-action-btn']}
                                            onClick={() => handlePlay(ep)}
                                            disabled={isBusy}
                                            aria-label={`${t('downloads.play')} ${ep.releaseTitle}`}
                                        >
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                                                <polygon points="5 3 19 12 5 21 5 3" />
                                            </svg>
                                            <span>{t('downloads.play')}</span>
                                        </button>

                                        <button
                                            type="button"
                                            className={styles['icon-action-btn']}
                                            onClick={() => handleExport(ep)}
                                            disabled={isBusy}
                                            title={t('downloads.export')}
                                            aria-label={`${t('downloads.export')} ${ep.filename}`}
                                        >
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                                <polyline points="7 10 12 15 17 10" />
                                                <line x1="12" y1="15" x2="12" y2="3" />
                                            </svg>
                                            <span>{t('downloads.export')}</span>
                                        </button>

                                        <button
                                            type="button"
                                            className={`${styles['icon-action-btn']} ${styles.danger}`}
                                            onClick={() => handleDelete(ep)}
                                            disabled={isBusy}
                                            title={t('downloads.delete')}
                                            aria-label={`${t('downloads.delete')} ${ep.releaseTitle}`}
                                        >
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                                <polyline points="3 6 5 6 21 6" />
                                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                                            </svg>
                                        </button>
                                    </div>
                                </div>
                            </article>
                        );
                    })}
                </div>
            ) : !isLoading ? (
                <div className={styles['empty-state']}>
                    <div className={styles['empty-icon']} aria-hidden="true">
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                            <polyline points="7 10 12 15 17 10" />
                            <line x1="12" y1="15" x2="12" y2="3" />
                        </svg>
                    </div>
                    <h2 className={styles['empty-title']}>{t('downloads.emptyTitle')}</h2>
                    <p className={styles['empty-description']}>{t('downloads.emptyText')}</p>
                    <Link to="/overview" className={styles['browse-btn']}>
                        {t('downloads.browseCatalog')}
                    </Link>
                </div>
            ) : null}

            {/* Offline Player Modal */}
            {activeEpisode && (
                <OfflinePlayerModal
                    episode={activeEpisode}
                    onClose={() => setActiveEpisode(null)}
                />
            )}

            {/* Notification Toast */}
            {statusToast && (
                <div className={`${styles.toast} ${styles[statusToast.type]}`} role="status">
                    {statusToast.text}
                </div>
            )}
        </PageLayout>
    );
}
