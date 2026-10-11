import type { RoomAttachment } from '../shared/roomAttachmentTypes';
import { useAttachmentBlob } from '../shared/hooks/useAttachmentBlob';
import { useTranslation } from '../shared/useTranslation';
import styles from './RoomSocial.module.css';

export interface AudioAttachmentProps {
    roomId: string;
    attachment: RoomAttachment;
}

function formatDuration(ms?: number): string {
    if (!ms || !Number.isFinite(ms)) return '';
    const totalSeconds = Math.round(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export default function AudioAttachment({ roomId, attachment }: AudioAttachmentProps) {
    const { t } = useTranslation();
    const { url, loading, error, retry } = useAttachmentBlob(roomId, attachment.id, { lazy: false });

    return (
        <div className={styles.audioAttachmentContainer} onKeyDown={e => e.stopPropagation()}>
            {loading && (
                <div className={styles.audioLoadingPlaceholder} aria-busy="true">
                    <span className={styles.attachmentSpinner} aria-hidden="true" />
                    <span className={styles.attachmentFilename}>
                        {attachment.name} {attachment.durationMs ? `(${formatDuration(attachment.durationMs)})` : ''}
                    </span>
                </div>
            )}

            {error && (
                <div className={styles.attachmentErrorPlaceholder} role="alert">
                    <span className={styles.attachmentErrorText}>{t('roomSocial.attachmentLoadError')}</span>
                    <button
                        type="button"
                        className={styles.attachmentRetryButton}
                        onClick={retry}
                        aria-label={t('roomSocial.retryLoad')}
                    >
                        {t('roomSocial.retryLoad')}
                    </button>
                </div>
            )}

            {url && !loading && (
                <div className={styles.audioPlayerWrapper}>
                    <audio
                        controls
                        src={url}
                        preload="metadata"
                        className={styles.audioElement}
                        onKeyDown={e => e.stopPropagation()}
                    />
                    {attachment.durationMs ? (
                        <span className={styles.audioDurationText}>
                            {formatDuration(attachment.durationMs)}
                        </span>
                    ) : null}
                </div>
            )}
        </div>
    );
}
