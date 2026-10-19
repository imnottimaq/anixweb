import { useEffect, useEffectEvent, useRef, useState, type ComponentProps } from 'react';
import { useSettings } from '../shared/contexts/settingsContext';

export type ImageLoadState = 'loading' | 'loaded' | 'error';
export type RemoteImageProps = Omit<ComponentProps<'img'>, 'src'> & {
    src?: string | null;
    retryKey?: number;
    onStateChange?: (state: ImageLoadState) => void;
};

export default function RemoteImage({ src, retryKey = 0, ...props }: RemoteImageProps) {
    const { settings } = useSettings();
    if (!src) return null;
    const original = src.startsWith('//') ? `https:${src}` : src;
    const proxy = settings.content.proxyImages;
    const sources = proxy ? [`https://images.weserv.nl/?url=${encodeURIComponent(original)}`]
        : [original, ...(/^https:\/\/s\.anixmirai\.com\//.test(original) ? [original.replace('https://s.anixmirai.com/', 'https://mirror-s.anixmirai.com/')] : [])];
    return <ImageAttempt key={`${original}:${proxy}:${retryKey}`} {...props} sources={sources} />;
}

function ImageAttempt({ sources, onStateChange, onLoad, onError, loading, ...props }: Omit<RemoteImageProps, 'src' | 'retryKey'> & { sources: string[] }) {
    const [index, setIndex] = useState(0);
    const [state, setState] = useState<ImageLoadState>('loading');
    const [started, setStarted] = useState(() => loading !== 'lazy' || typeof IntersectionObserver === 'undefined');
    const ref = useRef<HTMLImageElement>(null);
    const notify = useEffectEvent((next: ImageLoadState) => onStateChange?.(next));
    useEffect(() => { notify(state); }, [state]);
    useEffect(() => {
        if (started || !ref.current) return;
        const observer = new IntersectionObserver(entries => {
            if (entries.some(entry => entry.isIntersecting)) { setStarted(true); observer.disconnect(); }
        }, { rootMargin: '200px' });
        observer.observe(ref.current);
        return () => observer.disconnect();
    }, [started]);
    useEffect(() => {
        if (!started || state !== 'loading') return;
        const timer = window.setTimeout(() => {
            if (index + 1 < sources.length) setIndex(index + 1);
            else setState('error');
        }, 8000);
        return () => window.clearTimeout(timer);
    }, [started, state, index, sources.length]);
    return <img {...props} ref={ref} key={index} src={sources[index]} loading={loading}
        onLoad={event => { if (event.currentTarget !== ref.current || state === 'error') return; setState('loaded'); onLoad?.(event); }}
        onError={event => {
            if (event.currentTarget !== ref.current || state !== 'loading') return;
            if (index + 1 < sources.length) setIndex(index + 1);
            else { setState('error'); onError?.(event); }
        }} />;
}
