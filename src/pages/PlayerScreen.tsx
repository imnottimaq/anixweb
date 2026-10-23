import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useNavigate, useSearchParams, useParams } from 'react-router-dom';
import { createPortal } from 'react-dom';
import { useDialogFocus } from '../shared/useDialogFocus';
import Hls, {
    XhrLoader,
    type FragmentLoaderConstructor,
    type PlaylistLoaderConstructor,
    type LoaderCallbacks,
    type LoaderConfiguration,
    type LoaderContext,
} from 'hls.js';
import styles from './PlayerScreen.module.css';
import { useSettings } from '../shared/contexts/settingsContext';
import { defaultPlayerKeybindings } from '../shared/types/settings';
import { useUser } from '../shared/contexts/userContext';
import { clearPlayerSession, getPlayerSession, setPlayerSession, type PlayerSession } from '../shared/playerSession';
import { getWatchProgress, saveWatchProgress } from '../shared/watchProgress';
import { extractVideoLinks } from '../utils/LinkParser';
import { canUseAnime4KVideo, checkAnime4KVideoSupport, isSafariBrowser } from '../shared/anime4kSupport';
import { useTranslation } from '../shared/useTranslation';
import { resolveRoomMedia } from '../shared/mediaResolver';
import { PlaybackBridge } from '../shared/playbackBridge';
import { roomPlaybackAccess } from '../shared/roomPermissions';
import RoomPanel from '../components/RoomPanel';
import ReactionOverlay from '../components/ReactionOverlay';
import { useRoomPresence } from '../shared/contexts/roomContext';
import { useApi } from '../shared/apiClient';
import { createUpscalerScope } from '../shared/upscalerScope';
import { getCorsProxyUrl } from '../shared/proxy';
import {
    useEpisodeDownload,
    getDownloadStreamOptions,
    isHlsStream,
    isDirectMp4Stream,
    formatBytes,
    sanitizeFilename,
} from '../shared/player/download';

interface WebKitFullscreenElement extends HTMLElement {
    webkitRequestFullscreen?: () => Promise<void> | void;
}

interface WebKitFullscreenVideoElement extends HTMLVideoElement {
    webkitEnterFullscreen?: () => void;
    webkitRequestFullscreen?: () => Promise<void> | void;
}

interface WebKitFullscreenDocument extends Document {
    webkitFullscreenElement?: Element | null;
    webkitExitFullscreen?: () => Promise<void> | void;
}

async function requestFullscreenElement(element: HTMLElement | null, video: HTMLVideoElement | null): Promise<boolean> {
    try {
        if (element?.requestFullscreen) {
            await element.requestFullscreen();
            return true;
        }
        const webkitEl = element as WebKitFullscreenElement | null;
        if (webkitEl?.webkitRequestFullscreen) {
            await webkitEl.webkitRequestFullscreen();
            return true;
        }
        const webkitVid = video as WebKitFullscreenVideoElement | null;
        if (webkitVid && typeof webkitVid.webkitEnterFullscreen === 'function') {
            webkitVid.webkitEnterFullscreen();
            return true;
        }
        if (webkitVid && typeof webkitVid.webkitRequestFullscreen === 'function') {
            await webkitVid.webkitRequestFullscreen();
            return true;
        }
    } catch {
        return false;
    }
    return false;
}

async function exitFullscreenElement(): Promise<void> {
    try {
        const doc = document as WebKitFullscreenDocument;
        if (doc.fullscreenElement && doc.exitFullscreen) {
            await doc.exitFullscreen();
        } else if (doc.webkitFullscreenElement && doc.webkitExitFullscreen) {
            await doc.webkitExitFullscreen();
        }
    } catch {
        // ignore exit error
    }
}

import PlayIcon from '../assets/icons/play.svg';
import PauseIcon from '../assets/icons/pause.svg';
import PrevIcon from '../assets/icons/video-prev.svg';
import NextIcon from '../assets/icons/video-next.svg';
import BackIcon from '../assets/icons/arrow-left.svg';
import SkipIcon from '../assets/icons/chevron-right.svg';
import ExpandIcon from '../assets/icons/expand.svg';
import CompressIcon from '../assets/icons/compress.svg';
import SettingsIcon from '../assets/icons/gear.svg';
import VolumeMaxIcon from '../assets/icons/volume-max.svg';
import VolumeMuteIcon from '../assets/icons/volume-xmark.svg';

const HLS_MIME_TYPE = 'application/x-mpegURL';
const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;
const ASPECT_RATIOS = {
    original: null,
    '16:9': 16 / 9,
    '4:3': 4 / 3,
    '21:9': 21 / 9,
} as const;

type AspectRatio = keyof typeof ASPECT_RATIOS;

/**
 * Fragments are normally loaded straight from the CDN. If an individual
 * request fails specifically as a CORS/network error (XHR status 0), retry
 * only that fragment through the Worker once.
 */
class CorsFallbackFragmentLoader extends XhrLoader {
    override load(context: LoaderContext, config: LoaderConfiguration, callbacks: LoaderCallbacks<LoaderContext>) {
        let triedProxy = false;

        const loadWithProxy = () => {
            const proxiedContext = {
                ...context,
                url: getCorsProxyUrl(context.url),
            };

            super.load(proxiedContext, config, {
                ...callbacks,
                onSuccess: (response, stats, _context, networkDetails) => {
                    response.url = context.url;
                    callbacks.onSuccess(response, stats, context, networkDetails);
                },
                onError: (error, _context, networkDetails, stats) => callbacks.onError(error, context, networkDetails, stats),
                onTimeout: (stats, _context, networkDetails) => callbacks.onTimeout(stats, context, networkDetails),
            });
        };

        super.load(context, config, {
            ...callbacks,
            onError: (error, errorContext, networkDetails, stats) => {
                if (!triedProxy && error.code === 0) {
                    triedProxy = true;
                    loadWithProxy();
                    return;
                }
                callbacks.onError(error, errorContext, networkDetails, stats);
            },
        });
    }
}

export default function PlayerScreen() {
    const { id: routeId } = useParams();
    const [playerSession, setCurrentPlayerSession] = useState(getPlayerSession);
    const [searchParams] = useSearchParams();
    const roomId = searchParams.get('room');
    const code = searchParams.get('code') ?? undefined;
    const { room, activeRoomId, status, error, join, send, self } = useRoomPresence();
    const { userId } = useUser();
    const roomProfileId = self?.profileId ?? userId;
    const api = useApi();
    const navigate = useNavigate();
    const [resolved, setResolved] = useState<{ version: number; roomId: string; session: PlayerSession } | null>(null);
    const [resolveError, setResolveError] = useState<string | null>(null);
    const [reload, setReload] = useState(0);
    const roomMedia = room?.roomId === roomId ? room.media : null;
    const version = room?.roomId === roomId ? room.mediaVersion : -1;
    const confirmedRoomId = room?.roomId ?? null;
    const viewer = room?.participants.find(participant => participant.profileId === roomProfileId);
    const isViewing = viewer?.viewing ?? false;
    const isParticipant = Boolean(viewer);
    const mediaRef = useRef(roomMedia);
    const syncEpochRef = useRef(room?.syncEpoch ?? 0);
    useEffect(() => { mediaRef.current = roomMedia; syncEpochRef.current = room?.syncEpoch ?? 0; }, [roomMedia, room?.syncEpoch]);
    const joinedRouteRef = useRef<string | null>(null);

    useEffect(() => {
        if (!roomId || joinedRouteRef.current === roomId || status === 'replaced') return;
        joinedRouteRef.current = roomId;
        if (activeRoomId !== roomId) void join(roomId, code).catch(() => {});
    }, [activeRoomId, code, join, roomId, status]);
    useEffect(() => {
        if (roomId && activeRoomId === roomId && confirmedRoomId === roomId && status === 'connected' && isParticipant && !isViewing) {
            void send({ type: 'set_viewing', viewing: true }).catch(() => {});
        }
    }, [activeRoomId, confirmedRoomId, isParticipant, isViewing, roomId, roomProfileId, send, status, version]);
    useEffect(() => () => {
        if (roomId) void send({ type: 'set_viewing', viewing: false }).catch(() => {});
    }, [roomId, send]);
    useEffect(() => {
        const media = mediaRef.current;
        if (!roomId || !media) return;
        const controller = new AbortController();
        setResolveError(null);
        void resolveRoomMedia(api, media, controller.signal).then(session => {
            if (controller.signal.aborted) return;
            setResolved({ version, roomId, session });
            navigate('/anime/' + media.releaseId + '/watch?room=' + encodeURIComponent(roomId), { replace: true });
        }).catch(cause => {
            if (controller.signal.aborted) return;
            const message = cause instanceof Error ? cause.message : 'Не удалось загрузить видео';
            setResolveError(message);
            void send({ type: 'load_error', epoch: syncEpochRef.current, message: message.slice(0, 200) }).catch(() => {});
        });
        return () => controller.abort();
    // Room revisions and playback commands never restart media extraction.
    }, [api, navigate, reload, roomId, send, version]);
    const updateSession = useCallback((nextSession: PlayerSession) => {
        setPlayerSession(nextSession);
        setCurrentPlayerSession(nextSession);
    }, []);

    if (roomId) {
        if (resolved?.roomId === roomId && resolved.version === version && roomMedia) {
            return <PlayerPortal><PlayerContent key={roomId + ':' + version} playerSession={resolved.session} onSessionChange={updateSession} roomId={roomId} /></PlayerPortal>;
        }
        return <PlayerPortal><PlayerLoadingDialog onClose={() => navigate('/together/' + encodeURIComponent(roomId))}><div className={styles['room-loading']}>
            <RoomPanel compact />
            <p role="status">{resolveError || error || (!roomMedia && status === 'connected' ? 'В комнате ещё не выбрана серия' : 'Загрузка видео…')}</p>
            {resolveError && <button onClick={() => setReload(value => value + 1)}>Повторить</button>}
            <button onClick={() => navigate('/together/' + encodeURIComponent(roomId))}>Вернуться в комнату</button>
        </div></PlayerLoadingDialog></PlayerPortal>;
    }
    if (!playerSession || playerSession.animeId !== Number(routeId)) return <Navigate to={`/anime/${routeId}`} state={{ openEpisodePicker: true }} replace />;
    return <PlayerPortal><PlayerContent playerSession={playerSession} onSessionChange={updateSession} roomId={null} /></PlayerPortal>;
}

