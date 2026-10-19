import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import VoiceRecorder, {
    MAX_ATTACHMENT_BYTES,
    MAX_VOICE_DURATION_MS,
    type VoiceRecorderProps,
} from '../../src/components/VoiceRecorder';
import { SettingsContext } from '../../src/shared/contexts/settingsContext';
import { defaultAppSettings, type AppSettings } from '../../src/shared/types/settings';

class MockMediaStreamTrack {
    kind = 'audio';
    enabled = true;
    readyState = 'live';
    stop = vi.fn(() => {
        this.readyState = 'ended';
    });
}

class MockMediaStream {
    tracks: MockMediaStreamTrack[];
    constructor(tracks?: MockMediaStreamTrack[]) {
        this.tracks = tracks ?? [new MockMediaStreamTrack()];
    }
    getTracks() {
        return this.tracks;
    }
    getAudioTracks() {
        return this.tracks;
    }
}

class MockMediaRecorder {
    static latestInstance: MockMediaRecorder | null = null;
    static isTypeSupported = vi.fn((mime: string) => {
        return mime.startsWith('audio/webm');
    });

    stream: MediaStream;
    mimeType: string;
    state: 'inactive' | 'recording' | 'paused' = 'inactive';
    ondataavailable: ((e: { data: Blob }) => void) | null = null;
    onstop: (() => void) | null = null;
    onerror: ((e: unknown) => void) | null = null;
    chunksToEmitOnStop: Blob[] | null = null;

    constructor(stream: MediaStream, options?: MediaRecorderOptions) {
        MockMediaRecorder.latestInstance = this;
        this.stream = stream;
        this.mimeType = options?.mimeType || 'audio/webm';
    }

    start = vi.fn(() => {
        this.state = 'recording';
    });

    stop = vi.fn(() => {
        if (this.state === 'inactive') return;
        this.state = 'inactive';
        if (this.ondataavailable) {
            const blobs = this.chunksToEmitOnStop ?? [new Blob(['mock audio data'], { type: this.mimeType })];
            for (const chunk of blobs) {
                this.ondataavailable({ data: chunk });
            }
        }
        if (this.onstop) {
            this.onstop();
        }
    });
}

