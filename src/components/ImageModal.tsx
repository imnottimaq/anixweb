import { useRef } from 'react';
import { useDialogFocus } from '../shared/useDialogFocus';
import type { RoomAttachment } from '../shared/roomAttachmentTypes';
import { useTranslation } from '../shared/useTranslation';
import styles from './RoomSocial.module.css';

export interface ImageModalProps {
    attachment: RoomAttachment;
    src: string;
    onClose: () => void;
}

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function ImageModal({ attachment, src, onClose }: ImageModalProps) {
    const { t } = useTranslation();
    const closeBtnRef = useRef<HTMLButtonElement>(null);
    const dialogRef = useRef<HTMLDivElement>(null);

    useDialogFocus(dialogRef, true, onClose, true);

    return (
        <div
            className={styles.imageModalBackdrop}
            role="dialog"
            aria-modal="true"
            aria-label={attachment.name}
            onClick={e => {
                if (e.target === e.currentTarget) {
                    onClose();
                }
            }}
            onKeyDown={e => { if (e.key !== 'Escape' && e.key !== 'Tab') e.stopPropagation(); }}
        >
            <div className={styles.imageModalContent} ref={dialogRef} tabIndex={-1}>
                <header className={styles.imageModalHeader}>
                    <div className={styles.imageModalMeta}>
                        <span className={styles.imageModalTitle}>{attachment.name}</span>
                        <span className={styles.imageModalSize}>{formatBytes(attachment.size)}</span>
                    </div>
                    <div className={styles.imageModalActions}>
                        <a
                            href={src}
                            download={attachment.name}
                            className={styles.imageModalDownload}
                            title={t('roomSocial.downloadImage')}
                            aria-label={t('roomSocial.downloadImage')}
                            onClick={e => e.stopPropagation()}
                        >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
                            </svg>
                        </a>
                        <button
                            ref={closeBtnRef}
                            type="button"
                            className={styles.imageModalClose}
                            onClick={onClose}
                            aria-label={t('roomSocial.closeViewer')}
                        >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <path d="M18 6L6 18M6 6l12 12" />
                            </svg>
                        </button>
                    </div>
                </header>
                <div className={styles.imageModalBody}>
                    <img
                        src={src}
                        alt={attachment.name}
                        className={styles.imageModalImg}
                    />
                </div>
            </div>
        </div>
    );
}