function PlayerPortal({ children }: { children: React.ReactNode }) {
    useEffect(() => {
        const root = document.getElementById('root');
        if (!root) return;
        const previous = root.inert;
        root.inert = true;
        return () => { root.inert = previous; };
    }, []);
    return createPortal(children, document.body);
}

function PlayerLoadingDialog({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
    const ref = useRef<HTMLDivElement>(null);
    const { t } = useTranslation();
    useDialogFocus(ref, true, onClose, true);
    return <div ref={ref} tabIndex={-1} className={styles.overlay} role="dialog" aria-modal="true" aria-label={t('player.ariaLabel')}>{children}</div>;
}

function PlayerContent({ playerSession, onSessionChange, roomId }: { playerSession: PlayerSession; onSessionChange: (session: PlayerSession) => void; roomId: string | null }) {
    const navigate = useNavigate();
    const { settings, setSettings } = useSettings();
    const { t } = useTranslation();
    const { userToken, userId } = useUser();
    const api = useApi();
    const { room: watchRoom, status: roomStatus, send, serverNow, self } = useRoomPresence();
    const roomProfileId = self?.profileId ?? userId;
    const roomAccess = roomPlaybackAccess(watchRoom, roomProfileId);
    const canControlRoom = !roomId || (roomStatus === 'connected' && roomAccess.control);
    const canPauseRoom = !roomId || (roomStatus === 'connected' && roomAccess.pause);
    const canToggleRoomPlayback = canControlRoom || (canPauseRoom && watchRoom?.playback.intent === 'playing');
    const playerRef = useRef<HTMLDivElement>(null);
    const playerDialogRef = useRef<HTMLDivElement>(null);
    const resumeDialogRef = useRef<HTMLDivElement>(null);
    const videoRef = useRef<HTMLVideoElement>(null);
    const upscaleCanvasRef = useRef<HTMLCanvasElement>(null);
    const controlsTimeoutRef = useRef<number | null>(null);
    const keyboardControlsRef = useRef(false);
    const { sources, animeId, animeName, episodeNumber, episodeName } = playerSession;

    useEffect(() => {
        const previousTitle = document.title;
        const episodeTitle = episodeName || t('player.episodeTitle', { number: episodeNumber });
        document.title = `${animeName} · ${episodeTitle} — Anixart`;

        return () => { document.title = previousTitle; };
    }, [animeName, episodeName, episodeNumber, t]);
    const qualities = useMemo(
        () => Object.keys(sources).sort((a, b) => (Number(b) || 0) - (Number(a) || 0)),
        [sources]
    );
    const configuredQuality = settings.player.defaultQuality ?? 'auto';
    // This is deliberately local to the current player session. A broken CDN
    // stream should not silently overwrite the quality selected in settings.
    const [fallbackQuality, setFallbackQuality] = useState<string | null>(null);
    const requestedQuality = fallbackQuality ?? configuredQuality;
    const selectedQuality = requestedQuality !== 'auto' && sources[requestedQuality]?.[0]
        ? requestedQuality
        : qualities[0];
    const [isPlaying, setIsPlaying] = useState(false);
    const [isBuffering, setIsBuffering] = useState(true);
    const [isMaximized, setIsMaximized] = useState(false);
    const [isMuted, setIsMuted] = useState(false);
    const [isVolumeDivExpanded, setIsVolumeDivExpanded] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [bufferedTime, setBufferedTime] = useState(0);
    const [volume, setVolume] = useState(settings.player.volume / 100);
    const [isPlayerSettingsOpen, setIsPlayerSettingsOpen] = useState(false);
    const [playbackRate, setPlaybackRate] = useState(() => {
        try {
            const saved = sessionStorage.getItem('anixweb_player_playback_rate');
            const num = Number(saved);
            return [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].includes(num) ? num : 1;
        } catch {
            return 1;
        }
    });
    const displayedPlaybackRate = roomId && watchRoom ? watchRoom.playback.rate : playbackRate;
    const [aspectRatio, setAspectRatio] = useState<AspectRatio>('original');
    const [nativeAspectRatio, setNativeAspectRatio] = useState<number | null>(null);
    const [viewport, setViewport] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));
    const [upscalerReadyKey, setUpscalerReadyKey] = useState<string | null>(null);
    const [isEpisodeChanging, setIsEpisodeChanging] = useState(false);
    const [resumePromptTime, setResumePromptTime] = useState<number | null>(null);
    const [nextEpisodeCountdown, setNextEpisodeCountdown] = useState<number | null>(null);
    const [isPipActive, setIsPipActive] = useState(false);
    const [volumeOsd, setVolumeOsd] = useState<{ level: number; muted: boolean; visible: boolean } | null>(null);
    const [streamError, setStreamError] = useState<string | null>(null);
    const promptedEpisodeRef = useRef<string | null>(null);
    const autoplayAttemptedRef = useRef(false);
    const autoFullscreenTriggeredRef = useRef(false);
    const autoFullscreenPendingRef = useRef(false);
    const fullscreenGenerationRef = useRef(0);
    const wasAutoPausedRef = useRef(false);
    const windowFocusedRef = useRef(typeof document.hasFocus === 'function' ? document.hasFocus() : true);
    const downloadDialogRef = useRef<HTMLDivElement>(null);
    const countdownDialogRef = useRef<HTMLDivElement>(null);
    const countdownIntervalRef = useRef<number | null>(null);
    const volumeOsdTimeoutRef = useRef<number | null>(null);
    const resumePendingRef = useRef(false);
    const loadPlaybackRef = useRef<boolean | null>(null);
    const metadataLoadedRef = useRef(false);
    const fallbackPositionRef = useRef<{ time: number; shouldPlay: boolean } | null>(null);
    const episodeRequestRef = useRef(0);
    const episodeChangePendingRef = useRef(false);
    const playerClosedRef = useRef(false);
    const bridgeRef = useRef<PlaybackBridge | null>(null);
    const roomStateRef = useRef(watchRoom);
    const roomStatusRef = useRef(roomStatus);
    useEffect(() => { roomStateRef.current = watchRoom; roomStatusRef.current = roomStatus; }, [watchRoom, roomStatus]);
    const [isRoomPanelOpen, setIsRoomPanelOpen] = useState(false);
    const [areControlsVisible, setAreControlsVisible] = useState(true);
    const [webGpuStatus, setWebGpuStatus] = useState<'checking' | 'supported' | 'unsupported'>(() => (
        canUseAnime4KVideo() ? 'checking' : 'unsupported'
    ));
    const [isDownloadModalOpen, setIsDownloadModalOpen] = useState(false);
    const [downloadSelectedQuality, setDownloadSelectedQuality] = useState<string>('');
    const isAutoPausingRef = useRef(false);
    const {
        status: downloadStatus,
        progress: downloadProgress,
        error: downloadError,
        startDownload,
        cancelDownload,
        reset: resetDownload,
    } = useEpisodeDownload();
    const keybindings = settings.player.keybindings ?? defaultPlayerKeybindings;

    const stream = sources[selectedQuality]?.[0];
    const downloadOptions = getDownloadStreamOptions(sources);

    const timelineProgress = Number.isFinite(duration) && duration > 0
        ? Math.min((currentTime / duration) * 100, 100)
        : 0;
    const bufferedProgress = Number.isFinite(duration) && duration > 0
        ? Math.max(timelineProgress, Math.min((bufferedTime / duration) * 100, 100))
        : 0;
    const episodeKey = String(episodeNumber ?? 'unknown');
    const progressKey = `${animeId}:${episodeKey}`;
    useEffect(() => {
        const fullscreenGeneration = fullscreenGenerationRef;
        playerClosedRef.current = false;
        setNextEpisodeCountdown(null);
        autoFullscreenTriggeredRef.current = false;
        autoFullscreenPendingRef.current = false;
        fullscreenGenerationRef.current++;
        return () => {
            playerClosedRef.current = true;
            episodeRequestRef.current += 1;
            episodeChangePendingRef.current = false;
            fullscreenGeneration.current++;
        };
    }, [progressKey]);
    const currentEpisodeIndex = playerSession.episodes?.findIndex(episode => episode.position === episodeNumber) ?? -1;
    const previousEpisode = currentEpisodeIndex > 0 ? playerSession.episodes?.[currentEpisodeIndex - 1] : undefined;
    const nextEpisode = currentEpisodeIndex >= 0 ? playerSession.episodes?.[currentEpisodeIndex + 1] : undefined;
    const upscalerKey = `${stream?.src ?? ''}:${settings.player.qualityUpgradeMode}`;
    const isUpscalerReady = settings.player.qualityUpgrade && upscalerReadyKey === upscalerKey;
    const ratioValue = ASPECT_RATIOS[aspectRatio] ?? nativeAspectRatio;
    const videoFrameStyle = ratioValue
        ? {
            width: Math.min(viewport.width, viewport.height * ratioValue),
            height: Math.min(viewport.height, viewport.width / ratioValue),
        }
        : undefined;

    const saveEpisodeTime = useCallback(() => {
        const video = videoRef.current;
        if (!settings.content.rememberEpisodeTime || !video || !metadataLoadedRef.current || resumePendingRef.current
            || !Number.isFinite(video.currentTime)) return;

        saveWatchProgress(animeId, episodeKey, video.ended ? -1 : Math.floor(video.currentTime));
    }, [animeId, episodeKey, settings.content.rememberEpisodeTime]);

    const sendRoomPlayback = useCallback((type: 'play' | 'pause' | 'seek' | 'set_rate', position: number, rate?: number) => {
        if (!roomId || !(type === 'pause' ? canPauseRoom : canControlRoom)) return;
        void send(type === 'set_rate' ? { type, position, rate: rate ?? 1 } : { type, position }).catch(error => setStreamError(String(error)));
    }, [canControlRoom, canPauseRoom, roomId, send]);

    useEffect(() => {
        const video = videoRef.current;
        if (!roomId || !video || !stream) return;
        const bridge = new PlaybackBridge(video, send, serverNow, setStreamError);
        bridgeRef.current = bridge;
        bridge.update(roomStateRef.current, roomStatusRef.current === 'connected');
        const interval = window.setInterval(() => bridge.synchronize(), 250);
        return () => { window.clearInterval(interval); bridge.dispose(); bridgeRef.current = null; };
    }, [roomId, send, serverNow, stream]);
    useEffect(() => {
        if (!roomId) return;
        bridgeRef.current?.update(watchRoom, roomStatus === 'connected');
    }, [roomId, roomStatus, watchRoom]);
    useEffect(() => {
        if (roomId && streamError && !streamError.includes('Браузер')) bridgeRef.current?.error(streamError);
    }, [roomId, streamError]);

    const togglePlayback = useCallback(() => {
        wasAutoPausedRef.current = false;
        isAutoPausingRef.current = false;
        const video = videoRef.current;
        if (!video || !canToggleRoomPlayback) return;
        if (roomId) { sendRoomPlayback(watchRoom?.playback.intent === 'playing' ? 'pause' : 'play', video.currentTime); return; }
        if (settings.player.autoFullscreen && !autoFullscreenTriggeredRef.current && !autoFullscreenPendingRef.current) {
            autoFullscreenPendingRef.current = true;
            const generation = fullscreenGenerationRef.current;
            void requestFullscreenElement(playerRef.current, video).then(success => {
                if (generation !== fullscreenGenerationRef.current) return;
                autoFullscreenPendingRef.current = false;
                if (success) autoFullscreenTriggeredRef.current = true;
            });
        }
        if (video.paused) void video.play(); else video.pause();
    }, [canToggleRoomPlayback, roomId, sendRoomPlayback, settings.player.autoFullscreen, watchRoom?.playback.intent]);
    const seekTo = useCallback((position: number) => {
        if (!canControlRoom) return;
        if (roomId) { sendRoomPlayback('seek', position); return; }
        if (videoRef.current) videoRef.current.currentTime = position;
        setCurrentTime(position);
    }, [canControlRoom, roomId, sendRoomPlayback]);

    const switchToLowerQuality = useCallback(() => {
        const currentIndex = qualities.indexOf(selectedQuality);
        const nextQuality = qualities.slice(currentIndex + 1).find(candidate => sources[candidate]?.[0]);
        if (!nextQuality) return false;

        const video = videoRef.current;
        fallbackPositionRef.current = {
            time: video && Number.isFinite(video.currentTime) ? video.currentTime : 0,
            shouldPlay: Boolean(video && !video.paused),
        };
        setFallbackQuality(nextQuality);
        return true;
    }, [qualities, selectedQuality, sources]);

    const closePlayer = () => {
        playerClosedRef.current = true;
        setNextEpisodeCountdown(null);
        episodeRequestRef.current += 1;
        saveEpisodeTime();
        clearPlayerSession();
        navigate(roomId ? `/together/${encodeURIComponent(roomId)}` : `/anime/${animeId}`, { state: { focusPlay: true } });
    };

    const showControls = useCallback(() => {
        setAreControlsVisible(true);
        if (controlsTimeoutRef.current !== null) window.clearTimeout(controlsTimeoutRef.current);
        if (!isPlaying || isPlayerSettingsOpen || resumePromptTime !== null || nextEpisodeCountdown !== null || isDownloadModalOpen || (keyboardControlsRef.current && playerDialogRef.current?.querySelector('[data-player-controls]')?.contains(document.activeElement))) return;

        controlsTimeoutRef.current = window.setTimeout(() => { if (!keyboardControlsRef.current || !playerDialogRef.current?.querySelector('[data-player-controls]')?.contains(document.activeElement)) setAreControlsVisible(false); }, 2_500);
    }, [isPlaying, isPlayerSettingsOpen, resumePromptTime, nextEpisodeCountdown, isDownloadModalOpen]);

    useEffect(() => {
        const updateFullscreen = () => setIsMaximized(Boolean(document.fullscreenElement || (document as WebKitFullscreenDocument).webkitFullscreenElement));
        document.addEventListener('fullscreenchange', updateFullscreen);
        document.addEventListener('webkitfullscreenchange', updateFullscreen);
        return () => {
            document.removeEventListener('fullscreenchange', updateFullscreen);
            document.removeEventListener('webkitfullscreenchange', updateFullscreen);
        };
    }, []);

    useEffect(() => {
        let isCancelled = false;
        if (!canUseAnime4KVideo()) return;

        void checkAnime4KVideoSupport()
            .then(isSupported => {
                if (!isCancelled) setWebGpuStatus(isSupported ? 'supported' : 'unsupported');
            })
            .catch(() => {
                if (!isCancelled) setWebGpuStatus('unsupported');
            });

        return () => { isCancelled = true; };
    }, []);

    useEffect(() => {
        const frame = window.requestAnimationFrame(showControls);
        return () => {
            window.cancelAnimationFrame(frame);
            if (controlsTimeoutRef.current !== null) window.clearTimeout(controlsTimeoutRef.current);
        };
    }, [showControls]);

    useEffect(() => {
        const updateViewport = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
        window.addEventListener('resize', updateViewport);
        return () => window.removeEventListener('resize', updateViewport);
    }, []);

    useEffect(() => {
        if (!settings.player.autoPauseOnTabSwitch || roomId) return;

        const handlePause = () => {
            const video = videoRef.current;
            if (roomId || !video || video.paused || resumePromptTime !== null || resumePendingRef.current) return;
            isAutoPausingRef.current = true;
            wasAutoPausedRef.current = true;
            video.pause();
        };

        const handleResume = () => {
            const video = videoRef.current;
            if (roomId || !video || document.hidden || !windowFocusedRef.current || !wasAutoPausedRef.current || resumePromptTime !== null || resumePendingRef.current || video.readyState < 2) return;
            wasAutoPausedRef.current = false;
            autoplayAttemptedRef.current = true;
            void video.play().catch(() => {});
        };

        const onVisibilityChange = () => {
            if (document.hidden) {
                handlePause();
            } else {
                handleResume();
            }
        };

        const onWindowBlur = () => {
            windowFocusedRef.current = false;
            handlePause();
        };

        const onWindowFocus = () => {
            windowFocusedRef.current = true;
            handleResume();
        };

        document.addEventListener('visibilitychange', onVisibilityChange);
        window.addEventListener('blur', onWindowBlur);
        window.addEventListener('focus', onWindowFocus);

        return () => {
            document.removeEventListener('visibilitychange', onVisibilityChange);
            window.removeEventListener('blur', onWindowBlur);
            window.removeEventListener('focus', onWindowFocus);
        };
    }, [resumePromptTime, roomId, settings.player.autoPauseOnTabSwitch]);

    const startFrom = (time: number) => {
        const video = videoRef.current;
        if (!video) return;

        video.currentTime = time;
        resumePendingRef.current = false;
        autoplayAttemptedRef.current = true;
        setCurrentTime(time);
        setResumePromptTime(null);
        void video.play().catch(error => console.error('Не удалось запустить видео:', error));
    };

    useDialogFocus(playerDialogRef, true, () => {
        if (isPlayerSettingsOpen) { setIsPlayerSettingsOpen(false); return; }
        if (document.fullscreenElement || (document as WebKitFullscreenDocument).webkitFullscreenElement) { void exitFullscreenElement(); return; }
        closePlayer();
    }, true);
    useDialogFocus(downloadDialogRef, isDownloadModalOpen, () => { resetDownload(); setIsDownloadModalOpen(false); }, true);
    useDialogFocus(resumeDialogRef, resumePromptTime !== null, () => { if (resumePromptTime !== null) startFrom(resumePromptTime); }, true);
    useDialogFocus(countdownDialogRef, nextEpisodeCountdown !== null, () => setNextEpisodeCountdown(null), true);

    const isPipSupported = typeof document !== 'undefined' && (
        Boolean(document.pictureInPictureEnabled)
        || (typeof HTMLVideoElement !== 'undefined' && 'webkitSupportsPresentationMode' in HTMLVideoElement.prototype)
    );

    const togglePictureInPicture = useCallback(async () => {
        const video = videoRef.current;
        if (!video) return;
        try {
            if (document.pictureInPictureElement) {
                await document.exitPictureInPicture();
            } else if (document.pictureInPictureEnabled && typeof video.requestPictureInPicture === 'function') {
                await video.requestPictureInPicture();
            } else if ('webkitSetPresentationMode' in video && typeof (video as unknown as { webkitSetPresentationMode: (m: string) => void }).webkitSetPresentationMode === 'function') {
                const v = video as unknown as { webkitPresentationMode: string; webkitSetPresentationMode: (m: string) => void };
                v.webkitSetPresentationMode(v.webkitPresentationMode === 'picture-in-picture' ? 'inline' : 'picture-in-picture');
            }
        } catch (error) {
            console.error('Не удалось переключить режим «картинка в картинке»:', error);
        }
    }, []);

    const triggerVolumeOsd = useCallback((level: number, muted: boolean) => {
        setVolumeOsd({ level, muted, visible: true });
        if (volumeOsdTimeoutRef.current !== null) window.clearTimeout(volumeOsdTimeoutRef.current);
        volumeOsdTimeoutRef.current = window.setTimeout(() => {
            setVolumeOsd(prev => (prev ? { ...prev, visible: false } : null));
        }, 1500);
    }, []);

    const handleWheelVolume = useCallback((event: React.WheelEvent) => {
        if (isDownloadModalOpen || resumePromptTime !== null || nextEpisodeCountdown !== null || isPlayerSettingsOpen) return;
        event.preventDefault();
        event.stopPropagation();
        const video = videoRef.current;
        if (!video) return;

        const step = 0.05;
        const currentVol = video.muted ? 0 : video.volume;
        const change = event.deltaY < 0 ? step : -step;
        const nextVolume = Math.min(1, Math.max(0, Math.round((currentVol + change) * 100) / 100));

        video.muted = false;
        video.volume = nextVolume;
        setVolume(nextVolume);
        setIsMuted(false);
        setSettings(previous => ({
            ...previous,
            player: { ...previous.player, volume: Math.round(nextVolume * 100) },
        }));

        triggerVolumeOsd(Math.round(nextVolume * 100), nextVolume === 0);
    }, [isDownloadModalOpen, isPlayerSettingsOpen, nextEpisodeCountdown, resumePromptTime, setSettings, triggerVolumeOsd]);

    useEffect(() => {
        return () => {
            if (volumeOsdTimeoutRef.current !== null) {
                window.clearTimeout(volumeOsdTimeoutRef.current);
            }
            if (countdownIntervalRef.current !== null) {
                window.clearInterval(countdownIntervalRef.current);
            }
        };
    }, []);

    useEffect(() => {
        if (nextEpisodeCountdown === null) {
            if (countdownIntervalRef.current !== null) {
                window.clearInterval(countdownIntervalRef.current);
                countdownIntervalRef.current = null;
            }
            return;
        }

        if (nextEpisodeCountdown <= 0) {
            setNextEpisodeCountdown(null);
            if (nextEpisode) {
                void changeEpisode(nextEpisode);
            }
            return;
        }

        countdownIntervalRef.current = window.setInterval(() => {
            setNextEpisodeCountdown(prev => (prev !== null && prev > 0 ? prev - 1 : null));
        }, 1000);

        return () => {
            if (countdownIntervalRef.current !== null) {
                window.clearInterval(countdownIntervalRef.current);
                countdownIntervalRef.current = null;
            }
        };
    }, [changeEpisode, nextEpisode, nextEpisodeCountdown]);

    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;

        const onEnter = () => setIsPipActive(true);
        const onLeave = () => setIsPipActive(false);
        const onWebkit = () => {
            if ('webkitPresentationMode' in video) {
                setIsPipActive((video as unknown as { webkitPresentationMode: string }).webkitPresentationMode === 'picture-in-picture');
            }
        };

        video.addEventListener('enterpictureinpicture', onEnter);
        video.addEventListener('leavepictureinpicture', onLeave);
        video.addEventListener('webkitpresentationmodechanged', onWebkit);

        return () => {
            video.removeEventListener('enterpictureinpicture', onEnter);
            video.removeEventListener('leavepictureinpicture', onLeave);
            video.removeEventListener('webkitpresentationmodechanged', onWebkit);
        };
    }, []);

    useEffect(() => {
        return () => { resetDownload(); };
    }, [progressKey, resetDownload]);

    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;

        const nextVolume = settings.player.volume / 100;
        video.volume = nextVolume;
        setVolume(nextVolume);
    }, [settings.player.volume]);

    useEffect(() => {
        if (!settings.content.rememberEpisodeTime) return;

        const intervalId = window.setInterval(saveEpisodeTime, 15_000);
        return () => {
            window.clearInterval(intervalId);
            saveEpisodeTime();
        };
    }, [saveEpisodeTime, settings.content.rememberEpisodeTime]);

    useEffect(() => {
        const video = videoRef.current;
        if (!video || !stream) return;

        setCurrentTime(0);
        setDuration(0);
        setBufferedTime(0);
        setResumePromptTime(null);
        setStreamError(null);
        setIsBuffering(true);
        autoplayAttemptedRef.current = false;
        wasAutoPausedRef.current = false;
        isAutoPausingRef.current = false;
        resumePendingRef.current = false;
        metadataLoadedRef.current = false;
        loadPlaybackRef.current = null;
        if (promptedEpisodeRef.current !== progressKey) promptedEpisodeRef.current = null;

        const isHls = stream.type === HLS_MIME_TYPE || stream.src.includes('.m3u8') || stream.src.includes(':hls:');
        const canPlayNativeHls = isHls && Boolean(
            video.canPlayType('application/vnd.apple.mpegurl')
            || video.canPlayType(HLS_MIME_TYPE)
        );
        let hls: Hls | undefined;
        let isAbandoningStream = false;
        let mediaRecoveryAttempts = 0;
        let lastBrokenFragment = '';
        let brokenFragmentAttempts = 0;

        const failBrokenStream = (errorData?: unknown) => {
            if (isAbandoningStream) return;
            isAbandoningStream = true;
            if (errorData) console.error('Unrecoverable HLS stream error:', errorData);
            setStreamError(t('player.streamUnavailable'));
            setIsBuffering(false);
            hls?.destroy();
        };

        const abandonBrokenStream = () => {
            if (isAbandoningStream) return;
            isAbandoningStream = true;

            if (!switchToLowerQuality()) {
                setStreamError(t('player.streamUnavailable'));
                setIsBuffering(false);
                hls?.destroy();
            }
        };

        // Safari has a native HLS pipeline. Prefer it over MediaSource/hls.js:
        // it is better integrated with WebKit's buffering, seeking and
        // fullscreen playback, especially after backgrounding the tab.
        if (canPlayNativeHls) {
            video.src = stream.src;
        } else if (isHls && Hls.isSupported()) {
            hls = new Hls({
                // Fail a persistently broken SourceBuffer quickly; the player
                // then tries another quality instead of logging forever.
                appendErrorMaxRetry: 1,
                // XhrLoader is declared with the base context even though it
                // works for Hls.js's specialised fragment loader context too.
                fLoader: CorsFallbackFragmentLoader as unknown as FragmentLoaderConstructor,
                pLoader: CorsFallbackFragmentLoader as unknown as PlaylistLoaderConstructor,
            });
            hls.loadSource(stream.src);
            hls.attachMedia(video);
            hls.on(Hls.Events.ERROR, (_event, data) => {
                const isBrokenFragment = data.details === 'fragParsingError' || data.details === 'fragLoadError';
                if (isBrokenFragment) {
                    const fragmentId = String(data.frag?.sn ?? data.frag?.url ?? data.details);
                    brokenFragmentAttempts = fragmentId === lastBrokenFragment ? brokenFragmentAttempts + 1 : 1;
                    lastBrokenFragment = fragmentId;

                    // Hls.js performs its own retry first. Repeating a bad or
                    // CORS-blocked segment after that can never advance playback.
                    if (brokenFragmentAttempts >= 2) abandonBrokenStream();
                    return;
                }

                if (!data.fatal || isAbandoningStream) return;

                const isAudioSourceBufferFailure = data.sourceBufferName === 'audio' && (
                    data.details === Hls.ErrorDetails.BUFFER_ADD_CODEC_ERROR ||
                    data.details === Hls.ErrorDetails.BUFFER_APPEND_ERROR ||
                    data.details === Hls.ErrorDetails.MEDIA_SOURCE_REQUIRES_RESET
                );
                if (isAudioSourceBufferFailure) {
                    // This browser cannot create or retain the AAC SourceBuffer.
                    // Reattaching the same manifest only repeats the same three
                    // fatal events, so stop this Hls instance immediately.
                    failBrokenStream(data);
                    return;
                }

                const recoveryFlags = data.errorAction?.flags ?? 0;
                const resetMediaSourceFlag = 16;
                if (recoveryFlags & resetMediaSourceFlag) {
                    // Hls.js 1.7 already calls recoverMediaError for this flag.
                    return;
                }

                if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
                    console.error('Fatal HLS network error:', data);
                    abandonBrokenStream();
                } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
                    mediaRecoveryAttempts += 1;

                    console.error('Fatal HLS media error:', data);
                    if (mediaRecoveryAttempts === 1) {
                        hls?.recoverMediaError();
                    } else if (mediaRecoveryAttempts === 2 && data.sourceBufferName === 'audio') {
                        hls?.swapAudioCodec();
                        hls?.recoverMediaError();
                    } else {
                        abandonBrokenStream();
                    }
                } else {
                    console.error('Fatal HLS error:', data);
                    abandonBrokenStream();
                }
            });
        } else {
            video.src = stream.src;
        }

        return () => {
            hls?.destroy();
            video.removeAttribute('src');
            video.load();
        };
    }, [stream, switchToLowerQuality, t, progressKey]);

    useEffect(() => {
        if (!settings.player.qualityUpgrade || !canUseAnime4KVideo()) return;

        const video = videoRef.current;
        const canvas = upscaleCanvasRef.current;
        if (!video || !canvas) return;

        let isCancelled = false;
        let setupStarted = false;
        const scope = createUpscalerScope(video);

        const setupUpscaler = async () => {
            if (setupStarted || !video.videoWidth || !video.videoHeight) return;
            setupStarted = true;
            try {
                // Mode B/C allocate many intermediate textures. Native size keeps
                // memory usage reasonable; CSS scales the enhanced canvas to the player.
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;

                const { render, ModeA, ModeB, ModeC } = await import('anime4k-webgpu');
                if (isCancelled) return;

                const Preset = settings.player.qualityUpgradeMode === 'weak'
                    ? ModeA
                    : settings.player.qualityUpgradeMode === 'strong'
                        ? ModeC
                        : ModeB;

                await scope.initialize(() => render({
                    video,
                    canvas,
                    pipelineBuilder: (device, inputTexture) => {
                        scope.useDevice(device);
                        return [new Preset({
                            device,
                            inputTexture,
                            nativeDimensions: { width: video.videoWidth, height: video.videoHeight },
                            targetDimensions: { width: canvas.width, height: canvas.height },
                        })];
                    },
                }));

                if (!isCancelled) setUpscalerReadyKey(upscalerKey);
            } catch (error) {
                if (!isCancelled) console.error('Не удалось включить Anime4K:', error);
            }
        };

        const onCanPlay = () => { void setupUpscaler(); };
        video.addEventListener('canplay', onCanPlay, { once: true });
        if (video.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) void setupUpscaler();

        return () => {
            isCancelled = true;
            video.removeEventListener('canplay', onCanPlay);
            scope.dispose();
            setUpscalerReadyKey(current => current === upscalerKey ? null : current);
        };
    }, [settings.player.qualityUpgrade, settings.player.qualityUpgradeMode, stream, upscalerKey]);

    const changeEpisode = useCallback(async (targetEpisode: NonNullable<typeof previousEpisode>) => {
        if (!canControlRoom || episodeChangePendingRef.current || playerClosedRef.current) return;
        if (roomId) {
            if (!playerSession.dubId || !playerSession.sourceId) return;
            episodeChangePendingRef.current = true;
            setIsEpisodeChanging(true);
            try {
                await send({ type: 'set_media', media: {
                    releaseId: animeId, releaseName: animeName, dubId: playerSession.dubId,
                    sourceId: playerSession.sourceId, episode: targetEpisode.position, episodeName: targetEpisode.name,
                } });
            } catch (error) {
                episodeChangePendingRef.current = false;
                setIsEpisodeChanging(false);
                setStreamError(String(error));
            }
            return;
        }

        episodeChangePendingRef.current = true;
        const requestId = ++episodeRequestRef.current;
        setIsEpisodeChanging(true);
        try {
            const sources = await extractVideoLinks(targetEpisode.url);
            if (playerClosedRef.current || requestId !== episodeRequestRef.current) return;
            if (!sources) throw new Error('Не удалось получить ссылки на видео');
            if (playerSession.sourceId && userToken) {
                void Promise.all([
                    api.get<{ code: number }>(`/episode/watch/${animeId}/${playerSession.sourceId}/${targetEpisode.position}`),
                    api.get<{ code: number }>(`/history/add/${animeId}/${playerSession.sourceId}/${targetEpisode.position}`),
                ]).catch(error => console.error('Не удалось отметить серию просмотренной:', error));
            }
            setFallbackQuality(null);
            saveEpisodeTime();
            fallbackPositionRef.current = null;
            onSessionChange({
                ...playerSession,
                sources,
                episodeNumber: targetEpisode.position,
                episodeName: targetEpisode.name,
            });
        } catch (error) {
            if (!playerClosedRef.current && requestId === episodeRequestRef.current) {
                console.error('Не удалось сменить серию:', error);
                setStreamError(t('player.streamUnavailable'));
            }
        } finally {
            if (!playerClosedRef.current && requestId === episodeRequestRef.current) {
                episodeChangePendingRef.current = false;
                setIsEpisodeChanging(false);
            }
        }
    }, [animeId, animeName, api, canControlRoom, onSessionChange, playerSession, roomId, send, userToken, saveEpisodeTime, t]);


    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (isDownloadModalOpen || resumePromptTime !== null || nextEpisodeCountdown !== null || event.defaultPrevented || event.isComposing || !event.code || event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
            const target = event.target;
            if (target instanceof HTMLElement && target.closest('button, a, input, textarea, select, [contenteditable], [role="button"], [role="textbox"], [role="listbox"], [role="slider"], [role="menu"], [role="tab"], #watch-room-panel, [data-social-panel]')) return;

            const action = Object.entries(keybindings).find(([, code]) => code === event.code)?.[0];
            if (!action) {
                if (event.code === 'KeyP' || event.code === 'KeyI') {
                    event.preventDefault();
                    showControls();
                    void togglePictureInPicture();
                    return;
                }
                return;
            }

            const video = videoRef.current;
            if (!video) return;
            const seek = (offset: number) => {
                const nextTime = Math.max(0, Math.min(video.currentTime + offset, Number.isFinite(video.duration) ? video.duration : Infinity));
                seekTo(nextTime);
            };

            event.preventDefault();
            showControls();
            switch (action) {
                case 'togglePlayback':
                    togglePlayback();
                    break;
                case 'seekBackward': seek(-5); break;
                case 'seekForward': seek(5); break;
                case 'volumeDown':
                case 'volumeUp': {
                    const nextVolume = Math.min(1, Math.max(0, video.volume + (action === 'volumeUp' ? .05 : -.05)));
                    video.muted = false;
                    video.volume = nextVolume;
                    setVolume(nextVolume);
                    setSettings(previous => ({ ...previous, player: { ...previous.player, volume: Math.round(nextVolume * 100) } }));
                    triggerVolumeOsd(Math.round(nextVolume * 100), nextVolume === 0);
                    break;
                }
                case 'toggleMute':
                    video.muted = !video.muted;
                    triggerVolumeOsd(Math.round(video.volume * 100), video.muted);
                    break;
                case 'toggleFullscreen':
                    if (document.fullscreenElement || (document as WebKitFullscreenDocument).webkitFullscreenElement) void exitFullscreenElement();
                    else void requestFullscreenElement(playerRef.current, videoRef.current);
                    break;
                case 'previousEpisode': if (previousEpisode) void changeEpisode(previousEpisode); break;
                case 'nextEpisode': if (nextEpisode) void changeEpisode(nextEpisode); break;
                case 'skipOpening':
                    if (settings.player.showSkipOpeningButton) seek(settings.player.skipOpeningValue);
                    break;
                case 'togglePictureInPicture':
                    void togglePictureInPicture();
                    break;
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [changeEpisode, isDownloadModalOpen, resumePromptTime, nextEpisodeCountdown, keybindings, nextEpisode, previousEpisode, seekTo, togglePlayback, setSettings, settings.player.showSkipOpeningButton, settings.player.skipOpeningValue, showControls, togglePictureInPicture, triggerVolumeOsd]);

    if (!stream) return <div ref={playerDialogRef} tabIndex={-1} className={styles.overlay} role="dialog" aria-modal="true" aria-label={t('player.ariaLabel')}>
        <div className={styles.player}>
            <div className={styles['resume-prompt']}>
                <div className={styles['resume-prompt-card']} role="alert">
                    <h2>{t('player.streamUnavailable')}</h2>
                    <p>{t('player.noStreams')}</p>
                    <div className={styles['resume-prompt-actions']}>
                        <button type="button" className={styles['resume-primary-button']} onClick={closePlayer}>{t('player.backToRelease')}</button>
                    </div>
                </div>
            </div>
        </div>
    </div>;

    return (
        <div ref={playerDialogRef} tabIndex={-1} className={styles.overlay} role="dialog" aria-modal="true" aria-label={t('player.ariaLabel')}>
            <div className={styles.player} ref={playerRef} onKeyDownCapture={event => { if (event.key === 'Tab') { keyboardControlsRef.current = true; showControls(); } }} onPointerMove={() => { keyboardControlsRef.current = false; showControls(); }} onPointerDown={() => { keyboardControlsRef.current = false; showControls(); }}>
                {Boolean(roomId && watchRoom?.roomId === roomId) && <ReactionOverlay />}
                <div data-player-controls onFocusCapture={showControls} onBlurCapture={() => window.requestAnimationFrame(showControls)} className={`${styles['player-controls']} ${!areControlsVisible ? styles['player-controls-hidden'] : ''}`}>
                    <div className={styles['playback-buttons']}>
                        <div className={styles['top-bar']}>
                            <button className={styles['back-button']} aria-label={roomId ? t('room.return') : t('player.backToRelease')} onClick={closePlayer}><img src={BackIcon} alt="" /></button>
                            <div className={styles['title-block']}>
                                <h3>{animeName}</h3>
                                {episodeNumber !== undefined && <p>{episodeName}</p>}
                            </div>
                        </div>
                        <div className={styles['flow-buttons']}>
                            <button type="button" aria-label={t('ux.previousEpisode')} className={styles['next-prev-buttons']} disabled={!canControlRoom || !previousEpisode || isEpisodeChanging} onClick={() => previousEpisode && void changeEpisode(previousEpisode)}><img src={PrevIcon} alt="" /></button>
                            <button
                                type="button"
                                className={styles['play-button']}
                                disabled={!canToggleRoomPlayback || (!roomId && isBuffering)}
                                aria-label={roomId ? t(watchRoom?.playback.intent === 'playing' ? 'player.pause' : 'player.play') : isBuffering ? t('player.loading') : isPlaying ? t('player.pause') : t('player.play')}
                                onClick={togglePlayback}
                            >
                                {isBuffering ? <span className={styles.spinner} aria-hidden="true" /> : <img src={isPlaying ? PauseIcon : PlayIcon} alt="" />}
                            </button>
                            <button type="button" aria-label={t('ux.nextEpisode')} className={styles['next-prev-buttons']} disabled={!canControlRoom || !nextEpisode || isEpisodeChanging} onClick={() => nextEpisode && void changeEpisode(nextEpisode)}><img src={NextIcon} alt="" /></button>
                        </div>
                    </div>

                    <div className={styles['action-buttons']}>
                        {roomId && <button type="button" className={styles['room-toggle']} aria-controls="watch-room-panel" aria-expanded={isRoomPanelOpen} onClick={() => setIsRoomPanelOpen(value => !value)}>{t('watchRoom.room')}</button>}
                        <span className={styles['time-code']}>
                            {formatTime(currentTime)} / {formatTime(duration)}
                        </span>
                        <div
                            className={`${styles['volume-div']} ${isVolumeDivExpanded ? styles['volume-expanded'] : ''}`}
                            onMouseEnter={() => setIsVolumeDivExpanded(true)}
                            onPointerDown={event => { if (event.pointerType === 'touch') setIsVolumeDivExpanded(true); }}
                            onMouseLeave={event => { if (!event.currentTarget.contains(document.activeElement)) setIsVolumeDivExpanded(false); }}
                            onFocus={() => setIsVolumeDivExpanded(true)}
                            onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setIsVolumeDivExpanded(false); }}
                        >
                            <button
                                aria-label={t(isMuted ? 'ux.unmute' : 'ux.mute')} className={`${styles['action-btn']} ${styles['mute-button']}`}
                                onClick={() => {
                                    const video = videoRef.current;
                                    if (!video) return;
                                    video.muted = !video.muted;
                                }}
                            >
                                <img src={isMuted ? VolumeMuteIcon : VolumeMaxIcon} alt="" />
                            </button>
                            {isVolumeDivExpanded && (
                                <input
                                    aria-label={t('ux.volume')} aria-valuetext={`${Math.round(volume * 100)}%`}
                                    type="range"
                                    min="0"
                                    max="1"
                                    value={volume}
                                    step="0.01"
                                    onChange={event => {
                                        const nextVolume = Number(event.target.value);
                                        setVolume(nextVolume);
                                        if (videoRef.current) videoRef.current.volume = nextVolume;
                                        setSettings(previous => ({
                                            ...previous,
                                            player: { ...previous.player, volume: Math.round(nextVolume * 100) },
                                        }));
                                    }}
                                />
                            )}
                        </div>

                        {settings.player.showSkipOpeningButton && (
                            <button aria-label={t('ux.skipOpening')}
                                className={styles['action-btn']}
                                onClick={() => {
                                    const video = videoRef.current;
                                    if (!video) return;

                                    const nextTime = Number.isFinite(video.duration)
                                        ? Math.min(video.currentTime + settings.player.skipOpeningValue, video.duration)
                                        : video.currentTime + settings.player.skipOpeningValue;

                                    seekTo(nextTime);
                                }}
                            >
                                <img src={SkipIcon} alt="" />
                            </button>
                        )}
                        <div className={styles['player-settings-wrap']}>
                            <button
                                type="button"
                                className={`${styles['action-btn']} ${isPlayerSettingsOpen ? styles['action-btn-active'] : ''}`}
                                onClick={() => setIsPlayerSettingsOpen(isOpen => !isOpen)}
                                aria-label={t('player.settings')}
                                aria-expanded={isPlayerSettingsOpen}
                            ><img src={SettingsIcon} alt="" /></button>
                            {isPlayerSettingsOpen && <div className={styles['player-settings-menu']}>
                                <section>
                                    <span className={styles['settings-label']}>{t('player.quality')}</span>
                                    <div className={styles['settings-options']}>
                                        {(['auto', ...qualities] as string[]).map(option => (
                                            <button
                                                key={option}
                                                type="button"
                                                className={requestedQuality === option ? styles.selected : ''}
                                                onClick={() => {
                                                    const nextQuality = option !== 'auto' && sources[option]?.[0] ? option : qualities[0];
                                                    const video = videoRef.current;
                                                    if (nextQuality !== selectedQuality && video) {
                                                        fallbackPositionRef.current = {
                                                            time: video.currentTime,
                                                            shouldPlay: !video.paused,
                                                        };
                                                    }
                                                    setFallbackQuality(null);
                                                    setSettings(previous => ({
                                                        ...previous,
                                                        player: { ...previous.player, defaultQuality: option as typeof previous.player.defaultQuality },
                                                    }));
                                                }}
                                            >{option === 'auto' ? t('player.autoQuality') : `${option}p`}</button>
                                        ))}
                                    </div>
                                </section>
                                <section className={styles['settings-toggle-row']}>
                                    <span>
                                        <strong>{t('player.qualityUpgrade')}</strong>
                                        <small>{webGpuStatus === 'checking'
                                            ? t('settings.qualityUpscale.webgpuChecking')
                                            : webGpuStatus === 'unsupported'
                                                ? t(isSafariBrowser()
                                                    ? 'settings.qualityUpscale.webgpuSafariNotSupported'
                                                    : 'settings.qualityUpscale.webgpuNotSupported')
                                                : 'Anime4K'}</small>
                                    </span>
                                    <label className={styles['player-toggle']}>
                                        <input
                                            type="checkbox"
                                            checked={settings.player.qualityUpgrade}
                                            disabled={webGpuStatus !== 'supported'}
                                            onChange={event => setSettings(previous => ({
                                                ...previous,
                                                player: { ...previous.player, qualityUpgrade: event.target.checked },
                                            }))}
                                        />
                                        <i />
                                    </label>
                                </section>
                                <section>
                                    <span className={styles['settings-label']}>{t('player.speed')}</span>
                                    <div className={styles['settings-options']}>
                                        {PLAYBACK_RATES.map(rate => (
                                            <button key={rate} type="button" disabled={!canControlRoom} className={displayedPlaybackRate === rate ? styles.selected : ''} onClick={() => {
                                                if (roomId) { if (videoRef.current) sendRoomPlayback('set_rate', videoRef.current.currentTime, rate); return; }
                                                setPlaybackRate(rate);
                                                try {
                                                    sessionStorage.setItem('anixweb_player_playback_rate', String(rate));
                                                } catch {
                                                    // Ignore storage errors in private browsing
                                                }
                                                if (videoRef.current) {
                                                    videoRef.current.playbackRate = rate;
                                                    sendRoomPlayback('set_rate', videoRef.current.currentTime, rate);
                                                }
                                            }}>{rate}×</button>
                                        ))}
                                    </div>
                                </section>
                                <section>
                                    <span className={styles['settings-label']}>{t('player.aspectRatio')}</span>
                                    <div className={styles['settings-options']}>
                                        {(Object.keys(ASPECT_RATIOS) as AspectRatio[]).map(ratio => (
                                            <button key={ratio} type="button" className={aspectRatio === ratio ? styles.selected : ''} onClick={() => setAspectRatio(ratio)}>{ratio === 'original' ? t('player.originalAspectRatio') : ratio}</button>
                                        ))}
                                    </div>
                                </section>
                            </div>}
                        </div>
                        <button
                            type="button"
                            className={`${styles['action-btn']} ${styles['download-icon-button']}`}
                            onClick={() => {
                                resetDownload();
                                setIsDownloadModalOpen(isOpen => !isOpen);
                                const preferred = downloadOptions.find(option => option.quality === selectedQuality && option.isDirectMp4)
                                    || downloadOptions.find(option => option.isDirectMp4);
                                setDownloadSelectedQuality(preferred?.quality || selectedQuality);
                            }}
                            aria-label={t('roadmap.player.download')}
                            aria-haspopup="dialog"
                            aria-expanded={isDownloadModalOpen}
                            title={t('roadmap.player.download')}
                        >
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                <polyline points="7 10 12 15 17 10" />
                                <line x1="12" y1="15" x2="12" y2="3" />
                            </svg>
                        </button>
                        {isPipSupported && (
                            <button
                                type="button"
                                className={`${styles['action-btn']} ${isPipActive ? styles['action-btn-active'] : ''}`}
                                onClick={() => void togglePictureInPicture()}
                                aria-label={t(isPipActive ? 'player.pipExit' : 'player.pip')}
                                aria-pressed={isPipActive}
                                title={t(isPipActive ? 'player.pipExit' : 'player.pip')}
                            >
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                    <rect x="2" y="4" width="20" height="16" rx="2" />
                                    <rect x="12" y="11" width="7" height="6" rx="1" fill={isPipActive ? 'currentColor' : 'none'} />
                                </svg>
                            </button>
                        )}
                        <button
                            aria-label={t(isMaximized ? 'ux.exitFullscreen' : 'ux.enterFullscreen')}
                            className={styles['action-btn']}
                            onClick={() => {
                                if (document.fullscreenElement !== null || (document as WebKitFullscreenDocument).webkitFullscreenElement) void exitFullscreenElement();
                                else void requestFullscreenElement(playerRef.current, videoRef.current);
                            }}
                        >
                            <img src={isMaximized ? CompressIcon : ExpandIcon} alt="" />
                        </button>
                    </div>
                    <div className={styles.timeline}>
                        <input
                            aria-label={t('ux.timeline')} aria-valuetext={`${formatTime(currentTime)} / ${formatTime(duration)}`}
                            type="range"
                            min="0"
                            max={Number.isFinite(duration) ? duration : 0}
                            value={Math.min(currentTime, duration || 0)}
                            style={{
                                '--progress': `${timelineProgress}%`,
                                '--buffered-progress': `${bufferedProgress}%`,
                            } as CSSProperties}
                            step="0.1"
                            disabled={!canControlRoom || !Number.isFinite(duration) || duration <= 0}
                            onInput={event => {
                                const nextTime = Number(event.currentTarget.value);
                                if (!roomId) seekTo(nextTime);
                            }}
                            onChange={event => { if (roomId) seekTo(Number(event.currentTarget.value)); }}
                        />
                    </div>
                </div>
                <div className={styles['video-stage']} onWheel={handleWheelVolume}>
                <div className={styles['video-frame']} style={videoFrameStyle}>
                <video
                    ref={videoRef}
                    preload="auto"
                    crossOrigin={settings.player.qualityUpgrade && webGpuStatus === 'supported' ? 'anonymous' : undefined}
                    onLoadStart={() => setIsBuffering(true)}
                    onWaiting={() => { setIsBuffering(true); bridgeRef.current?.buffering(); }}
                    onStalled={() => { setIsBuffering(true); bridgeRef.current?.buffering(); }}
                    onCanPlay={event => {
                        setIsBuffering(false);
                        if (roomId) { bridgeRef.current?.synchronize(); return; }
                        if (resumePendingRef.current) {
                            event.currentTarget.pause();
                            return;
                        }
                        if (autoplayAttemptedRef.current) return;
                        if (settings.player.autoPauseOnTabSwitch && (document.hidden || !windowFocusedRef.current)) {
                            wasAutoPausedRef.current = loadPlaybackRef.current !== false;
                            return;
                        }
                        autoplayAttemptedRef.current = true;
                        if (loadPlaybackRef.current === false) {
                            event.currentTarget.pause();
                            return;
                        }
                        if (event.currentTarget.paused) {
                            void event.currentTarget.play().catch(error => console.error('Не удалось автоматически запустить серию:', error));
                        }
                    }}
                    onPlay={() => {
                        setIsPlaying(true);
                        if (settings.player.autoFullscreen && !autoFullscreenTriggeredRef.current && !autoFullscreenPendingRef.current && !document.fullscreenElement && !(document as WebKitFullscreenDocument).webkitFullscreenElement && playerRef.current) {
                            autoFullscreenPendingRef.current = true;
                            const generation = fullscreenGenerationRef.current;
                            void requestFullscreenElement(playerRef.current, videoRef.current).then(success => {
                                if (generation !== fullscreenGenerationRef.current) return;
                                autoFullscreenPendingRef.current = false;
                                if (success) autoFullscreenTriggeredRef.current = true;
                            });
                        }
                    }}
                    onPlaying={() => { setIsBuffering(false); bridgeRef.current?.synchronize(); }}
                    onSeeked={() => bridgeRef.current?.synchronize()}
                    onPause={() => {
                        setIsPlaying(false);
                        if (!isAutoPausingRef.current) {
                            wasAutoPausedRef.current = false;
                        }
                        isAutoPausingRef.current = false;
                    }}
                    playsInline
                    className={styles.video}
                    onEnded={() => {
                        setIsPlaying(false);
                        saveEpisodeTime();
                        if (settings.player.autoplay && nextEpisode && (!roomId || watchRoom?.hostId === roomProfileId)) {
                            setNextEpisodeCountdown(5);
                        } else if (roomId && watchRoom?.hostId === roomProfileId && videoRef.current) {
                            sendRoomPlayback('pause', videoRef.current.currentTime);
                        }
                    }}
                    onEnterPictureInPicture={() => setIsPipActive(true)}
                    onLeavePictureInPicture={() => setIsPipActive(false)}
                    onLoadedMetadata={event => {
                        const video = event.currentTarget;
                        metadataLoadedRef.current = true;
                        setDuration(video.duration);
                        setNativeAspectRatio(video.videoWidth > 0 && video.videoHeight > 0
                            ? video.videoWidth / video.videoHeight
                            : null);
                        video.playbackRate = roomId && watchRoom ? watchRoom.playback.rate : playbackRate;
                        if (roomId) { fallbackPositionRef.current = null; bridgeRef.current?.loadedMetadata(); return; }

                        const fallbackPosition = fallbackPositionRef.current;
                        if (fallbackPosition) {
                            const nextTime = Number.isFinite(video.duration)
                                ? Math.min(fallbackPosition.time, Math.max(video.duration - 1, 0))
                                : fallbackPosition.time;
                            video.currentTime = nextTime;
                            setCurrentTime(nextTime);
                            fallbackPositionRef.current = null;
                            loadPlaybackRef.current = fallbackPosition.shouldPlay;
                            setStreamError(null);
                            return;
                        }

                        const savedTime = getWatchProgress()[String(animeId)]?.[episodeKey];
                        const canResume = settings.content.rememberEpisodeTime
                            && typeof savedTime === 'number'
                            && savedTime > 0
                            && Number.isFinite(video.duration)
                            && !roomId
                            && promptedEpisodeRef.current !== progressKey;

                        if (canResume) {
                            const resumeTime = Math.min(savedTime, Math.max(video.duration - 1, 0));
                            promptedEpisodeRef.current = progressKey;
                            resumePendingRef.current = true;
                            video.pause();
                            setResumePromptTime(resumeTime);
                        }
                    }}
                    onDurationChange={event => setDuration(event.currentTarget.duration)}
                    onError={event => {
                        if (playerClosedRef.current || !event.currentTarget.error || event.currentTarget.error.code === 1) return;
                        if (!switchToLowerQuality()) {
                            setStreamError(t('player.streamUnavailable'));
                            setIsBuffering(false);
                        }
                    }}
                    onProgress={event => setBufferedTime(getBufferedEnd(event.currentTarget))}
                    onTimeUpdate={event => setCurrentTime(event.currentTarget.currentTime)}
                    onVolumeChange={event => {
                        setVolume(event.currentTarget.volume);
                        setIsMuted(event.currentTarget.muted);
                    }}
                />
                <canvas ref={upscaleCanvasRef} className={`${styles['upscale-canvas']} ${isUpscalerReady ? styles['upscale-canvas-visible'] : ''}`} />
                </div>
                </div>
                {roomId && isRoomPanelOpen && <div id="watch-room-panel" className={styles['room-panel']}><RoomPanel compact /></div>}
                {roomId && streamError?.includes('Браузер') && <button className={styles['unlock-playback']} onClick={() => { void videoRef.current?.play().then(() => setStreamError(null)).catch(() => {}); }}>Включить видео</button>}
                {streamError && <div className={styles['stream-error']} role="status">{streamError}</div>}
                {volumeOsd && (
                    <div
                        className={`${styles['volume-osd']} ${volumeOsd.visible ? styles['volume-osd-visible'] : ''}`}
                        role="status"
                        aria-live="polite"
                        aria-label={t('player.volumeLevel', { percent: volumeOsd.level })}
                    >
                        <img src={volumeOsd.muted || volumeOsd.level === 0 ? VolumeMuteIcon : VolumeMaxIcon} alt="" />
                        <div className={styles['volume-osd-bar']}>
                            <div className={styles['volume-osd-fill']} style={{ width: `${volumeOsd.muted ? 0 : volumeOsd.level}%` }} />
                        </div>
                        <span className={styles['volume-osd-text']}>{volumeOsd.muted ? '0%' : `${volumeOsd.level}%`}</span>
                    </div>
                )}
                {nextEpisodeCountdown !== null && nextEpisode && (
                    <div
                        ref={countdownDialogRef}
                        tabIndex={-1}
                        className={styles['resume-prompt']}
                        role="dialog"
                        aria-modal="true"
                        aria-label={t('player.nextEpisodeCountdown', { seconds: nextEpisodeCountdown })}
                    >
                        <div className={styles['resume-prompt-card']}>
                            <h2>{t('player.nextEpisodeCountdown', { seconds: nextEpisodeCountdown })}</h2>
                            <p>{nextEpisode.name || t('player.episodeTitle', { number: nextEpisode.position })}</p>
                            <div className={styles['resume-prompt-actions']}>
                                <button
                                    type="button"
                                    className={styles['resume-secondary-button']}
                                    onClick={() => setNextEpisodeCountdown(null)}
                                >
                                    {t('player.cancelAutoplay')}
                                </button>
                                <button
                                    type="button"
                                    className={styles['resume-primary-button']}
                                    onClick={() => {
                                        setNextEpisodeCountdown(null);
                                        void changeEpisode(nextEpisode);
                                    }}
                                >
                                    {t('player.playNow')}
                                </button>
                            </div>
                        </div>
                    </div>
                )}
                {resumePromptTime !== null && <div ref={resumeDialogRef} tabIndex={-1} className={styles['resume-prompt']} role="dialog" aria-modal="true" aria-label={t('misc.continue')}>
                    <div className={styles['resume-prompt-card']}>
                        <h2>{t('misc.continue')}?</h2>
                        <p>{t('dubSelect.watchedUntil')} {formatTime(resumePromptTime)}.</p>
                        <div className={styles['resume-prompt-actions']}>
                            <button type="button" className={styles['resume-secondary-button']} onClick={() => startFrom(0)}>{t('player.startOver')}</button>
                            <button type="button" className={styles['resume-primary-button']} onClick={() => startFrom(resumePromptTime)}>{t('misc.continue')}</button>
                        </div>
                    </div>
                </div>}
                {isDownloadModalOpen && (
                    <div ref={downloadDialogRef} tabIndex={-1} className={styles['download-modal-overlay']} role="dialog" aria-modal="true" aria-label={t('roadmap.player.downloadModalTitle')}>
                        <div className={styles['download-card']}>
                            <div className={styles['download-header']}>
                                <h3>{t('roadmap.player.downloadModalTitle')}</h3>
                                <button
                                    type="button"
                                    className={styles['download-close-btn']}
                                    onClick={() => {
                                        resetDownload();
                                        setIsDownloadModalOpen(false);
                                    }}
                                    aria-label={t('roadmap.player.downloadClose')}
                                >×</button>
                            </div>
                            <p className={styles['download-meta']}>{animeName} · {episodeName || t('player.episodeTitle', { number: episodeNumber })}</p>
                            <p>{t('roadmap.player.downloadLimit')}</p>

                            <div className={styles['download-section-title']}>{t('roadmap.player.downloadSelectQuality')}</div>
                            <div className={styles['download-qualities']}>
                                {downloadOptions.map(option => {
                                    const q = option.quality;
                                    const isDirect = option.isDirectMp4;
                                    const currentQ = downloadSelectedQuality || selectedQuality;
                                    const isSelected = currentQ === q;

                                    return (
                                        <button
                                            key={q}
                                            type="button"
                                            disabled={downloadStatus === 'downloading'}
                                            aria-pressed={isSelected}
                                            className={`${styles['download-quality-chip']} ${isSelected ? styles.selected : ''}`}
                                            onClick={() => {
                                                setDownloadSelectedQuality(q);
                                                resetDownload();
                                            }}
                                        >
                                            <span>{q}p</span>
                                            <span className={isDirect ? styles['download-badge-mp4'] : styles['download-badge-hls']}>
                                                {isDirect ? 'MP4' : option.isHls ? 'HLS' : '—'}
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>

                            {(() => {
                                const activeQ = downloadSelectedQuality || selectedQuality;
                                const activeStream = downloadOptions.find(option => option.quality === activeQ);
                                const isHls = activeStream ? isHlsStream(activeStream) : false;
                                const isDirect = activeStream ? isDirectMp4Stream(activeStream) : false;

                                if (downloadStatus === 'downloading') {
                                    return (
                                        <div className={styles['download-progress-wrap']}>
                                            <div className={styles['download-progress-bar']} role="progressbar" aria-label={t('roadmap.player.download')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={downloadProgress.total > 0 || downloadProgress.totalSegments ? downloadProgress.percent : undefined}>
                                                <div className={`${styles['download-progress-fill']} ${downloadProgress.total === 0 && !downloadProgress.totalSegments ? styles['download-progress-indeterminate'] : ''}`} style={downloadProgress.total > 0 || downloadProgress.totalSegments ? { width: `${downloadProgress.percent}%` } : undefined} />
                                            </div>
                                            <div className={styles['download-progress-text']}>
                                                <span>{downloadProgress.total > 0 || downloadProgress.totalSegments ? `${downloadProgress.percent}%` : downloadProgress.loaded > 0 ? t('roadmap.player.downloadStatusIndeterminate', { loaded: formatBytes(downloadProgress.loaded) }) : t('roadmap.player.downloadStatusConnecting')}</span>
                                                <span>{downloadProgress.totalSegments ? `${downloadProgress.completedSegments}/${downloadProgress.totalSegments} · ${formatBytes(downloadProgress.loaded)}` : `${formatBytes(downloadProgress.loaded)} / ${downloadProgress.total > 0 ? formatBytes(downloadProgress.total) : '…'}`}</span>
                                            </div>
                                        </div>
                                    );
                                }

                                if (downloadStatus === 'completed') {
                                    return <div className={styles['download-status-complete']}>{t('roadmap.player.downloadStatusComplete')}</div>;
                                }

                                if (downloadStatus === 'error') {
                                    return <div className={styles['download-status-error']}>{downloadError || t('roadmap.player.downloadStatusError')}</div>;
                                }

                                if (downloadStatus === 'cancelled') {
                                    return <div className={styles['download-warning']}>{t('roadmap.player.downloadStatusCancelled')}</div>;
                                }

                                if (isHls && !isDirect) {
                                    return <div className={styles['download-warning']}>{t('roadmap.player.downloadHlsInfo')}</div>;
                                }

                                return null;
                            })()}

                            <div className={styles['download-actions']}>
                                {downloadStatus === 'downloading' ? (
                                    <button type="button" className={styles['download-btn-secondary']} onClick={cancelDownload}>
                                        {t('roadmap.player.downloadCancel')}
                                    </button>
                                ) : (
                                    <>
                                        <button
                                            type="button"
                                            className={styles['download-btn-secondary']}
                                            onClick={() => {
                                                resetDownload();
                                                setIsDownloadModalOpen(false);
                                            }}
                                        >
                                            {t('roadmap.player.downloadClose')}
                                        </button>
                                        {(() => {
                                            const activeQ = downloadSelectedQuality || selectedQuality;
                                            const activeStream = downloadOptions.find(option => option.quality === activeQ);
                                            const canDownload = activeStream && (activeStream.isDirectMp4 || activeStream.isHls);

                                            if (canDownload && downloadStatus !== 'completed') {
                                                return (
                                                    <button
                                                        type="button"
                                                        className={styles['download-btn-primary']}
                                                        onClick={() => {
                                                            if (!activeStream) return;
                                                            const epNum = episodeNumber !== undefined ? episodeNumber : 1;
                                                            const rawName = `${animeName} - Ep ${epNum} (${activeQ}p).mp4`;
                                                            const filename = sanitizeFilename(rawName);
                                                            void startDownload({ stream: activeStream, filename });
                                                        }}
                                                    >
                                                        {t('roadmap.player.downloadStart')}
                                                    </button>
                                                );
                                            }
                                            return null;
                                        })()}
                                    </>
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

function formatTime(seconds: number) {
    if (!Number.isFinite(seconds) || seconds < 0) return '0:00';

    const totalSeconds = Math.floor(seconds);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const remainingSeconds = String(totalSeconds % 60).padStart(2, '0');
    const paddedMinutes = String(minutes).padStart(2, '0');

    return hours > 0
        ? `${String(hours).padStart(2, '0')}:${paddedMinutes}:${remainingSeconds}`
        : `${paddedMinutes}:${remainingSeconds}`;
}

function getBufferedEnd(video: HTMLVideoElement) {
    let bufferedEnd = 0;

    for (let index = 0; index < video.buffered.length; index += 1) {
        const rangeStart = video.buffered.start(index);
        const rangeEnd = video.buffered.end(index);

        if (rangeStart <= video.currentTime && rangeEnd >= video.currentTime) return rangeEnd;
        bufferedEnd = Math.max(bufferedEnd, rangeEnd);
    }

    return bufferedEnd;
}
