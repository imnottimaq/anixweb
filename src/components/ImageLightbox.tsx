import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useDialogFocus } from '../shared/useDialogFocus';
import { useTranslation } from '../shared/useTranslation';
import RemoteImage from './RemoteImage';
import styles from './ImageLightbox.module.css';

export interface LightboxImage { src: string; alt: string }

export default function ImageLightbox({ images, initialIndex = 0, onClose }: {
    images: LightboxImage[]; initialIndex?: number; onClose: () => void;
}) {
    const { t } = useTranslation();
    const dialog = useRef<HTMLDivElement>(null);
    const [index, setIndex] = useState(initialIndex);
    const [failedSource, setFailedSource] = useState<string | null>(null);
    const [attempt, setAttempt] = useState(0);
    useDialogFocus(dialog, true, onClose, true);
    const currentIndex = ((index % images.length) + images.length) % images.length;
    const image = images[currentIndex];
    if (!image) return null;
    const move = (offset: number) => setIndex(currentIndex + offset);

    return createPortal(<div ref={dialog} className={styles.backdrop} role="dialog" aria-modal="true" aria-label={image.alt} tabIndex={-1}
        onClick={event => { if (event.target === event.currentTarget) onClose(); }}
        onKeyDown={event => {
            if (images.length > 1 && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
                event.preventDefault(); event.stopPropagation(); move(event.key === 'ArrowLeft' ? -1 : 1);
            }
        }}>
        <header className={styles.toolbar}>
            <span className={styles.caption}>{image.alt}</span>
            {images.length > 1 && <span className={styles.counter} aria-live="polite">{currentIndex + 1} / {images.length}</span>}
            <button type="button" className={styles.control} onClick={onClose} aria-label={t('misc.close')}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
            </button>
        </header>
        {failedSource === image.src ? <div className={styles.error} role="alert"><p>{t('feed.mediaError')}</p><button className={styles.retry} type="button" onClick={() => { setFailedSource(null); setAttempt(value => value + 1); }}>{t('page.retry')}</button></div>
            : <RemoteImage key={`${image.src}:${attempt}`} src={image.src} alt={image.alt} className={styles.image} onStateChange={state => { if (state === 'error') setFailedSource(image.src); }} onError={() => setFailedSource(image.src)} onClick={event => {
                // object-fit leaves dark space inside the img box; treat it as backdrop.
                const element = event.currentTarget;
                if (!element.naturalWidth || !element.naturalHeight) return;
                const bounds = element.getBoundingClientRect();
                const scale = Math.min(bounds.width / element.naturalWidth, bounds.height / element.naturalHeight);
                const insetX = (bounds.width - element.naturalWidth * scale) / 2;
                const insetY = (bounds.height - element.naturalHeight * scale) / 2;
                if (event.clientX < bounds.left + insetX || event.clientX > bounds.right - insetX || event.clientY < bounds.top + insetY || event.clientY > bounds.bottom - insetY) onClose();
            }} />}
        {images.length > 1 && <>
            <button type="button" className={`${styles.control} ${styles.previous}`} onClick={() => move(-1)} aria-label={t('imageViewer.previous')}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 5-7 7 7 7" /></svg></button>
            <button type="button" className={`${styles.control} ${styles.next}`} onClick={() => move(1)} aria-label={t('imageViewer.next')}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg></button>
        </>}
    </div>, document.body);
}
