import { type FormEvent, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useRoomPresence } from '../shared/contexts/roomContext';
import { useUser } from '../shared/contexts/userContext';
import { useTranslation } from '../shared/useTranslation';
import { uploadRoomAttachment, MAX_ATTACHMENT_BYTES } from '../shared/watchRoom';
import RemoteImage from './RemoteImage';
import ImageAttachment from './ImageAttachment';
import AudioAttachment from './AudioAttachment';
import VoiceRecorder, { type VoiceRecordingData } from './VoiceRecorder';
import styles from './RoomSocial.module.css';

export interface RoomChatProps {
    compact?: boolean;
    fill?: boolean;
}

function formatChatTime(timestamp: number): string {
    const date = new Date(timestamp);
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
}

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const isPlaceholder = (txt: string) =>
    txt === '\u{1F4F7} \u0424\u043E\u0442\u043E' ||
    txt === '\u{1F4F7} Image' ||
    txt === '\u{1F3A4} \u0413\u043E\u043B\u043E\u0441\u043E\u0432\u043E\u0435 \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u0435' ||
    txt === '\u{1F3A4} Voice message';

export default function RoomChat(props: RoomChatProps) {
    const {room} = useRoomPresence();
    const {userToken} = useUser();
    return <RoomChatSession key={`${room?.roomId ?? 'none'}:${userToken}`} {...props} />;
}

