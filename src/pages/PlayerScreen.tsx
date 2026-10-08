import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
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
import RoomPanel from '../components/RoomPanel';
import { useRoomPresence } from '../shared/contexts/roomContext';
import { useApi } from '../shared/apiClient';
import { createUpscalerScope } from '../shared/upscalerScope';
import { getCorsProxyUrl } from '../shared/proxy';

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
            return <PlayerContent key={roomId + ':' + version} playerSession={resolved.session} onSessionChange={updateSession} roomId={roomId} />;
        }
        return <div className={styles.overlay}><div className={styles['room-loading']}>
            <RoomPanel compact />
            <p role="status">{resolveError || error || (!roomMedia && status === 'connected' ? 'В комнате ещё не выбрана серия' : 'Загрузка видео…')}</p>
            {resolveError && <button onClick={() => setReload(value => value + 1)}>Повторить</button>}
            <button onClick={() => navigate('/together/' + encodeURIComponent(roomId))}>Вернуться в комнату</button>
        </div></div>;
    }
    if (!playerSession) return <Navigate to="/" replace />;
    return <PlayerContent playerSession={playerSession} onSessionChange={updateSession} roomId={null} />;
}

function PlayerContent({ playerSession, onSessionChange, roomId }: { playerSession: PlayerSession; onSessionChange: (session: PlayerSession) => void; roomId: string | null }) {
    const navigate = useNavigate();
    const { settings, setSettings } = useSettings();
    const { t } = useTranslation();
    const { userToken, userId } = useUser();
    const api = useApi();
    const { room: watchRoom, status: roomStatus, send, serverNow, self } = useRoomPresence();
    const roomProfileId = self?.profileId ?? userId;
    const canControlRoom = !roomId || (roomStatus === 'connected' && Boolean(watchRoom?.participants.some(participant => participant.profileId === roomProfileId && participant.canControl)));
    const playerRef = useRef<HTMLDivElement>(null);
    const videoRef = useRef<HTMLVideoElement>(null);
    const upscaleCanvasRef = useRef<HTMLCanvasElement>(null);
    const controlsTimeoutRef = useRef<number | null>(null);
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
    const [playbackRate, setPlaybackRate] = useState(1);
    const displayedPlaybackRate = roomId && watchRoom ? watchRoom.playback.rate : playbackRate;
    const [aspectRatio, setAspectRatio] = useState<AspectRatio>('original');
    const [nativeAspectRatio, setNativeAspectRatio] = useState<number | null>(null);
    const [viewport, setViewport] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));
    const [upscalerReadyKey, setUpscalerReadyKey] = useState<string | null>(null);
    const [isEpisodeChanging, setIsEpisodeChanging] = useState(false);
    const [resumePromptTime, setResumePromptTime] = useState<number | null>(null);
    const [streamError, setStreamError] = useState<string | null>(null);
    const promptedEpisodeRef = useRef<string | null>(null);
    const autoplayAttemptedRef = useRef(false);
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
    const keybindings = settings.player.keybindings ?? defaultPlayerKeybindings;

    const stream = sources[selectedQuality]?.[0];

    const timelineProgress = Number.isFinite(duration) && duration > 0
        ? Math.min((currentTime / duration) * 100, 100)
        : 0;
    const bufferedProgress = Number.isFinite(duration) && duration > 0
        ? Math.max(timelineProgress, Math.min((bufferedTime / duration) * 100, 100))
        : 0;
    const episodeKey = String(episodeNumber ?? 'unknown');
    const progressKey = `${animeId}:${episodeKey}`;
    useEffect(() => {
        playerClosedRef.current = false;
        return () => {
            playerClosedRef.current = true;
            episodeRequestRef.current += 1;
            episodeChangePendingRef.current = false;
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
        if (!roomId || !canControlRoom) return;
        void send(type === 'set_rate' ? { type, position, rate: rate ?? 1 } : { type, position }).catch(error => setStreamError(String(error)));
    }, [canControlRoom, roomId, send]);

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
        const video = videoRef.current;
        if (!video || !canControlRoom) return;
        if (roomId) { sendRoomPlayback(watchRoom?.playback.intent === 'playing' ? 'pause' : 'play', video.currentTime); return; }
        if (video.paused) void video.play(); else video.pause();
    }, [canControlRoom, roomId, sendRoomPlayback, watchRoom?.playback.intent]);
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
        episodeRequestRef.current += 1;
        saveEpisodeTime();
        clearPlayerSession();
        navigate(roomId ? `/together/${encodeURIComponent(roomId)}` : `/anime/${animeId}`);
    };

    const showControls = useCallback(() => {
        setAreControlsVisible(true);
        if (controlsTimeoutRef.current !== null) window.clearTimeout(controlsTimeoutRef.current);
        if (!isPlaying || isPlayerSettingsOpen || resumePromptTime !== null) return;

        controlsTimeoutRef.current = window.setTimeout(() => setAreControlsVisible(false), 2_500);
    }, [isPlaying, isPlayerSettingsOpen, resumePromptTime]);

    useEffect(() => {
        const updateFullscreen = () => setIsMaximized(document.fullscreenElement !== null);
        document.addEventListener('fullscreenchange', updateFullscreen);
        return () => document.removeEventListener('fullscreenchange', updateFullscreen);
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

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
            const target = event.target;
            if (target instanceof HTMLElement && target.closest('input, textarea, select, [contenteditable="true"]')) return;

            const action = Object.entries(keybindings).find(([, code]) => code === event.code)?.[0];
            if (!action) return;

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
                    break;
                }
                case 'toggleMute': video.muted = !video.muted; break;
                case 'toggleFullscreen':
                    if (document.fullscreenElement) void document.exitFullscreen();
                    else void playerRef.current?.requestFullscreen();
                    break;
                case 'previousEpisode': if (previousEpisode) void changeEpisode(previousEpisode); break;
                case 'nextEpisode': if (nextEpisode) void changeEpisode(nextEpisode); break;
                case 'skipOpening':
                    if (settings.player.showSkipOpeningButton) seek(settings.player.skipOpeningValue);
                    break;
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [changeEpisode, keybindings, nextEpisode, previousEpisode, seekTo, togglePlayback, setSettings, settings.player.showSkipOpeningButton, settings.player.skipOpeningValue, showControls]);

    if (!stream) return <div className={styles.overlay} role="dialog" aria-modal="true" aria-label={t('player.ariaLabel')}>
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
        <div className={styles.overlay} role="dialog" aria-modal="true" aria-label={t('player.ariaLabel')}>
            <div className={styles.player} ref={playerRef} onPointerMove={showControls} onPointerDown={showControls}>
                <div className={`${styles['player-controls']} ${!areControlsVisible ? styles['player-controls-hidden'] : ''}`}>
                    <div className={styles['playback-buttons']}>
                        <div className={styles['top-bar']}>
                            <button className={styles['back-button']} aria-label={roomId ? t('room.return') : t('player.backToRelease')} onClick={closePlayer}><img src={BackIcon} alt="" /></button>
                            <div className={styles['title-block']}>
                                <h3>{animeName}</h3>
                                {episodeNumber !== undefined && <p>{episodeName}</p>}
                            </div>
                        </div>
                        <div className={styles['flow-buttons']}>
                            <button type="button" className={styles['next-prev-buttons']} disabled={!canControlRoom || !previousEpisode || isEpisodeChanging} onClick={() => previousEpisode && void changeEpisode(previousEpisode)}><img src={PrevIcon} /></button>
                            <button
                                type="button"
                                className={styles['play-button']}
                                disabled={!canControlRoom || (!roomId && isBuffering)}
                                aria-label={roomId ? t(watchRoom?.playback.intent === 'playing' ? 'player.pause' : 'player.play') : isBuffering ? t('player.loading') : isPlaying ? t('player.pause') : t('player.play')}
                                onClick={togglePlayback}
                            >
                                {isBuffering ? <span className={styles.spinner} aria-hidden="true" /> : <img src={isPlaying ? PauseIcon : PlayIcon} />}
                            </button>
                            <button type="button" className={styles['next-prev-buttons']} disabled={!canControlRoom || !nextEpisode || isEpisodeChanging} onClick={() => nextEpisode && void changeEpisode(nextEpisode)}><img src={NextIcon} /></button>
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
                            onMouseLeave={() => setIsVolumeDivExpanded(false)}
                        >
                            <button
                                className={`${styles['action-btn']} ${styles['mute-button']}`}
                                onClick={() => {
                                    const video = videoRef.current;
                                    if (!video) return;
                                    video.muted = !video.muted;
                                }}
                            >
                                <img src={isMuted ? VolumeMuteIcon : VolumeMaxIcon} />
                            </button>
                            {isVolumeDivExpanded && (
                                <input
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
                            <button
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
                                <img src={SkipIcon} />
                            </button>
                        )}
                        <div className={styles['player-settings-wrap']}>
                            <button
                                type="button"
                                className={`${styles['action-btn']} ${isPlayerSettingsOpen ? styles['action-btn-active'] : ''}`}
                                onClick={() => setIsPlayerSettingsOpen(isOpen => !isOpen)}
                                aria-label={t('player.settings')}
                                aria-expanded={isPlayerSettingsOpen}
                            ><img src={SettingsIcon} /></button>
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
                            className={styles['action-btn']}
                            onClick={() => {
                                if (document.fullscreenElement !== null) void document.exitFullscreen();
                                else void playerRef.current?.requestFullscreen();
                            }}
                        >
                            <img src={isMaximized ? CompressIcon : ExpandIcon} alt="" />
                        </button>
                    </div>
                    <div className={styles.timeline}>
                        <input
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
                <div className={styles['video-stage']}>
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
                        autoplayAttemptedRef.current = true;
                        if (loadPlaybackRef.current === false) {
                            event.currentTarget.pause();
                            return;
                        }
                        if (event.currentTarget.paused) {
                            void event.currentTarget.play().catch(error => console.error('Не удалось автоматически запустить серию:', error));
                        }
                    }}
                    onPlay={() => setIsPlaying(true)}
                    onPlaying={() => { setIsBuffering(false); bridgeRef.current?.synchronize(); }}
                    onSeeked={() => bridgeRef.current?.synchronize()}
                    onPause={() => setIsPlaying(false)}
                    playsInline
                    className={styles.video}
                    onEnded={() => {
                        setIsPlaying(false);
                        saveEpisodeTime();
                        if (settings.player.autoplay && nextEpisode && (!roomId || watchRoom?.hostId === roomProfileId)) {
                            void changeEpisode(nextEpisode);
                        } else if (roomId && watchRoom?.hostId === roomProfileId && videoRef.current) {
                            sendRoomPlayback('pause', videoRef.current.currentTime);
                        }
                    }}
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
                {resumePromptTime !== null && <div className={styles['resume-prompt']} role="dialog" aria-modal="true" aria-label={t('misc.continue')}>
                    <div className={styles['resume-prompt-card']}>
                        <h2>{t('misc.continue')}?</h2>
                        <p>{t('dubSelect.watchedUntil')} {formatTime(resumePromptTime)}.</p>
                        <div className={styles['resume-prompt-actions']}>
                            <button type="button" className={styles['resume-secondary-button']} onClick={() => startFrom(0)}>{t('player.startOver')}</button>
                            <button type="button" className={styles['resume-primary-button']} onClick={() => startFrom(resumePromptTime)}>{t('misc.continue')}</button>
                        </div>
                    </div>
                </div>}
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
