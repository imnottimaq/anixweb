import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from '../shared/useTranslation';
import type { TranslationKey } from '../shared/i18n';
import styles from './VoiceRecorder.module.css';

import { MAX_ATTACHMENT_BYTES, MAX_VOICE_DURATION_MS } from '../shared/roomProtocol';
export { MAX_ATTACHMENT_BYTES, MAX_VOICE_DURATION_MS };

export interface VoiceRecordingData {
    blob: Blob;
    durationMs: number;
    name: string;
}

export interface VoiceRecorderProps {
    disabled?: boolean;
    compact?: boolean;
    onSend: (data: VoiceRecordingData) => Promise<void>;
    onCancel?: () => void;
}

interface DraftRecording {
    blob: Blob;
    durationMs: number;
    name: string;
    previewUrl: string;
}

type RecorderUIState = 'idle' | 'recording' | 'preview';

const MIME_CANDIDATES = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/ogg',
    'audio/mp4',
];

function getSupportedMimeType(): string | undefined {
    if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
        return undefined;
    }
    for (const candidate of MIME_CANDIDATES) {
        try {
            if (MediaRecorder.isTypeSupported(candidate)) {
                return candidate;
            }
        } catch {
            // Ignore browsers throwing on unexpected mime check
        }
    }
    return undefined;
}

function getExtensionForMime(mime?: string): string {
    if (!mime) return 'webm';
    const lower = mime.toLowerCase();
    if (lower.includes('webm')) return 'webm';
    if (lower.includes('ogg')) return 'ogg';
    if (lower.includes('mp4')) return 'mp4';
    if (lower.includes('aac')) return 'aac';
    if (lower.includes('m4a')) return 'm4a';
    return 'webm';
}

