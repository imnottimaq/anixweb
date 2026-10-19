import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import RoomChat from '../../src/components/RoomChat';
import { RoomContext, type RoomContextValue } from '../../src/shared/contexts/roomContext';
import { UserContext } from '../../src/shared/contexts/userContext';
import { SettingsContext } from '../../src/shared/contexts/settingsContext';
import { defaultAppSettings, type AppSettings } from '../../src/shared/types/settings';
import type { WatchRoomState, RoomChatMessage } from '../../src/shared/roomProtocol';
import * as watchRoomModule from '../../src/shared/watchRoom';

describe('Room Attachments RTL Regression Tests', () => {
    let createdUrls: string[] = [];
    let revokedUrls: string[] = [];
    let origCreateObjectURL: typeof URL.createObjectURL;
    let origRevokeObjectURL: typeof URL.revokeObjectURL;

    beforeEach(() => {
        createdUrls = [];
        revokedUrls = [];
        origCreateObjectURL = URL.createObjectURL;
        origRevokeObjectURL = URL.revokeObjectURL;

        URL.createObjectURL = vi.fn(() => {
            const url = `blob:http://localhost/${Math.random().toString(36).slice(2)}`;
            createdUrls.push(url);
            return url;
        });

        URL.revokeObjectURL = vi.fn((url: string) => {
            revokedUrls.push(url);
        });
    });

    afterEach(() => {
        URL.createObjectURL = origCreateObjectURL;
        URL.revokeObjectURL = origRevokeObjectURL;
        vi.restoreAllMocks();
    });

    const createMockRoom = (overrides: Partial<WatchRoomState> = {}): WatchRoomState => ({
        protocolVersion: 2,
        revision: 1,
        roomId: 'room-att-123',
        joinCode: 'CODE1234',
        title: 'Attachments Test Room',
        visibility: 'private',
        hostId: 1,
        media: null,
        mediaVersion: 1,
        syncEpoch: 1,
        playback: { position: 0, paused: false, intent: 'playing', rate: 1, updatedAt: Date.now() },
        barrier: null,
        participants: [
            {
                profileId: 1,
                login: 'Alice',
                avatar: null,
                canControl: true,
                connected: true,
                viewing: true,
                status: 'ready',
                readyEpoch: 1,
                excludedEpoch: null,
                disconnectedAt: null,
                error: null,
            },
        ],
        emptySince: null,
        closed: false,
        chat: [],
        ...overrides,
    });

    const renderChatWithContext = (
        roomOverrides: Partial<WatchRoomState> = {},
        contextOverrides: Partial<RoomContextValue> = {},
        language: 'english' | 'russian' = 'english'
    ) => {
        const room = createMockRoom(roomOverrides);
        const roomContext: RoomContextValue = {
            activeRoomId: room.roomId,
            room,
            status: 'connected',
            error: null,
            self: { profileId: 1, login: 'Alice', avatar: null },
            join: vi.fn().mockResolvedValue(undefined),
            joinByCode: vi.fn().mockResolvedValue(room.roomId),
            create: vi.fn().mockResolvedValue(room.roomId),
            leave: vi.fn().mockResolvedValue(undefined),
            send: vi.fn().mockResolvedValue(undefined),
            reactions: [],
            sendChat: vi.fn().mockResolvedValue(undefined),
            sendReaction: vi.fn().mockResolvedValue(undefined),
            serverNow: () => Date.now(),
            ...contextOverrides,
        };

        const settings: AppSettings = {
            ...defaultAppSettings,
            appearance: {
                ...defaultAppSettings.appearance,
                language,
            },
        };

        const result = render(
            <MemoryRouter>
                <SettingsContext.Provider value={{ settings, setSettings: vi.fn() }}>
                    <UserContext.Provider
                        value={{
                            userId: 1,
                            userToken: 'token-123',
                            setUserId: vi.fn(),
                            setUserToken: vi.fn(),
                        }}
                    >
                        <RoomContext.Provider value={roomContext}>
                            <RoomChat />
                        </RoomContext.Provider>
                    </UserContext.Provider>
                </SettingsContext.Provider>
            </MemoryRouter>
        );

        return { ...result, roomContext };
    };

    it('rejects file larger than 5,000,000 bytes with localized error', async () => {
        renderChatWithContext();

        const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
        expect(fileInput).toBeInTheDocument();

        // 5 MB + 1 byte
        const oversizedFile = new File([new Uint8Array(5_000_001)], 'large.png', { type: 'image/png' });

        await act(async () => {
            fireEvent.change(fileInput, { target: { files: [oversizedFile] } });
        });

        const alert = screen.getByRole('alert');
        expect(alert).toHaveTextContent(/File exceeds the 5 MB limit/i);
    });

    it('rejects unsupported file format with localized error', async () => {
        renderChatWithContext();

        const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
        const textFile = new File(['hello'], 'notes.txt', { type: 'text/plain' });

        await act(async () => {
            fireEvent.change(fileInput, { target: { files: [textFile] } });
        });

        const alert = screen.getByRole('alert');
        expect(alert).toHaveTextContent(/Only JPEG, PNG, GIF, WebP or AVIF images are supported/i);
    });

    it('handles image selection, shows preview, and removes draft revoking object URL', async () => {
        const user = userEvent.setup();
        renderChatWithContext();

        const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
        const validFile = new File([new Uint8Array(1024)], 'screenshot.png', { type: 'image/png' });

        await act(async () => {
            fireEvent.change(fileInput, { target: { files: [validFile] } });
        });

        // Draft preview is shown with filename
        expect(screen.getByText('screenshot.png')).toBeInTheDocument();
        expect(createdUrls.length).toBeGreaterThanOrEqual(1);

        // Click remove draft button
        const removeBtn = screen.getByRole('button', { name: /Remove attachment/i });
        await user.click(removeBtn);

        // Preview removed and URL revoked
        expect(screen.queryByText('screenshot.png')).not.toBeInTheDocument();
        expect(revokedUrls.length).toBeGreaterThanOrEqual(1);
    });

    it('uploads image draft with caption and reuses uploadId on retry', async () => {
        const user = userEvent.setup();
        let uploadCallCount = 0;
        let capturedUploadIdFirst: string | undefined;
        let capturedUploadIdSecond: string | undefined;

        vi.spyOn(watchRoomModule, 'uploadRoomAttachment').mockImplementation(async (_roomId, _blob, options) => {
            uploadCallCount++;
            if (uploadCallCount === 1) {
                capturedUploadIdFirst = options.uploadId;
                throw new Error('Upload failed network error');
            }
            capturedUploadIdSecond = options.uploadId;
            return {
                message: {
                    id: 'msg-upload-1',
                    profileId: 1,
                    login: 'Alice',
                    avatar: null,
                    text: options.text ?? '',
                    createdAt: Date.now(),
                },
            };
        });

        renderChatWithContext();

        const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
        const validFile = new File([new Uint8Array(2048)], 'photo.jpg', { type: 'image/jpeg' });

        await act(async () => {
            fireEvent.change(fileInput, { target: { files: [validFile] } });
        });

        const textarea = screen.getByRole('textbox', { name: /chat/i });
        await user.type(textarea, 'Cool photo caption');

        const sendBtn = screen.getByRole('button', { name: /^send$/i });
        // First attempt fails
        await user.click(sendBtn);

        expect(uploadCallCount).toBe(1);
        expect(screen.getByRole('alert')).toHaveTextContent(/Failed to send message/i);
        // Draft and text are preserved
        expect(screen.getByText('photo.jpg')).toBeInTheDocument();
        expect(textarea).toHaveValue('Cool photo caption');

        // Retry attempt
        await user.click(sendBtn);
        expect(uploadCallCount).toBe(2);
        // Upload ID is preserved on retry!
        expect(capturedUploadIdFirst).toBeDefined();
        expect(capturedUploadIdSecond).toBe(capturedUploadIdFirst);

        // On success, draft is cleared
        await waitFor(() => {
            expect(screen.queryByText('photo.jpg')).not.toBeInTheDocument();
            expect(textarea).toHaveValue('');
        });
    });

    it('renders received image attachment and allows inspecting in accessible modal', async () => {
        const user = userEvent.setup();
        const fakeBlob = new Blob([new Uint8Array(1024)], { type: 'image/png' });
        vi.spyOn(watchRoomModule, 'getRoomAttachment').mockResolvedValue(fakeBlob);

        const chatMessage: RoomChatMessage = {
            id: 'msg-with-image',
            profileId: 2,
            login: 'Bob',
            avatar: null,
            text: 'Look at this!',
            createdAt: Date.now(),
            attachment: {
                id: 'att-image-1',
                kind: 'image',
                mimeType: 'image/png',
                name: 'scenery.png',
                size: 1024,
            },
        };

        renderChatWithContext({ chat: [chatMessage] });

        // Message text is rendered
        expect(screen.getByText('Look at this!')).toBeInTheDocument();

        // Image button is rendered
        const imgButton = await screen.findByRole('button', { name: /scenery\.png/i });
        expect(imgButton).toBeInTheDocument();

        // Clicking the thumbnail opens the inspection modal
        await user.click(imgButton);

        const modal = screen.getByRole('dialog');
        expect(modal).toBeInTheDocument();
        expect(screen.getByText('scenery.png')).toBeInTheDocument();

        // Close modal via Close button
        const closeBtn = screen.getByRole('button', { name: /close viewer/i });
        await user.click(closeBtn);

        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('closes image modal on Escape key press', async () => {
        const fakeBlob = new Blob([new Uint8Array(1024)], { type: 'image/png' });
        vi.spyOn(watchRoomModule, 'getRoomAttachment').mockResolvedValue(fakeBlob);

        const chatMessage: RoomChatMessage = {
            id: 'msg-with-image-esc',
            profileId: 2,
            login: 'Bob',
            avatar: null,
            text: 'Image caption',
            createdAt: Date.now(),
            attachment: {
                id: 'att-image-2',
                kind: 'image',
                mimeType: 'image/png',
                name: 'diagram.png',
                size: 2048,
            },
        };

        renderChatWithContext({ chat: [chatMessage] });

        const imgButton = await screen.findByRole('button', { name: /diagram\.png/i });
        fireEvent.click(imgButton);

        expect(screen.getByRole('dialog')).toBeInTheDocument();

        // Press Escape
        fireEvent.keyDown(document.activeElement!, { key: 'Escape' });

        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('renders received voice note with audio controls and duration', async () => {
        const fakeAudioBlob = new Blob([new Uint8Array(2048)], { type: 'audio/webm' });
        vi.spyOn(watchRoomModule, 'getRoomAttachment').mockResolvedValue(fakeAudioBlob);

        const voiceMessage: RoomChatMessage = {
            id: 'msg-voice-1',
            profileId: 3,
            login: 'Charlie',
            avatar: null,
            text: '🎤 Voice message',
            createdAt: Date.now(),
            attachment: {
                id: 'att-voice-1',
                kind: 'voice',
                mimeType: 'audio/webm',
                name: 'voice-note.webm',
                size: 2048,
                durationMs: 45000,
            },
        };

        renderChatWithContext({ chat: [voiceMessage] });

        // Duration is formatted as 00:45
        await waitFor(() => {
            expect(screen.getByText('00:45')).toBeInTheDocument();
        });

        // Placeholder text "🎤 Voice message" is omitted for modern client rendering
        expect(screen.queryByText('🎤 Voice message')).not.toBeInTheDocument();

        // Audio element is present
        const audioElement = document.querySelector('audio');
        expect(audioElement).toBeInTheDocument();
    });

    it('stops keyboard propagation in chat container to protect player controls', () => {
        renderChatWithContext();

        const globalKeydown = vi.fn();
        window.addEventListener('keydown', globalKeydown);

        try {
            const chatContainer = document.querySelector('div[aria-label="Chat"]') as HTMLElement;
            fireEvent.keyDown(chatContainer, { key: ' ', code: 'Space' });
            fireEvent.keyDown(chatContainer, { key: 'ArrowRight', code: 'ArrowRight' });

            expect(globalKeydown).not.toHaveBeenCalled();
        } finally {
            window.removeEventListener('keydown', globalKeydown);
        }
    });

    it('cleans up image draft on unmount', () => {
        const { unmount } = renderChatWithContext();

        const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
        const validFile = new File([new Uint8Array(1024)], 'unmount.png', { type: 'image/png' });

        act(() => {
            fireEvent.change(fileInput, { target: { files: [validFile] } });
        });

        expect(createdUrls.length).toBeGreaterThan(0);
        unmount();
        expect(revokedUrls.length).toBeGreaterThan(0);
    });
    it('aborts an in-flight image upload and releases its preview when the chat unmounts', async () => {
        let signal: AbortSignal | undefined;
        vi.spyOn(watchRoomModule, 'uploadRoomAttachment').mockImplementation((...args) => {
            signal = args[3];
            return new Promise(() => {});
        });
        const view = renderChatWithContext();
        fireEvent.change(document.querySelector('input[type="file"]')!, {target:{files:[new File(['image'],'abort.png',{type:'image/png'})]}});
        await userEvent.click(screen.getByRole('button',{name:'Send'}));
        expect(signal?.aborted).toBe(false);
        view.unmount();
        expect(signal?.aborted).toBe(true);
        expect(revokedUrls).toContain(createdUrls[0]);
    });

});
