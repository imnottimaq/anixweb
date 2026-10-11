import { useEffect, useRef } from 'react';
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

    useEffect(() => {
        const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        closeBtnRef.current?.focus();
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                onClose();
            } else if (e.key === 'Tab') {
                const controls = dialogRef.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled])');
                if (!controls?.length) return;
                const first = controls[0], last = controls[controls.length - 1];
                if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
                else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
            }
        };
        window.addEventListener('keydown', handleKeyDown, true);
        return () => {
            window.removeEventListener('keydown', handleKeyDown, true);
            if (previousFocus?.isConnected) previousFocus.focus();
        };
    }, [onClose]);

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
            onKeyDown={e => e.stopPropagation()}
        >
            <div className={styles.imageModalContent} ref={dialogRef}>
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
                            <span aria-hidden="true">↓</span>
                        </a>
                        <button
                            ref={closeBtnRef}
                            type="button"
                            className={styles.imageModalClose}
                            onClick={onClose}
                            aria-label={t('roomSocial.closeViewer')}
                        >
                            ✕
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
