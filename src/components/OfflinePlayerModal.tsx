import { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import type { StoredEpisodeMetadata } from '../shared/storage/opfsStorage.ts';
import { getDownloadedEpisodeBlob } from '../shared/storage/opfsStorage.ts';
import { getWatchProgress, saveWatchProgress, saveContinueWatchingItem } from '../shared/watchProgress.ts';
import { useTranslation } from '../shared/useTranslation.ts';
import styles from './OfflinePlayerModal.module.css';

interface OfflinePlayerModalProps {
    episode: StoredEpisodeMetadata;
    onClose: () => void;
}

function formatTime(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds < 0) return '00:00';
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const paddedMins = mins.toString().padStart(2, '0');
    const paddedSecs = secs.toString().padStart(2, '0');
    return hrs > 0 ? `${hrs}:${paddedMins}:${paddedSecs}` : `${paddedMins}:${paddedSecs}`;
}

export default function OfflinePlayerModal({ episode, onClose }: OfflinePlayerModalProps) {
    const { t } = useTranslation();
    const videoRef = useRef<HTMLVideoElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    const [videoUrl, setVideoUrl] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);

    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [volume, setVolume] = useState(1);
    const [isMuted, setIsMuted] = useState(false);
    const [playbackRate, setPlaybackRate] = useState(1);
    const [controlsVisible, setControlsVisible] = useState(true);
    const hideTimeoutRef = useRef<number | null>(null);

    // Load video Blob from OPFS
    useEffect(() => {
        let isCancelled = false;
        let createdUrl: string | null = null;

        void getDownloadedEpisodeBlob(episode.id)
            .then(blob => {
                if (isCancelled) return;
                if (!blob) {
                    setLoadError(t('downloads.notFoundError') || 'Video file not found in device storage.');
                    setIsLoading(false);
                    return;
                }
                createdUrl = URL.createObjectURL(blob);
                setVideoUrl(createdUrl);
                setLoadError(null);
                setIsLoading(false);
            })
            .catch(err => {
                if (isCancelled) return;
                setLoadError(err instanceof Error ? err.message : 'Failed to load video file.');
                setIsLoading(false);
            });

        return () => {
            isCancelled = true;
            if (createdUrl) {
                URL.revokeObjectURL(createdUrl);
            }
        };
    }, [episode.id, t]);

    // Resume watch position
    const handleLoadedMetadata = () => {
        const video = videoRef.current;
        if (!video) return;
        setDuration(video.duration);

        // Resume saved progress if exists
        const progress = getWatchProgress();
        const savedPosition = progress[String(episode.releaseId)]?.[String(episode.episodeNumber)];
        if (typeof savedPosition === 'number' && savedPosition > 5 && savedPosition < video.duration - 10) {
            video.currentTime = savedPosition;
            setCurrentTime(savedPosition);
        }
    };

    // Save watch progress as user watches
    const handleTimeUpdate = () => {
        const video = videoRef.current;
        if (!video) return;
        setCurrentTime(video.currentTime);

        if (video.duration > 0 && video.currentTime > 5) {
            saveWatchProgress(episode.releaseId, String(episode.episodeNumber), video.currentTime);
            saveContinueWatchingItem({
                animeId: episode.releaseId,
                title: episode.releaseTitle,
                image: episode.posterUrl,
                episodeNumber: episode.episodeNumber,
                episodeName: episode.episodeName,
                seconds: video.currentTime,
                duration: video.duration,
            });
        }
    };

    const handlePlayPause = useCallback(() => {
        const video = videoRef.current;
        if (!video) return;
        if (video.paused) {
            void video.play();
            setIsPlaying(true);
        } else {
            video.pause();
            setIsPlaying(false);
        }
    }, []);

    const handleSeek = useCallback((newTime: number) => {
        const video = videoRef.current;
        if (!video) return;
        video.currentTime = newTime;
        setCurrentTime(newTime);
    }, []);

    const handleSkip = useCallback((seconds: number) => {
        const video = videoRef.current;
        if (!video) return;
        const target = Math.max(0, Math.min(video.duration || 0, video.currentTime + seconds));
        handleSeek(target);
    }, [handleSeek]);

    const handleVolumeChange = useCallback((newVol: number) => {
        const video = videoRef.current;
        if (!video) return;
        video.volume = newVol;
        video.muted = newVol === 0;
        setVolume(newVol);
        setIsMuted(newVol === 0);
    }, []);

    const handleToggleMute = useCallback(() => {
        const video = videoRef.current;
        if (!video) return;
        setIsMuted(prev => {
            const next = !prev;
            video.muted = next;
            return next;
        });
    }, []);

    const handleSpeedChange = useCallback((rate: number) => {
        const video = videoRef.current;
        if (!video) return;
        video.playbackRate = rate;
        setPlaybackRate(rate);
    }, []);

    const handleToggleFullscreen = useCallback(() => {
        const container = containerRef.current;
        if (!container) return;
        if (!document.fullscreenElement) {
            void container.requestFullscreen?.().catch(() => {});
        } else {
            void document.exitFullscreen?.().catch(() => {});
        }
    }, []);

    // Auto-hide controls
    const resetHideTimer = useCallback(() => {
        setControlsVisible(true);
        if (hideTimeoutRef.current) {
            window.clearTimeout(hideTimeoutRef.current);
        }
        hideTimeoutRef.current = window.setTimeout(() => {
            if (isPlaying) {
                setControlsVisible(false);
            }
        }, 3000);
    }, [isPlaying]);

    useEffect(() => {
        return () => {
            if (hideTimeoutRef.current) {
                window.clearTimeout(hideTimeoutRef.current);
            }
        };
    }, []);

    // Keyboard controls
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;

            resetHideTimer();

            switch (e.key) {
                case ' ':
                case 'k':
                    e.preventDefault();
                    handlePlayPause();
                    break;
                case 'ArrowLeft':
                    e.preventDefault();
                    handleSkip(-10);
                    break;
                case 'ArrowRight':
                    e.preventDefault();
                    handleSkip(10);
                    break;
                case 'ArrowUp':
                    e.preventDefault();
                    handleVolumeChange(Math.min(1, volume + 0.1));
                    break;
                case 'ArrowDown':
                    e.preventDefault();
                    handleVolumeChange(Math.max(0, volume - 0.1));
                    break;
                case 'm':
                case 'M':
                    e.preventDefault();
                    handleToggleMute();
                    break;
                case 'f':
                case 'F':
                    e.preventDefault();
                    handleToggleFullscreen();
                    break;
                case 'Escape':
                    e.preventDefault();
                    onClose();
                    break;
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [handlePlayPause, handleSkip, handleVolumeChange, handleToggleMute, handleToggleFullscreen, onClose, resetHideTimer, volume]);

    return createPortal(
        <div
            ref={containerRef}
            className={styles.overlay}
            onMouseMove={resetHideTimer}
            onClick={resetHideTimer}
        >
            <div className={styles.playerContainer}>
                {isLoading && (
                    <div className={styles.loadingSpinner}>
                        <div className={styles.spinnerCircle} />
                        <p>{t('roadmap.player.downloadStatusConnecting') || 'Loading offline video…'}</p>
                    </div>
                )}

                {loadError && (
                    <div className={styles.errorBox}>
                        <h4 className={styles.errorTitle}>{t('page.error') || 'Error'}</h4>
                        <p>{loadError}</p>
                        <button type="button" className={styles.backButton} onClick={onClose}>
                            {t('downloads.back') || 'Back to downloads'}
                        </button>
                    </div>
                )}

                {videoUrl && (
                    <video
                        ref={videoRef}
                        src={videoUrl}
                        className={styles.video}
                        onLoadedMetadata={handleLoadedMetadata}
                        onTimeUpdate={handleTimeUpdate}
                        onPlay={() => setIsPlaying(true)}
                        onPause={() => setIsPlaying(false)}
                        onEnded={() => setIsPlaying(false)}
                        onClick={handlePlayPause}
                        playsInline
                        autoPlay
                    />
                )}

                {/* Top bar with back button and episode info */}
                <div className={`${styles.topBar} ${!controlsVisible && isPlaying ? styles.topBarHidden : ''}`}>
                    <button
                        type="button"
                        className={styles.backButton}
                        onClick={onClose}
                        aria-label={t('downloads.back') || 'Back'}
                    >
                        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="19" y1="12" x2="5" y2="12" />
                            <polyline points="12 19 5 12 12 5" />
                        </svg>
                        <span>{t('downloads.back') || 'Back'}</span>
                    </button>

                    <div className={styles.titleArea}>
                        <h3 className={styles.animeTitle}>{episode.releaseTitle}</h3>
                        <p className={styles.episodeTitle}>
                            {t('player.episodeTitle', { number: episode.episodeNumber })}
                            {episode.episodeName ? ` · ${episode.episodeName}` : ''}
                            {episode.quality ? ` (${episode.quality}p)` : ''}
                        </p>
                    </div>

                    <div className={styles.offlineBadge}>
                        {t('downloads.offlineMode') || 'Offline'}
                    </div>
                </div>

                {/* Bottom bar with timeline and controls */}
                <div className={`${styles.bottomBar} ${!controlsVisible && isPlaying ? styles.bottomBarHidden : ''}`}>
                    <div className={styles.timelineWrap}>
                        <span className={styles.timeDisplay}>{formatTime(currentTime)}</span>
                        <input
                            type="range"
                            className={styles.timelineSlider}
                            min={0}
                            max={duration || 100}
                            step={0.1}
                            value={currentTime}
                            onChange={e => handleSeek(Number(e.target.value))}
                            aria-label="Seek timeline"
                        />
                        <span className={styles.timeDisplay}>{formatTime(duration)}</span>
                    </div>

                    <div className={styles.controlsRow}>
                        <div className={styles.controlsLeft}>
                            {/* Play / Pause button */}
                            <button
                                type="button"
                                className={`${styles.controlButton} ${styles.playPauseButton}`}
                                onClick={handlePlayPause}
                                aria-label={isPlaying ? 'Pause' : 'Play'}
                            >
                                {isPlaying ? (
                                    <svg viewBox="0 0 24 24" fill="currentColor">
                                        <rect x="6" y="4" width="4" height="16" rx="1" />
                                        <rect x="14" y="4" width="4" height="16" rx="1" />
                                    </svg>
                                ) : (
                                    <svg viewBox="0 0 24 24" fill="currentColor">
                                        <polygon points="5 3 19 12 5 21 5 3" />
                                    </svg>
                                )}
                            </button>

                            {/* Skip -10s */}
                            <button
                                type="button"
                                className={styles.controlButton}
                                onClick={() => handleSkip(-10)}
                                aria-label="Skip backward 10 seconds"
                                title="-10s"
                            >
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M11 17l-5-5 5-5" />
                                    <path d="M18 17l-5-5 5-5" />
                                </svg>
                            </button>

                            {/* Skip +10s */}
                            <button
                                type="button"
                                className={styles.controlButton}
                                onClick={() => handleSkip(10)}
                                aria-label="Skip forward 10 seconds"
                                title="+10s"
                            >
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M13 17l5-5-5-5" />
                                    <path d="M6 17l5-5-5-5" />
                                </svg>
                            </button>

                            {/* Volume controls */}
                            <div className={styles.volumeGroup}>
                                <button
                                    type="button"
                                    className={styles.controlButton}
                                    onClick={handleToggleMute}
                                    aria-label={isMuted ? 'Unmute' : 'Mute'}
                                >
                                    {isMuted || volume === 0 ? (
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                                            <line x1="23" y1="9" x2="17" y2="15" />
                                            <line x1="17" y1="9" x2="23" y2="15" />
                                        </svg>
                                    ) : (
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                                            <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
                                        </svg>
                                    )}
                                </button>
                                <input
                                    type="range"
                                    className={styles.volumeSlider}
                                    min={0}
                                    max={1}
                                    step={0.05}
                                    value={isMuted ? 0 : volume}
                                    onChange={e => handleVolumeChange(Number(e.target.value))}
                                    aria-label="Volume slider"
                                />
                            </div>
                        </div>

                        <div className={styles.controlsRight}>
                            {/* Playback speed */}
                            <div className={styles.selectGroup}>
                                <select
                                    className={styles.speedSelect}
                                    value={playbackRate}
                                    onChange={e => handleSpeedChange(Number(e.target.value))}
                                    aria-label="Playback speed"
                                >
                                    <option value={0.75}>0.75x</option>
                                    <option value={1}>1.0x</option>
                                    <option value={1.25}>1.25x</option>
                                    <option value={1.5}>1.5x</option>
                                    <option value={2}>2.0x</option>
                                </select>
                            </div>

                            {/* Fullscreen toggle */}
                            <button
                                type="button"
                                className={styles.controlButton}
                                onClick={handleToggleFullscreen}
                                aria-label="Toggle Fullscreen"
                                title="Fullscreen"
                            >
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
                                </svg>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>,
        document.body
    );
}