function formatDuration(ms: number): string {
    const totalSeconds = Math.floor(Math.max(0, ms) / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function stopMediaStream(stream: MediaStream | null | undefined): void {
    if (!stream) return;
    try {
        const tracks = stream.getTracks();
        for (const track of tracks) {
            try {
                track.stop();
            } catch {
                // Ignore track stop failure
            }
        }
    } catch {
        // Ignore stream track access error
    }
}

const FALLBACKS_EN: Record<string, string> = {
    'roomSocial.recordVoice': 'Record voice message',
    'roomSocial.stopRecording': 'Stop recording',
    'roomSocial.cancelRecording': 'Cancel recording',
    'roomSocial.sendVoice': 'Send voice message',
    'roomSocial.voicePermissionDenied': 'Microphone permission denied',
    'roomSocial.voiceUnsupported': 'Voice recording is not supported in this browser',
    'roomSocial.voiceLimitExceeded': 'Recording exceeded maximum allowed duration or size',
    'roomSocial.sendError': 'Failed to send message',
};

const FALLBACKS_RU: Record<string, string> = {
    'roomSocial.recordVoice': 'Записать голосовое сообщение',
    'roomSocial.stopRecording': 'Остановить запись',
    'roomSocial.cancelRecording': 'Отменить запись',
    'roomSocial.sendVoice': 'Отправить голосовое',
    'roomSocial.voicePermissionDenied': 'Доступ к микрофону запрещён',
    'roomSocial.voiceUnsupported': 'Запись голоса не поддерживается в этом браузере',
    'roomSocial.voiceLimitExceeded': 'Превышен лимит длительности или размера записи',
    'roomSocial.sendError': 'Не удалось отправить сообщение',
};

export default function VoiceRecorder({
    disabled = false,
    compact = false,
    onSend,
    onCancel,
}: VoiceRecorderProps) {
    const { t, language } = useTranslation();

    const translate = useCallback((key: string): string => {
        try {
            const val = t(key as unknown as TranslationKey);
            if (val && val !== key) {
                return val;
            }
        } catch {
            // Ignore translation error
        }
        const isEnglish = language === 'english' || (language as string) === 'en';
        const dict = isEnglish ? FALLBACKS_EN : FALLBACKS_RU;
        return dict[key] ?? FALLBACKS_EN[key] ?? key;
    }, [t, language]);

    const [state, setState] = useState<RecorderUIState>('idle');
    const [elapsedMs, setElapsedMs] = useState(0);
    const [draft, setDraft] = useState<DraftRecording | null>(null);
    const [isSending, setIsSending] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const streamRef = useRef<MediaStream | null>(null);
    const recorderRef = useRef<MediaRecorder | null>(null);
    const chunksRef = useRef<Blob[]>([]);
    const totalBytesRef = useRef(0);
    const sizeExceededRef = useRef(false);
    const startTimeRef = useRef<number>(0);
    const previewUrlRef = useRef<string | null>(null);

    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const autoStopTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const isCancelledOrUnmountedRef = useRef(false);
    const pendingMediaPromiseRef = useRef(false);
    const sessionGenerationRef = useRef(0);

    const cleanupPreviewUrl = useCallback(() => {
        if (previewUrlRef.current) {
            try {
                URL.revokeObjectURL(previewUrlRef.current);
            } catch {
                // Ignore URL revocation error
            }
            previewUrlRef.current = null;
        }
    }, []);

    const cleanupTimers = useCallback(() => {
        if (intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
        }
        if (autoStopTimeoutRef.current) {
            clearTimeout(autoStopTimeoutRef.current);
            autoStopTimeoutRef.current = null;
        }
    }, []);

    const cleanupStream = useCallback(() => {
        if (streamRef.current) {
            stopMediaStream(streamRef.current);
            streamRef.current = null;
        }
    }, []);

    const stopKeyPropagation = useCallback((e: React.KeyboardEvent) => {
        e.stopPropagation();
    }, []);

    // Unmount cleanup
    useEffect(() => {
        const sessionGenRef = sessionGenerationRef;
        return () => {
            isCancelledOrUnmountedRef.current = true;
            pendingMediaPromiseRef.current = false;
            sessionGenRef.current++;

            cleanupTimers();
            cleanupStream();

            const recorder = recorderRef.current;
            if (recorder) {
                recorder.onstop = null;
                recorder.ondataavailable = null;
                recorder.onerror = null;
                if (recorder.state === 'recording') {
                    try {
                        recorder.stop();
                    } catch {
                        // Ignore recorder stop error
                    }
                }
            }
            recorderRef.current = null;
            cleanupPreviewUrl();
        };
    }, [cleanupTimers, cleanupStream, cleanupPreviewUrl]);

    const handleStopRecording = useCallback(() => {
        cleanupTimers();
        const recorder = recorderRef.current;
        if (!recorder) {
            // Stopped while media stream request is pending: invalidate generation so late stream is released without starting recorder
            sessionGenerationRef.current++;
            cleanupStream();
            setState('idle');
            return;
        }

        cleanupStream();

        if (recorder.state === 'recording') {
            try {
                recorder.stop();
            } catch {
                // Ignore recorder stop error
            }
        }
    }, [cleanupTimers, cleanupStream]);

    const handleCancel = useCallback(() => {
        isCancelledOrUnmountedRef.current = true;
        pendingMediaPromiseRef.current = false;
        sessionGenerationRef.current++;

        cleanupTimers();
        cleanupStream();

        const recorder = recorderRef.current;
        if (recorder) {
            recorder.onstop = null;
            recorder.ondataavailable = null;
            recorder.onerror = null;
            if (recorder.state === 'recording') {
                try {
                    recorder.stop();
                } catch {
                    // Ignore
                }
            }
        }
        recorderRef.current = null;
        chunksRef.current = [];
        totalBytesRef.current = 0;
        sizeExceededRef.current = false;

        cleanupPreviewUrl();
        setDraft(null);
        setError(null);
        setElapsedMs(0);
        setState('idle');

        onCancel?.();
    }, [cleanupTimers, cleanupStream, cleanupPreviewUrl, onCancel]);

    const handleDiscard = useCallback(() => {
        cleanupPreviewUrl();
        setDraft(null);
        setError(null);
        setElapsedMs(0);
        setState('idle');
        onCancel?.();
    }, [cleanupPreviewUrl, onCancel]);

    const handleStartRecording = useCallback(async () => {
        setError(null);

        if (
            typeof navigator === 'undefined' ||
            !navigator.mediaDevices ||
            typeof navigator.mediaDevices.getUserMedia !== 'function' ||
            typeof MediaRecorder === 'undefined'
        ) {
            setError(translate('roomSocial.voiceUnsupported'));
            return;
        }

        cleanupPreviewUrl();
        setDraft(null);
        chunksRef.current = [];
        totalBytesRef.current = 0;
        sizeExceededRef.current = false;
        isCancelledOrUnmountedRef.current = false;
        pendingMediaPromiseRef.current = true;

        const sessionGen = ++sessionGenerationRef.current;

        setState('recording');
        setElapsedMs(0);

        let stream: MediaStream;
        try {
            stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        } catch (err: unknown) {
            pendingMediaPromiseRef.current = false;
            if (sessionGen !== sessionGenerationRef.current || isCancelledOrUnmountedRef.current) {
                return;
            }
            setState('idle');
            const errName =
                (err && typeof err === 'object' && 'name' in err && typeof (err as { name: unknown }).name === 'string')
                    ? (err as { name: string }).name
                    : (err instanceof Error ? err.name : '');
            if (
                errName === 'NotAllowedError' ||
                errName === 'PermissionDeniedError' ||
                errName === 'SecurityError'
            ) {
                setError(translate('roomSocial.voicePermissionDenied'));
            } else {
                setError(translate('roomSocial.voiceUnsupported'));
            }
            return;
        }

        pendingMediaPromiseRef.current = false;

        // Late async cleanup: if user cancelled or unmounted while getUserMedia was pending
        if (sessionGen !== sessionGenerationRef.current || isCancelledOrUnmountedRef.current) {
            stopMediaStream(stream);
            return;
        }

        streamRef.current = stream;

        const preferredMime = getSupportedMimeType();
        let recorder: MediaRecorder;
        try {
            const options: MediaRecorderOptions = preferredMime ? { mimeType: preferredMime } : {};
            recorder = new MediaRecorder(stream, options);
        } catch {
            try {
                recorder = new MediaRecorder(stream);
            } catch {
                stopMediaStream(stream);
                if (streamRef.current === stream) streamRef.current = null;
                setState('idle');
                setError(translate('roomSocial.voiceUnsupported'));
                return;
            }
        }

        recorderRef.current = recorder;
        startTimeRef.current = Date.now();

        recorder.ondataavailable = (event: BlobEvent) => {
            if (sessionGen !== sessionGenerationRef.current) {
                return;
            }
            if (event.data && event.data.size > 0) {
                chunksRef.current.push(event.data);
                totalBytesRef.current += event.data.size;
                if (totalBytesRef.current > MAX_ATTACHMENT_BYTES) {
                    sizeExceededRef.current = true;
                    if (recorder.state === 'recording') {
                        try {
                            recorder.stop();
                        } catch {
                            // Ignore
                        }
                    }
                }
            }
        };

        recorder.onstop = () => {
            if (sessionGen !== sessionGenerationRef.current) {
                return;
            }
            cleanupTimers();
            stopMediaStream(stream);
            if (streamRef.current === stream) {
                streamRef.current = null;
            }

            if (isCancelledOrUnmountedRef.current) {
                return;
            }

            if (sizeExceededRef.current || totalBytesRef.current > MAX_ATTACHMENT_BYTES) {
                setError(translate('roomSocial.voiceLimitExceeded'));
                setState('idle');
                return;
            }

            const effectiveMime = recorder.mimeType || preferredMime || 'audio/webm';
            const blob = new Blob(chunksRef.current, { type: effectiveMime });

            if (blob.size > MAX_ATTACHMENT_BYTES) {
                setError(translate('roomSocial.voiceLimitExceeded'));
                setState('idle');
                return;
            }

            const elapsed = Date.now() - startTimeRef.current;
            const durationMs = Math.min(Math.max(elapsed, 0), MAX_VOICE_DURATION_MS);
            const ext = getExtensionForMime(effectiveMime);
            const name = `voice-message.${ext}`;

            cleanupPreviewUrl();
            const previewUrl = URL.createObjectURL(blob);
            previewUrlRef.current = previewUrl;

            setDraft({ blob, durationMs, name, previewUrl });
            setState('preview');
        };

        recorder.onerror = () => {
            if (sessionGen !== sessionGenerationRef.current) {
                return;
            }
            cleanupTimers();
            stopMediaStream(stream);
            if (streamRef.current === stream) {
                streamRef.current = null;
            }
            if (!isCancelledOrUnmountedRef.current) {
                setState('idle');
                setError(translate('roomSocial.voiceUnsupported'));
            }
        };

        try {
            recorder.start(500);
        } catch {
            cleanupTimers();
            cleanupStream();
            setState('idle');
            setError(translate('roomSocial.voiceUnsupported'));
            return;
        }

        // Ticking timer for UI
        intervalRef.current = setInterval(() => {
            const currentElapsed = Date.now() - startTimeRef.current;
            if (currentElapsed >= MAX_VOICE_DURATION_MS) {
                setElapsedMs(MAX_VOICE_DURATION_MS);
                handleStopRecording();
            } else {
                setElapsedMs(currentElapsed);
            }
        }, 200);

        // Auto-stop cap at 120s
        autoStopTimeoutRef.current = setTimeout(() => {
            handleStopRecording();
        }, MAX_VOICE_DURATION_MS);
    }, [
        cleanupPreviewUrl,
        cleanupStream,
        cleanupTimers,
        handleStopRecording,
        translate,
    ]);

    useEffect(() => {
        if (!disabled || state !== 'recording') return;
        let cancelled = false;
        void Promise.resolve().then(() => { if (!cancelled) handleStopRecording(); });
        return () => { cancelled = true; };
    }, [disabled, state, handleStopRecording]);

    const handleSend = useCallback(async () => {
        if (!draft || isSending || disabled) return;
        const generation = sessionGenerationRef.current;

        setIsSending(true);
        setError(null);

        try {
            await onSend({
                blob: draft.blob,
                durationMs: draft.durationMs,
                name: draft.name,
            });

            if (generation !== sessionGenerationRef.current) return;
            cleanupPreviewUrl();
            setDraft(null);
            setElapsedMs(0);
            setState('idle');
        } catch (err: unknown) {
            if (generation !== sessionGenerationRef.current) return;
            // Preserve draft on send failure for retry
            const msg = err instanceof Error ? err.message : translate('roomSocial.sendError');
            setError(msg);
        } finally {
            if (generation === sessionGenerationRef.current) setIsSending(false);
        }
    }, [draft, isSending, disabled, onSend, cleanupPreviewUrl, translate]);

    return (
        <div
            className={`${styles.container} ${compact ? styles.compact : ''}`}
            onKeyDown={stopKeyPropagation}
        >
            {state === 'idle' && (
                <button
                    type="button"
                    className={styles.recordButton}
                    disabled={disabled}
                    onClick={handleStartRecording}
                    aria-label={translate('roomSocial.recordVoice')}
                    title={translate('roomSocial.recordVoice')}
                    onKeyDown={stopKeyPropagation}
                >
                    <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="currentColor"
                        aria-hidden="true"
                    >
                        <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
                        <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
                    </svg>
                    {!compact && <span>{translate('roomSocial.recordVoice')}</span>}
                </button>
            )}

            {state === 'recording' && (
                <div className={styles.recordingState}>
                    <span className={styles.recordingDot} aria-hidden="true" />
                    <span className={styles.timer} data-testid="recording-timer">
                        {formatDuration(elapsedMs)}
                    </span>
                    <button
                        type="button"
                        className={styles.stopButton}
                        onClick={handleStopRecording}
                        aria-label={translate('roomSocial.stopRecording')}
                        title={translate('roomSocial.stopRecording')}
                        onKeyDown={stopKeyPropagation}
                    >
                        <svg
                            width="12"
                            height="12"
                            viewBox="0 0 24 24"
                            fill="currentColor"
                            aria-hidden="true"
                        >
                            <rect x="4" y="4" width="16" height="16" rx="2" />
                        </svg>
                        <span>{translate('roomSocial.stopRecording')}</span>
                    </button>
                    <button
                        type="button"
                        className={styles.cancelButton}
                        onClick={handleCancel}
                        aria-label={translate('roomSocial.cancelRecording')}
                        title={translate('roomSocial.cancelRecording')}
                        onKeyDown={stopKeyPropagation}
                    >
                        <svg
                            width="12"
                            height="12"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                        >
                            <line x1="18" y1="6" x2="6" y2="18" />
                            <line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                        <span>{translate('roomSocial.cancelRecording')}</span>
                    </button>
                </div>
            )}

            {state === 'preview' && draft && (
                <div className={styles.previewState}>
                    <audio
                        controls
                        src={draft.previewUrl}
                        className={styles.audioPlayer}
                        data-testid="voice-preview-audio"
                        aria-label={translate('roomSocial.recordVoice')}
                        onKeyDown={stopKeyPropagation}
                    />
                    <span className={styles.durationBadge} data-testid="draft-duration">
                        {formatDuration(draft.durationMs)}
                    </span>
                    <button
                        type="button"
                        className={styles.discardButton}
                        disabled={isSending}
                        onClick={handleDiscard}
                        aria-label={translate('roomSocial.cancelRecording')}
                        title={translate('roomSocial.cancelRecording')}
                        onKeyDown={stopKeyPropagation}
                    >
                        <svg
                            width="12"
                            height="12"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                        >
                            <line x1="18" y1="6" x2="6" y2="18" />
                            <line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                        <span>{translate('roomSocial.cancelRecording')}</span>
                    </button>
                    <button
                        type="button"
                        className={styles.sendButton}
                        disabled={isSending || disabled}
                        onClick={handleSend}
                        aria-label={translate('roomSocial.sendVoice')}
                        title={translate('roomSocial.sendVoice')}
                        onKeyDown={stopKeyPropagation}
                    >
                        <svg
                            width="12"
                            height="12"
                            viewBox="0 0 24 24"
                            fill="currentColor"
                            aria-hidden="true"
                        >
                            <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
                        </svg>
                        <span>{translate('roomSocial.sendVoice')}</span>
                    </button>
                </div>
            )}

            {error && (
                <p className={styles.errorBanner} role="alert">
                    {error}
                </p>
            )}
        </div>
    );
}
