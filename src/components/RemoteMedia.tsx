import { useState } from 'react';
import { Link } from 'react-router-dom';
import RemoteImage, { type ImageLoadState, type RemoteImageProps } from './RemoteImage';
import { useTranslation } from '../shared/useTranslation';
import styles from './RemoteMedia.module.css';

type Props = RemoteImageProps & { interactiveRetry?: boolean; variant?: 'poster' | 'landscape' | 'avatar' };

export default function RemoteMedia({ src, ...props }: Props) {
    return <Media key={src ?? ''} src={src} {...props} />;
}

function Media({ src, interactiveRetry = false, variant = 'poster', className, onStateChange, ...props }: Props) {
    const { t } = useTranslation();
    const [state, setState] = useState<ImageLoadState>(src ? 'loading' : 'error');
    const [retry, setRetry] = useState(0);
    return <span className={`${styles.media} ${className ?? ''}`} data-media-state={state} data-media-variant={variant}>
        <RemoteImage {...props} src={src} retryKey={retry} onStateChange={next => { setState(next); onStateChange?.(next); }} style={{ ...props.style, opacity: state === 'loaded' ? 1 : 0 }} />
        {state === 'loading' && <span className={styles.skeleton} aria-hidden="true" />}
        {state === 'error' && <span className={styles.failure}>
            <span role="img" aria-label={`${props.alt ?? ''}: ${t('ux.imageFailed')}`}><svg aria-hidden="true" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="3" width="18" height="18" rx="2" /><path d="m3 17 6-6 5 5 3-3 4 4M8 7h1" /></svg></span>
            {variant === 'poster' && <span>{t('ux.imageFailed')}</span>}
            {interactiveRetry && <><button type="button" onClick={() => { setState('loading'); setRetry(value => value + 1); }}>{t('ux.imageRetry')}</button>{variant !== 'landscape' && <Link to="/settings">{t('ux.imageProxyHint')}</Link>}</>}
        </span>}
    </span>;
}