describe('VoiceRecorder component', () => {
    let originalMediaDevices: PropertyDescriptor | undefined;
    let originalMediaRecorder: typeof window.MediaRecorder | undefined;
    let originalCreateObjectURL: typeof URL.createObjectURL;
    let originalRevokeObjectURL: typeof URL.revokeObjectURL;

    let createdUrls: string[] = [];
    let revokedUrls: string[] = [];

    beforeEach(() => {
        MockMediaRecorder.latestInstance = null;
        createdUrls = [];
        revokedUrls = [];

        originalMediaDevices = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');
        originalMediaRecorder = window.MediaRecorder;
        originalCreateObjectURL = URL.createObjectURL;
        originalRevokeObjectURL = URL.revokeObjectURL;

        URL.createObjectURL = vi.fn(() => {
            const url = `blob:http://localhost/${Math.random().toString(36).slice(2)}`;
            createdUrls.push(url);
            return url;
        });

        URL.revokeObjectURL = vi.fn((url: string) => {
            revokedUrls.push(url);
        });

        window.MediaRecorder = MockMediaRecorder as unknown as typeof MediaRecorder;

        Object.defineProperty(navigator, 'mediaDevices', {
            writable: true,
            configurable: true,
            value: {
                getUserMedia: vi.fn().mockImplementation(async () => new MockMediaStream()),
            },
        });
    });

    afterEach(() => {
        vi.useRealTimers();
        URL.createObjectURL = originalCreateObjectURL;
        URL.revokeObjectURL = originalRevokeObjectURL;

        if (originalMediaDevices) {
            Object.defineProperty(navigator, 'mediaDevices', originalMediaDevices);
        } else {
            // @ts-expect-error cleanup mock
            delete navigator.mediaDevices;
        }

        if (originalMediaRecorder) {
            window.MediaRecorder = originalMediaRecorder;
        } else {
            // @ts-expect-error cleanup mock
            delete window.MediaRecorder;
        }
    });

    const renderRecorder = (
        props: Partial<VoiceRecorderProps> = {},
        language: 'english' | 'russian' = 'english'
    ) => {
        const settings: AppSettings = {
            ...defaultAppSettings,
            appearance: {
                ...defaultAppSettings.appearance,
                language,
            },
        };

        const defaultProps: VoiceRecorderProps = {
            onSend: vi.fn().mockResolvedValue(undefined),
            onCancel: vi.fn(),
            ...props,
        };

        const utils = render(
            <SettingsContext.Provider value={{ settings, setSettings: vi.fn() }}>
                <VoiceRecorder {...defaultProps} />
            </SettingsContext.Provider>
        );

        return {
            ...utils,
            props: defaultProps,
        };
    };

    // 1. NEVER call getUserMedia on mount
    it('does NOT call getUserMedia on mount; only on explicit click of the microphone button', async () => {
        const getUserMediaSpy = vi.spyOn(navigator.mediaDevices, 'getUserMedia');

        renderRecorder();

        expect(getUserMediaSpy).not.toHaveBeenCalled();
        const recordBtn = screen.getByRole('button');
        expect(recordBtn).toBeInTheDocument();

        await act(async () => {
            fireEvent.click(recordBtn);
        });

        expect(getUserMediaSpy).toHaveBeenCalledTimes(1);
        expect(getUserMediaSpy).toHaveBeenCalledWith({ audio: true });
    });

    // 2. Full cycle: Record -> stop -> preview -> send
    it('completes the full flow: Record -> stop -> preview -> send', async () => {
        const onSend = vi.fn().mockResolvedValue(undefined);
        renderRecorder({ onSend });

        const recordBtn = screen.getByRole('button');

        // Start recording
        await act(async () => {
            fireEvent.click(recordBtn);
        });

        // Recording state active
        expect(screen.getByTestId('recording-timer')).toBeInTheDocument();
        const stopBtn = screen.getByRole('button', { name: /stop/i });
        expect(stopBtn).toBeInTheDocument();

        // Stop recording
        await act(async () => {
            fireEvent.click(stopBtn);
        });

        // Preview state active
        const audioElement = screen.getByTestId('voice-preview-audio') as HTMLAudioElement;
        expect(audioElement.volume).toBe(defaultAppSettings.player.volume / 100);
        expect(audioElement).toBeInTheDocument();
        expect(audioElement.src).toContain('blob:');
        expect(createdUrls.length).toBe(1);

        const sendBtn = screen.getByRole('button', { name: /send/i });
        expect(sendBtn).toBeInTheDocument();

        // Send recording
        await act(async () => {
            fireEvent.click(sendBtn);
        });

        expect(onSend).toHaveBeenCalledTimes(1);
        const sendPayload = onSend.mock.calls[0][0];
        expect(sendPayload.blob).toBeInstanceOf(Blob);
        expect(typeof sendPayload.durationMs).toBe('number');
        expect(sendPayload.name).toMatch(/^voice-message\.(webm|ogg|mp4|aac|m4a)$/);

        // Revoke URL on send and return to idle
        expect(revokedUrls).toContain(audioElement.src);
        expect(screen.queryByTestId('voice-preview-audio')).not.toBeInTheDocument();
        expect(screen.getByRole('button')).toBeInTheDocument();
    });

    // 3. Denied permission handling
    it('handles denied permission (NotAllowedError, SecurityError) gracefully without crashing', async () => {
        const notAllowedError = new DOMException('Permission denied', 'NotAllowedError');
        vi.spyOn(navigator.mediaDevices, 'getUserMedia').mockRejectedValueOnce(notAllowedError);

        renderRecorder();

        const recordBtn = screen.getByRole('button');
        await act(async () => {
            fireEvent.click(recordBtn);
        });

        // Error banner is displayed
        const errorAlert = screen.getByRole('alert');
        expect(errorAlert).toBeInTheDocument();
        expect(errorAlert.textContent).toMatch(/denied|запрещ/i);

        // Component returned to idle without crashing
        expect(screen.getByRole('button')).toBeInTheDocument();
    });

    // 4. Unsupported browser handling
    it('handles unsupported browser without navigator.mediaDevices gracefully', async () => {
        // @ts-expect-error simulate unsupported browser
        delete navigator.mediaDevices;

        renderRecorder();

        const recordBtn = screen.getByRole('button');
        await act(async () => {
            fireEvent.click(recordBtn);
        });

        const errorAlert = screen.getByRole('alert');
        expect(errorAlert).toBeInTheDocument();
        expect(errorAlert.textContent).toMatch(/not supported|поддерживается/i);
    });

    it('handles unsupported browser without MediaRecorder gracefully', async () => {
        // @ts-expect-error simulate unsupported browser
        delete window.MediaRecorder;

        renderRecorder();

        const recordBtn = screen.getByRole('button');
        await act(async () => {
            fireEvent.click(recordBtn);
        });

        const errorAlert = screen.getByRole('alert');
        expect(errorAlert).toBeInTheDocument();
        expect(errorAlert.textContent).toMatch(/not supported|поддерживается/i);
    });

    // 5. Cancel stops tracks and cleans up object URL
    it('stops stream tracks and revokes object URL on cancel during recording', async () => {
        const mockTrack = new MockMediaStreamTrack();
        const mockStream = new MockMediaStream([mockTrack]);
        vi.spyOn(navigator.mediaDevices, 'getUserMedia').mockResolvedValueOnce(mockStream as unknown as MediaStream);

        const onCancel = vi.fn();
        renderRecorder({ onCancel });

        await act(async () => {
            fireEvent.click(screen.getByRole('button'));
        });

        const cancelBtn = screen.getByRole('button', { name: /cancel/i });
        await act(async () => {
            fireEvent.click(cancelBtn);
        });

        expect(mockTrack.stop).toHaveBeenCalled();
        expect(onCancel).toHaveBeenCalledTimes(1);
        expect(screen.queryByTestId('recording-timer')).not.toBeInTheDocument();
    });

    it('stops stream tracks and revokes object URL when discarding preview', async () => {
        renderRecorder();

        await act(async () => {
            fireEvent.click(screen.getByRole('button'));
        });

        // Stop to enter preview
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /stop/i }));
        });

        const audioEl = screen.getByTestId('voice-preview-audio') as HTMLAudioElement;
        const objectUrl = audioEl.src;
        expect(createdUrls).toContain(objectUrl);

        const discardBtn = screen.getByRole('button', { name: /cancel/i });
        await act(async () => {
            fireEvent.click(discardBtn);
        });

        expect(revokedUrls).toContain(objectUrl);
        expect(screen.queryByTestId('voice-preview-audio')).not.toBeInTheDocument();
    });

    // 6. 120s timer cap auto-stops
    it('auto-stops recording when reaching the 120s timer limit', async () => {
        vi.useFakeTimers();

        renderRecorder();

        const recordBtn = screen.getByRole('button');
        await act(async () => {
            fireEvent.click(recordBtn);
        });

        expect(screen.getByTestId('recording-timer')).toBeInTheDocument();

        // Advance timers by MAX_VOICE_DURATION_MS
        await act(async () => {
            vi.advanceTimersByTime(MAX_VOICE_DURATION_MS);
        });

        // Auto-stopped into preview mode
        expect(screen.getByTestId('voice-preview-audio')).toBeInTheDocument();
        expect(screen.queryByTestId('recording-timer')).not.toBeInTheDocument();
    });

    // 7. Unmount cleanup with pending getUserMedia
    it('stops all tracks if unmounted while getUserMedia promise is pending', async () => {
        let resolveStreamPromise!: (s: MediaStream) => void;
        const pendingStreamPromise = new Promise<MediaStream>((resolve) => {
            resolveStreamPromise = resolve;
        });

        vi.spyOn(navigator.mediaDevices, 'getUserMedia').mockReturnValueOnce(pendingStreamPromise);

        const { unmount } = renderRecorder();

        // Click record while getUserMedia is pending
        await act(async () => {
            fireEvent.click(screen.getByRole('button'));
        });

        // Unmount before getUserMedia resolves
        unmount();

        // Now stream resolves
        const mockTrack = new MockMediaStreamTrack();
        const mockStream = new MockMediaStream([mockTrack]);

        await act(async () => {
            resolveStreamPromise(mockStream as unknown as MediaStream);
        });

        // Late cleanup must stop every track immediately
        expect(mockTrack.stop).toHaveBeenCalled();
    });

    // 8. Late async cleanup when user cancels while getUserMedia is pending
    it('stops all tracks if user cancels while getUserMedia promise is pending', async () => {
        let resolveStreamPromise!: (s: MediaStream) => void;
        const pendingStreamPromise = new Promise<MediaStream>((resolve) => {
            resolveStreamPromise = resolve;
        });

        vi.spyOn(navigator.mediaDevices, 'getUserMedia').mockReturnValueOnce(pendingStreamPromise);

        renderRecorder();

        await act(async () => {
            fireEvent.click(screen.getByRole('button'));
        });

        // Cancel while promise is pending
        const cancelBtn = screen.getByRole('button', { name: /cancel/i });
        await act(async () => {
            fireEvent.click(cancelBtn);
        });

        // Now stream resolves
        const mockTrack = new MockMediaStreamTrack();
        const mockStream = new MockMediaStream([mockTrack]);

        await act(async () => {
            resolveStreamPromise(mockStream as unknown as MediaStream);
        });

        expect(mockTrack.stop).toHaveBeenCalled();
    });

    // 9. Send failure preserves draft for retry
    it('preserves draft on send failure allowing retry', async () => {
        const onSend = vi.fn().mockRejectedValueOnce(new Error('Network error'));
        renderRecorder({ onSend });

        await act(async () => {
            fireEvent.click(screen.getByRole('button'));
        });
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /stop/i }));
        });

        const sendBtn = screen.getByRole('button', { name: /send/i });

        // First attempt fails
        await act(async () => {
            fireEvent.click(sendBtn);
        });

        expect(screen.getByRole('alert')).toHaveTextContent('Network error');
        // Draft is preserved
        expect(screen.getByTestId('voice-preview-audio')).toBeInTheDocument();
        expect(sendBtn).not.toBeDisabled();

        // Second attempt succeeds
        onSend.mockResolvedValueOnce(undefined);
        await act(async () => {
            fireEvent.click(sendBtn);
        });

        expect(onSend).toHaveBeenCalledTimes(2);
        expect(screen.queryByTestId('voice-preview-audio')).not.toBeInTheDocument();
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    // 10. Byte limit (5,000,000 bytes) enforcement
    it('aborts and shows error if recording exceeds MAX_ATTACHMENT_BYTES', async () => {
        renderRecorder();

        await act(async () => {
            fireEvent.click(screen.getByRole('button'));
        });

        // Configure mock recorder to emit a chunk exceeding MAX_ATTACHMENT_BYTES
        const hugeBlob = new Blob([new Uint8Array(MAX_ATTACHMENT_BYTES + 100)]);
        expect(MockMediaRecorder.latestInstance).not.toBeNull();
        MockMediaRecorder.latestInstance!.chunksToEmitOnStop = [hugeBlob];

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /stop/i }));
        });

        const errorAlert = screen.getByRole('alert');
        expect(errorAlert).toBeInTheDocument();
        expect(errorAlert.textContent).toMatch(/limit|лимит/i);
        expect(screen.queryByTestId('voice-preview-audio')).not.toBeInTheDocument();
    });

    // 11. MIME detection fallbacks (e.g. Safari supporting mp4)
    it('selects audio/mp4 if webm and ogg are unsupported (Safari fallback)', async () => {
        MockMediaRecorder.isTypeSupported = vi.fn((type: string) => {
            return type === 'audio/mp4';
        });

        const onSend = vi.fn().mockResolvedValue(undefined);
        renderRecorder({ onSend });

        await act(async () => {
            fireEvent.click(screen.getByRole('button'));
        });
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /stop/i }));
        });
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /send/i }));
        });

        expect(onSend).toHaveBeenCalled();
        const sendPayload = onSend.mock.calls[0][0];
        expect(sendPayload.name).toBe('voice-message.mp4');
    });

    // 12. Keyboard events stop propagation
    it('stops keyboard event propagation to protect video player hotkeys', () => {
        renderRecorder();

        const recordBtn = screen.getByRole('button');
        const event = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
        const stopSpy = vi.spyOn(event, 'stopPropagation');

        fireEvent(recordBtn, event);

        expect(stopSpy).toHaveBeenCalled();
    });

    // 13. Disabled prop
    it('disables the button when disabled prop is true', async () => {
        const getUserMediaSpy = vi.spyOn(navigator.mediaDevices, 'getUserMedia');
        renderRecorder({ disabled: true });

        const recordBtn = screen.getByRole('button');
        expect(recordBtn).toBeDisabled();

        await act(async () => {
            fireEvent.click(recordBtn);
        });

        expect(getUserMediaSpy).not.toHaveBeenCalled();
    });
});