function RoomChatSession({ compact = false, fill = false }: RoomChatProps) {
    const counterId = useId();
    const { room, status, sendChat } = useRoomPresence();
    const { t } = useTranslation();
    const currentRoomId = useRef(room?.roomId);
    useEffect(() => { currentRoomId.current = room?.roomId; }, [room?.roomId]);
    useEffect(() => () => { currentRoomId.current = undefined; }, []);

    const messages = useMemo(() => room?.chat ?? [], [room?.chat]);
    const messagesContainerRef = useRef<HTMLDivElement>(null);
    const wasNearBottomRef = useRef(true);
    const prevTailIdRef = useRef<string | null>(null);
    const prevCountRef = useRef(0);

    const [draft, setDraft] = useState('');
    const [imageDraft, setImageDraft] = useState<{
        file: File;
        previewUrl: string;
        uploadId: string;
    } | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const voiceUploadIdRef = useRef<{blob: Blob; text: string; uploadId: string} | null>(null);
    const imageUploadRef = useRef<{file: File; text: string; uploadId: string} | null>(null);
    const uploadAbortRef = useRef<AbortController | null>(null);
    useEffect(() => () => { uploadAbortRef.current?.abort(); }, []);

    const [isSending, setIsSending] = useState(false);
    const [validationError, setValidationError] = useState('');
    const [sendError, setSendError] = useState('');
    const [showNewMessagesBadge, setShowNewMessagesBadge] = useState(false);

    const isConnected = status === 'connected';

    // Cleanup image draft preview URL when replaced or on unmount
    useEffect(() => {
        return () => {
            if (imageDraft?.previewUrl) {
                try {
                    URL.revokeObjectURL(imageDraft.previewUrl);
                } catch {
                    // Ignore
                }
            }
        };
    }, [imageDraft]);

    const checkIsNearBottom = () => {
        const el = messagesContainerRef.current;
        if (!el) return true;
        const scrollDistance = el.scrollHeight - el.scrollTop - el.clientHeight;
        return scrollDistance <= 60;
    };

    const handleScroll = () => {
        const isNear = checkIsNearBottom();
        wasNearBottomRef.current = isNear;
        if (isNear) {
            setShowNewMessagesBadge(false);
        }
    };

    const scrollToBottom = (smooth = true) => {
        const el = messagesContainerRef.current;
        if (!el) return;
        el.scrollTop = el.scrollHeight;
        if (smooth) {
            try {
                el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
            } catch {
                // Ignore environments where smooth scrollTo is unsupported
            }
        }
        setShowNewMessagesBadge(false);
        wasNearBottomRef.current = true;
    };

    useEffect(() => {
        const el = messagesContainerRef.current;
        if (!el) return;

        const prevTailId = prevTailIdRef.current;
        const currentTailId = messages.length > 0 ? messages[messages.length - 1].id : null;
        const prevCount = prevCountRef.current;
        const currentCount = messages.length;

        prevTailIdRef.current = currentTailId;
        prevCountRef.current = currentCount;

        if (prevCount === 0 && currentCount > 0) {
            el.scrollTop = el.scrollHeight;
            wasNearBottomRef.current = true;
            return;
        }

        const hasNewMessage = Boolean(currentTailId && currentTailId !== prevTailId);
        if (hasNewMessage) {
            if (wasNearBottomRef.current) {
                el.scrollTop = el.scrollHeight;
                setShowNewMessagesBadge(false);
            } else {
                setShowNewMessagesBadge(true);
            }
        }
    }, [messages]);

    const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        event.target.value = '';

        const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif'];
        if (!allowedTypes.includes(file.type)) {
            setValidationError(t('roomSocial.attachmentInvalidType'));
            return;
        }
        if (file.size <= 0 || file.size > MAX_ATTACHMENT_BYTES) {
            setValidationError(t('roomSocial.attachmentTooLarge'));
            return;
        }

        if (imageDraft?.previewUrl) {
            try {
                URL.revokeObjectURL(imageDraft.previewUrl);
            } catch {
                // Ignore
            }
        }

        const previewUrl = URL.createObjectURL(file);
        setImageDraft({
            file,
            previewUrl,
            uploadId: crypto.randomUUID(),
        });
        setValidationError('');
        setSendError('');
    };

    const handleRemoveDraft = () => {
        if (imageDraft?.previewUrl) {
            try {
                URL.revokeObjectURL(imageDraft.previewUrl);
            } catch {
                // Ignore
            }
        }
        setImageDraft(null);
    };

    const handleSend = async () => {
        const trimmed = draft.trim();
        if (!imageDraft && !trimmed) {
            setValidationError(t('roomSocial.emptyMessageError'));
            return;
        }
        if (!isConnected || isSending) {
            return;
        }

        setIsSending(true);
        setValidationError('');
        setSendError('');
        const sendRoomId = room?.roomId;
        const uploadAbort = new AbortController();
        uploadAbortRef.current = uploadAbort;

        try {
            if (imageDraft && sendRoomId) {
                const previous = imageUploadRef.current;
                const uploadId = previous?.file === imageDraft.file && previous.text === trimmed
                    ? previous.uploadId : previous?.file === imageDraft.file ? crypto.randomUUID() : imageDraft.uploadId;
                imageUploadRef.current = {file: imageDraft.file, text: trimmed, uploadId};
                await uploadRoomAttachment(
                    sendRoomId,
                    imageDraft.file,
                    {
                        kind: 'image',
                        name: imageDraft.file.name,
                        text: trimmed || undefined,
                        uploadId,
                    },
                    uploadAbort.signal
                );
                if (!uploadAbort.signal.aborted && currentRoomId.current === sendRoomId) {
                    setImageDraft(null);
                    imageUploadRef.current = null;
                }
            } else {
                await sendChat(trimmed);
            }
            if (currentRoomId.current === sendRoomId) {
                setDraft('');
                wasNearBottomRef.current = true;
                scrollToBottom(true);
            }
        } catch {
            // Preserve draft on send failure or pending error
            if (currentRoomId.current === sendRoomId) {
                setSendError(t('roomSocial.sendError'));
            }
        } finally {
            if (currentRoomId.current === sendRoomId) {
                setIsSending(false);
            }
        }
    };

    const handleVoiceSend = async ({ blob, durationMs, name }: VoiceRecordingData) => {
        if (!isConnected || isSending || !room?.roomId) {
            throw new Error('ROOM_NOT_CONNECTED');
        }
        setIsSending(true);
        setSendError('');
        const sendRoomId = room.roomId;
        const caption = draft.trim();
        const previous = voiceUploadIdRef.current;
        const uploadId = previous?.blob === blob && previous.text === caption ? previous.uploadId : crypto.randomUUID();
        voiceUploadIdRef.current = {blob, text: caption, uploadId};
        const uploadAbort = new AbortController();
        uploadAbortRef.current = uploadAbort;

        try {
            await uploadRoomAttachment(
                sendRoomId,
                blob,
                {
                    kind: 'voice',
                    name,
                    durationMs,
                    text: caption || undefined,
                    uploadId,
                },
                uploadAbort.signal
            );
            voiceUploadIdRef.current = null;
            if (currentRoomId.current === sendRoomId) {
                setDraft('');
                wasNearBottomRef.current = true;
                scrollToBottom(true);
            }
        } catch (err) {
            if (currentRoomId.current === sendRoomId) {
                setSendError(t('roomSocial.sendError'));
            }
            throw err;
        } finally {
            if (currentRoomId.current === sendRoomId) {
                setIsSending(false);
            }
        }
    };

    const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
        event.stopPropagation();
        if (event.key === 'Enter') {
            const isComposing =
                event.nativeEvent.isComposing ||
                (event as unknown as { isComposing?: boolean }).isComposing ||
                event.keyCode === 229;

            if (isComposing) {
                return;
            }

            if (!event.shiftKey) {
                event.preventDefault();
                void handleSend();
            }
        }
    };

    const handleSubmit = (event: FormEvent) => {
        event.preventDefault();
        void handleSend();
    };

    return (
        <div className={`${styles.chatContainer} ${compact ? styles.compact : ''} ${fill ? styles.fill : ''}`} aria-label={t('roomSocial.chat')} onKeyDown={e => e.stopPropagation()}>
            <div className={styles.messagesWrapper}>
                <div
                    ref={messagesContainerRef}
                    className={styles.messagesList}
                    onScroll={handleScroll}
                    role="log"
                    aria-live="polite"
                    aria-relevant="additions"
                    tabIndex={0}
                >
                    {messages.length === 0 ? (
                        <div className={styles.emptyMessages}>
                            <p>{t('roomSocial.noMessages')}</p>
                        </div>
                    ) : (
                        messages.map(msg => (
                            <div key={msg.id} className={styles.messageRow}>
                                <span className={styles.messageAvatar}>
                                    {msg.avatar ? (
                                        <RemoteImage src={msg.avatar} alt="" />
                                    ) : (
                                        msg.login[0]?.toUpperCase() ?? '?'
                                    )}
                                </span>
                                <div className={styles.messageBody}>
                                    <div className={styles.messageHeader}>
                                        <strong className={styles.messageAuthor}>{msg.login}</strong>
                                        <time
                                            className={styles.messageTime}
                                            dateTime={new Date(msg.createdAt).toISOString()}
                                        >
                                            {formatChatTime(msg.createdAt)}
                                        </time>
                                    </div>
                                    {msg.attachment?.kind === 'image' && room?.roomId && (
                                        <ImageAttachment roomId={room.roomId} attachment={msg.attachment} />
                                    )}
                                    {msg.attachment?.kind === 'voice' && room?.roomId && (
                                        <AudioAttachment roomId={room.roomId} attachment={msg.attachment} />
                                    )}
                                    {(!msg.attachment || (!isPlaceholder(msg.text) && msg.text.trim())) && (
                                        <p className={styles.messageText}>{msg.text}</p>
                                    )}
                                </div>
                            </div>
                        ))
                    )}
                </div>

                {showNewMessagesBadge && (
                    <button
                        type="button"
                        className={styles.newMessagesBadge}
                        onClick={() => scrollToBottom(true)}
                        aria-label={t('roomSocial.newMessages')}
                    >
                        <span>{t('roomSocial.newMessages')}</span>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M12 5v14M19 12l-7 7-7-7" />
                        </svg>
                    </button>
                )}
            </div>

            <form className={styles.chatForm} onSubmit={handleSubmit} noValidate onKeyDown={e => e.stopPropagation()}>
                <div className={styles.composer}>
                {imageDraft && (
                    <div className={styles.chatDraftPreview}>
                        <img src={imageDraft.previewUrl} alt="" className={styles.draftThumbnail} />
                        <div className={styles.draftMeta}>
                            <span className={styles.draftName}>{imageDraft.file.name}</span>
                            <span className={styles.draftSize}>{formatBytes(imageDraft.file.size)}</span>
                        </div>
                        <button
                            type="button"
                            className={styles.draftRemoveBtn}
                            onClick={handleRemoveDraft}
                            aria-label={t('roomSocial.removeAttachment')}
                            title={t('roomSocial.removeAttachment')}
                        >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <path d="M18 6L6 18M6 6l12 12" />
                            </svg>
                        </button>
                    </div>
                )}

                <div className={styles.textInput}>
                <span
                    className={styles.charCounter}
                    data-testid="chat-char-counter"
                    id={counterId}
                    aria-label={t('roomSocial.charsRemaining', { count: 500 - draft.length })}
                >
                    {draft.length}/500
                </span>
                <textarea
                    className={styles.chatTextarea}
                    placeholder={t('roomSocial.chatPlaceholder')}
                    aria-label={t('roomSocial.chat')}
                    aria-describedby={counterId}
                    value={draft}
                    maxLength={500}
                    disabled={!isConnected || isSending}
                    rows={compact ? 2 : 3}
                    onChange={event => {
                        setDraft(event.target.value);
                        setValidationError('');
                        setSendError('');
                    }}
                    onKeyDown={handleKeyDown}
                />
                </div>

                <div className={styles.inputFooter} data-chat-actions>
                    <div className={styles.chatActionsGroup}>
                        <input
                            type="file"
                            ref={fileInputRef}
                            accept="image/jpeg,image/png,image/gif,image/webp,image/avif"
                            style={{ display: 'none' }}
                            onChange={handleFileSelect}
                            tabIndex={-1}
                        />
                        <button
                            type="button"
                            className={styles.chatActionButton}
                            title={t('roomSocial.attachImage')}
                            aria-label={t('roomSocial.attachImage')}
                            disabled={!isConnected || isSending}
                            onClick={() => fileInputRef.current?.click()}
                        >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                                <circle cx="12" cy="13" r="4" />
                            </svg>
                        </button>
                        <VoiceRecorder
                            disabled={!isConnected || isSending}
                            compact={compact}
                            onSend={handleVoiceSend}
                            onCancel={() => { voiceUploadIdRef.current = null; }}
                        />
                    </div>

                    <button
                        type="submit"
                        className={styles.sendButton}
                        disabled={!isConnected || isSending}
                    >
                        {t('roomSocial.send')}
                    </button>
                </div>
                </div>

                {validationError && (
                    <p className={styles.chatError} role="alert">
                        {validationError}
                    </p>
                )}
                {sendError && (
                    <p className={styles.chatError} role="alert">
                        {sendError}
                    </p>
                )}
            </form>
        </div>
    );
}
