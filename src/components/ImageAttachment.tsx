import { useEffect, useRef, useState } from 'react';
import type { RoomAttachment } from '../shared/roomAttachmentTypes';
import { useAttachmentBlob } from '../shared/hooks/useAttachmentBlob';
import { useTranslation } from '../shared/useTranslation';
import ImageModal from './ImageModal';
import styles from './RoomSocial.module.css';

export interface ImageAttachmentProps {
    roomId: string;
    attachment: RoomAttachment;
}

export default function ImageAttachment({ roomId, attachment }: ImageAttachmentProps) {
    const { t } = useTranslation();
    const containerRef = useRef<HTMLDivElement>(null);
    const [modalOpen, setModalOpen] = useState(false);
    const { url, loading, error, trigger, retry } = useAttachmentBlob(roomId, attachment.id, { lazy: true });

    useEffect(() => {
        const el = containerRef.current;
        if (!el || typeof IntersectionObserver === 'undefined') {
            trigger();
            return;
        }

        let didIntersect = false;
        const observer = new IntersectionObserver(
            entries => {
                for (const entry of entries) {
                    if (entry.isIntersecting) {
                        didIntersect = true;
                        trigger();
                        observer.disconnect();
                        break;
                    }
                }
            },
            { rootMargin: '100px' }
        );

        observer.observe(el);

        // Fallback timer for environments (tests/headless) where mock IntersectionObserver doesn't simulate intersections
        const fallbackTimer = setTimeout(() => {
            if (!didIntersect) {
                trigger();
            }
        }, 50);

        return () => {
            clearTimeout(fallbackTimer);
            observer.disconnect();
        };
    }, [trigger]);

    const handleKeyDown = (e: React.KeyboardEvent) => {
        e.stopPropagation();
        if ((e.key === 'Enter' || e.key === ' ') && url) {
            e.preventDefault();
            setModalOpen(true);
        }
    };

    return (
        <div className={styles.attachmentWrapper} ref={containerRef} onKeyDown={e => e.stopPropagation()}>
            {loading && (
                <div className={styles.attachmentLoadingPlaceholder} aria-busy="true">
                    <span className={styles.attachmentSpinner} aria-hidden="true" />
                    <span className={styles.attachmentFilename}>{attachment.name}</span>
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
                <>
                    <button
                        type="button"
                        className={styles.imageAttachmentButton}
                        onClick={() => setModalOpen(true)}
                        onKeyDown={handleKeyDown}
                        aria-label={`${attachment.name} (${t('roomUX.viewer')})`}
                    >
                        <img
                            src={url}
                            alt={attachment.name}
                            className={styles.imageAttachmentThumbnail}
                            loading="lazy"
                        />
                    </button>
                    {modalOpen && (
                        <ImageModal
                            attachment={attachment}
                            src={url}
                            onClose={() => setModalOpen(false)}
                        />
                    )}
                </>
            )}
        </div>
    );
}
