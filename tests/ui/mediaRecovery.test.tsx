import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RemoteImage from '../../src/components/RemoteImage';
import RemoteMedia from '../../src/components/RemoteMedia';
import { defaultAppSettings } from '../../src/shared/types/settings';
import { renderWithProviders } from './helpers/testUtils';

const original = 'https://s.anixmirai.com/posters/test.jpg';
const mirror = 'https://mirror-s.anixmirai.com/posters/test.jpg';
const settings = { ...defaultAppSettings,
    appearance: { ...defaultAppSettings.appearance, language: 'english' as const },
    content: { ...defaultAppSettings.content, proxyImages: false },
};
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('remote media recovery', () => {
    it('tries original and mirror before displaying a stable noninteractive card placeholder', () => {
        const onError = vi.fn();
        const onStateChange = vi.fn();
        renderWithProviders(<RemoteMedia src={original} alt="Poster" className="poster-layout" onError={onError} onStateChange={onStateChange} />, { settings });
        const first = screen.getByAltText('Poster');
        const wrapper = first.parentElement!;
        expect(wrapper).toHaveClass('poster-layout');
        expect(wrapper).toHaveAttribute('data-media-state', 'loading');
        expect(first).toHaveAttribute('src', original);
        fireEvent.error(first);
        const second = screen.getByAltText('Poster');
        expect(second).toHaveAttribute('src', mirror);
        expect(second).not.toBe(first);
        expect(onError).not.toHaveBeenCalled();
        fireEvent.error(second);
        expect(screen.getByAltText('Poster').parentElement).toBe(wrapper);
        expect(wrapper).toHaveAttribute('data-media-state', 'error');
        expect(screen.getByRole('img', { name: 'Poster: Image could not be loaded' })).toBeVisible();
        expect(screen.queryByRole('button', { name: 'Retry image' })).not.toBeInTheDocument();
        expect(onStateChange.mock.calls.map(call => call[0])).toEqual(['loading', 'error']);
        expect(onError).toHaveBeenCalledOnce();
    });

    it('retries the complete candidate list only after explicit retry and preserves the media wrapper', async () => {
        const user = userEvent.setup();
        const onLoad = vi.fn();
        renderWithProviders(<RemoteMedia src={original} alt="Poster" interactiveRetry onLoad={onLoad} />, { settings });
        const wrapper = screen.getByAltText('Poster').parentElement;
        fireEvent.error(screen.getByAltText('Poster'));
        fireEvent.error(screen.getByAltText('Poster'));
        expect(screen.getByRole('link', { name: /check your image proxy settings/ })).toHaveAttribute('href', '/settings');
        await user.click(screen.getByRole('button', { name: 'Retry image' }));
        expect(screen.getByAltText('Poster')).toHaveAttribute('src', original);
        expect(screen.getByAltText('Poster').parentElement).toBe(wrapper);
        expect(wrapper).toHaveAttribute('data-media-state', 'loading');
        fireEvent.error(screen.getByAltText('Poster'));
        expect(screen.getByAltText('Poster')).toHaveAttribute('src', mirror);
        fireEvent.load(screen.getByAltText('Poster'));
        expect(wrapper).toHaveAttribute('data-media-state', 'loaded');
        expect(screen.getByAltText('Poster')).toHaveStyle({ opacity: '1' });
        expect(onLoad).toHaveBeenCalledOnce();
        expect(screen.queryByText('Image could not be loaded')).not.toBeInTheDocument();
    });

    it('keeps proxy mode on the selected proxy and does not try original or mirror after failure', () => {
        const onError = vi.fn();
        renderWithProviders(<RemoteMedia src={original} alt="Poster" interactiveRetry onError={onError} />, {
            settings: { ...settings, content: { ...settings.content, proxyImages: true } },
        });
        const proxy = `https://images.weserv.nl/?url=${encodeURIComponent(original)}`;
        expect(screen.getByAltText('Poster')).toHaveAttribute('src', proxy);
        fireEvent.error(screen.getByAltText('Poster'));
        expect(screen.getByAltText('Poster')).toHaveAttribute('src', proxy);
        expect(screen.getByAltText('Poster').parentElement).toHaveAttribute('data-media-state', 'error');
        expect(onError).toHaveBeenCalledOnce();
    });

    it('resets failed state and ignores stale image events when the source changes', () => {
        const onLoad = vi.fn();
        const onError = vi.fn();
        const onStateChange = vi.fn();
        const { rerender } = renderWithProviders(<RemoteMedia src={original} alt="Poster" onLoad={onLoad} onError={onError} onStateChange={onStateChange} />, { settings });
        fireEvent.error(screen.getByAltText('Poster'));
        const oldImage = screen.getByAltText('Poster');
        fireEvent.error(oldImage);
        const next = 'https://cdn.example.com/new.jpg';
        rerender(<RemoteMedia src={next} alt="Poster" onLoad={onLoad} onError={onError} onStateChange={onStateChange} />);
        const newImage = screen.getByAltText('Poster');
        expect(newImage).toHaveAttribute('src', next);
        expect(newImage.parentElement).toHaveAttribute('data-media-state', 'loading');
        fireEvent.load(oldImage);
        fireEvent.error(oldImage);
        expect(onLoad).not.toHaveBeenCalled();
        expect(onError).toHaveBeenCalledOnce();
        expect(newImage.parentElement).toHaveAttribute('data-media-state', 'loading');
        fireEvent.load(newImage);
        expect(onLoad).toHaveBeenCalledOnce();
        expect(onStateChange.mock.calls.map(call => call[0])).toEqual(['loading', 'error', 'loading', 'loaded']);
    });

    it('bounds each candidate to eight seconds and stops once candidates are exhausted', () => {
        vi.useFakeTimers();
        const onStateChange = vi.fn();
        renderWithProviders(<RemoteMedia src={original} alt="Poster" onStateChange={onStateChange} />, { settings });
        act(() => { vi.advanceTimersByTime(7999); });
        expect(screen.getByAltText('Poster')).toHaveAttribute('src', original);
        act(() => { vi.advanceTimersByTime(1); });
        expect(screen.getByAltText('Poster')).toHaveAttribute('src', mirror);
        act(() => { vi.advanceTimersByTime(7999); });
        expect(screen.getByAltText('Poster').parentElement).toHaveAttribute('data-media-state', 'loading');
        act(() => { vi.advanceTimersByTime(1); });
        expect(screen.getByAltText('Poster').parentElement).toHaveAttribute('data-media-state', 'error');
        act(() => { vi.advanceTimersByTime(60000); });
        expect(onStateChange.mock.calls.map(call => call[0])).toEqual(['loading', 'error']);
    });

    it('defers lazy timeout until intersection and cleans up the observer', () => {
        vi.useFakeTimers();
        let intersect: IntersectionObserverCallback = () => {};
        const observe = vi.fn();
        const disconnect = vi.fn();
        vi.stubGlobal('IntersectionObserver', class {
            constructor(callback: IntersectionObserverCallback) { intersect = callback; }
            observe = observe;
            disconnect = disconnect;
        });
        renderWithProviders(<RemoteMedia src={original} alt="Poster" loading="lazy" />, { settings });
        const image = screen.getByAltText('Poster');
        expect(observe).toHaveBeenCalledWith(image);
        act(() => { vi.advanceTimersByTime(60000); });
        expect(image).toHaveAttribute('src', original);
        expect(image.parentElement).toHaveAttribute('data-media-state', 'loading');
        const rect = image.getBoundingClientRect();
        const entry: IntersectionObserverEntry = { isIntersecting: true, target: image, time: 0, rootBounds: null,
            boundingClientRect: rect, intersectionRect: rect, intersectionRatio: 1 };
        act(() => { intersect([entry], {} as IntersectionObserver); });
        expect(disconnect).toHaveBeenCalled();
        act(() => { vi.advanceTimersByTime(8000); });
        expect(screen.getByAltText('Poster')).toHaveAttribute('src', mirror);
    });

    it('preserves native load callbacks and image props and cancels timeout after a successful load', () => {
        vi.useFakeTimers();
        const onLoad = vi.fn();
        const onStateChange = vi.fn();
        renderWithProviders(<RemoteImage src={original} alt="Poster" width={300} height={450} decoding="async" onLoad={onLoad} onStateChange={onStateChange} />, { settings });
        const image = screen.getByAltText('Poster');
        expect(image).toHaveAttribute('width', '300');
        expect(image).toHaveAttribute('height', '450');
        expect(image).toHaveAttribute('decoding', 'async');
        fireEvent.load(image);
        expect(onLoad).toHaveBeenCalledOnce();
        expect(onLoad.mock.calls[0][0].target).toBe(image);
        act(() => { vi.advanceTimersByTime(60000); });
        expect(image).toHaveAttribute('src', original);
        expect(onStateChange.mock.calls.map(call => call[0])).toEqual(['loading', 'loaded']);
    });
});
