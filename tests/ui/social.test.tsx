import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import RoomChat from '../../src/components/RoomChat';
import ReactionOverlay from '../../src/components/ReactionOverlay';
import { REACTION_MAP } from '../../src/components/roomSocialConstants';
import RoomPanel from '../../src/components/RoomPanel';
import { RoomContext, type RoomContextValue } from '../../src/shared/contexts/roomContext';
import { UserContext } from '../../src/shared/contexts/userContext';
import { SettingsContext } from '../../src/shared/contexts/settingsContext';
import { defaultAppSettings, type AppSettings } from '../../src/shared/types/settings';
import type { WatchRoomState, RoomChatMessage, RoomReaction, ReactionEmoji } from '../../src/shared/roomProtocol';

describe('Frontend Social UI (RoomChat, ReactionOverlay, RoomPanel Social)', () => {
    const createMockRoom = (overrides: Partial<WatchRoomState> = {}): WatchRoomState => ({
        protocolVersion: 2,
        revision: 1,
        roomId: 'room-123',
        joinCode: 'CODE1234',
        title: 'Test Room',
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

    const createRoomContext = (overrides: Partial<RoomContextValue> = {}): RoomContextValue => {
        const room = overrides.room !== undefined ? overrides.room : createMockRoom();
        return {
            activeRoomId: room?.roomId ?? 'room-123',
            room,
            status: 'connected',
            error: null,
            self: { profileId: 1, login: 'Alice', avatar: null },
            join: vi.fn().mockResolvedValue(undefined),
            joinByCode: vi.fn().mockResolvedValue('room-123'),
            create: vi.fn().mockResolvedValue('room-123'),
            leave: vi.fn().mockResolvedValue(undefined),
            send: vi.fn().mockResolvedValue(undefined),
            reactions: [],
            sendChat: vi.fn().mockResolvedValue(undefined),
            sendReaction: vi.fn().mockResolvedValue(undefined),
            serverNow: () => Date.now(),
            ...overrides,
        };
    };

    const renderWithContext = (
        ui: React.ReactElement,
        contextValue: Partial<RoomContextValue> = {},
        language: 'english' | 'russian' = 'english'
    ) => {
        const roomContext = createRoomContext(contextValue);
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
                            {ui}
                        </RoomContext.Provider>
                    </UserContext.Provider>
                </SettingsContext.Provider>
            </MemoryRouter>
        );

        return { ...result, roomContext };
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    // =========================================================================
    // 1. Chat rendering
    // =========================================================================
    describe('RoomChat - Rendering', () => {
        it('renders message list with author login, formatted timestamp, and plain text without HTML injection', () => {
            const maliciousText = '<b id="injected-tag">Bold Text</b><script>alert("hack")</script>';
            const testTimestamp = new Date(2026, 9, 9, 14, 30).getTime(); // 14:30
            const chatMessages: RoomChatMessage[] = [
                {
                    id: 'msg-1',
                    profileId: 2,
                    login: 'Bob',
                    avatar: null,
                    text: maliciousText,
                    createdAt: testTimestamp,
                },
                {
                    id: 'msg-2',
                    profileId: 1,
                    login: 'Alice',
                    avatar: 'https://example.com/alice.png',
                    text: 'Hello from Alice!',
                    createdAt: testTimestamp + 60000,
                },
            ];

            const room = createMockRoom({ chat: chatMessages });
            const { container } = renderWithContext(<RoomChat />, { room });

            // Verify author logins are rendered
            expect(screen.getByText('Bob')).toBeInTheDocument();
            expect(screen.getByText('Alice')).toBeInTheDocument();

            // Verify message texts are rendered strictly as plain text
            expect(screen.getByText(maliciousText)).toBeInTheDocument();
            // Verify NO HTML elements were injected
            expect(container.querySelector('#injected-tag')).toBeNull();
            expect(container.querySelector('script')).toBeNull();

            // Verify initial letter fallback for null avatar
            expect(screen.getByText('B')).toBeInTheDocument();

            // Verify timestamp is displayed in HH:MM format
            const timeElements = container.querySelectorAll('time');
            expect(timeElements.length).toBe(2);
            expect(timeElements[0]?.textContent).toMatch(/\d{2}:\d{2}/);
        });

        it('renders empty chat placeholder when there are no messages', () => {
            const room = createMockRoom({ chat: [] });
            renderWithContext(<RoomChat />, { room });

            expect(screen.getByText(/No messages yet/i)).toBeInTheDocument();
        });

        it('supports compact prop for compact sidebar view', () => {
            const room = createMockRoom();
            const { container } = renderWithContext(<RoomChat compact={true} />, { room });

            const textarea = screen.getByPlaceholderText(/Write a message/i);
            expect(textarea).toHaveAttribute('rows', '2');
            expect(container.querySelector('[class*="compact"]')).not.toBeNull();
        });
    });

    // =========================================================================
    // 2. Sending messages (Enter, Shift+Enter, IME composition)
    // =========================================================================
    describe('RoomChat - Message Sending', () => {
        it('sends message on Enter key and clears textarea input upon success', async () => {
            const sendChatMock = vi.fn().mockResolvedValue(undefined);
            renderWithContext(<RoomChat />, { sendChat: sendChatMock });

            const textarea = screen.getByPlaceholderText(/Write a message/i) as HTMLTextAreaElement;
            await userEvent.type(textarea, 'Test message');
            expect(textarea.value).toBe('Test message');

            fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });

            await waitFor(() => {
                expect(sendChatMock).toHaveBeenCalledWith('Test message');
            });
            expect(textarea.value).toBe('');
        });

        it('inserts newline on Shift+Enter and does NOT trigger sendChat', async () => {
            const sendChatMock = vi.fn().mockResolvedValue(undefined);
            renderWithContext(<RoomChat />, { sendChat: sendChatMock });

            const textarea = screen.getByPlaceholderText(/Write a message/i) as HTMLTextAreaElement;
            await userEvent.type(textarea, 'Line 1');

            fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true });

            expect(sendChatMock).not.toHaveBeenCalled();
            expect(textarea.value).toBe('Line 1');
        });

        it('safeguards against IME composition: Enter during IME does NOT trigger send', async () => {
            const sendChatMock = vi.fn().mockResolvedValue(undefined);
            renderWithContext(<RoomChat />, { sendChat: sendChatMock });

            const textarea = screen.getByPlaceholderText(/Write a message/i) as HTMLTextAreaElement;
            await userEvent.type(textarea, 'Konnichiwa');

            // Fire Enter with isComposing = true and keyCode = 229 (IME)
            fireEvent.keyDown(textarea, {
                key: 'Enter',
                shiftKey: false,
                isComposing: true,
                keyCode: 229,
            });

            expect(sendChatMock).not.toHaveBeenCalled();
            expect(textarea.value).toBe('Konnichiwa');
        });

        it('sends message via submit button click', async () => {
            const sendChatMock = vi.fn().mockResolvedValue(undefined);
            renderWithContext(<RoomChat />, { sendChat: sendChatMock });

            const textarea = screen.getByPlaceholderText(/Write a message/i);
            await userEvent.type(textarea, 'Clicked send');

            const sendButton = screen.getByRole('button', { name: /Send/i });
            await userEvent.click(sendButton);

            await waitFor(() => {
                expect(sendChatMock).toHaveBeenCalledWith('Clicked send');
            });
            expect((textarea as HTMLTextAreaElement).value).toBe('');
        });
    });

    // =========================================================================
    // 3. Validation & draft preservation
    // =========================================================================
    describe('RoomChat - Validation & Draft Preservation', () => {
        it('rejects empty or whitespace-only messages and shows validation error', async () => {
            const sendChatMock = vi.fn().mockResolvedValue(undefined);
            renderWithContext(<RoomChat />, { sendChat: sendChatMock });

            const textarea = screen.getByPlaceholderText(/Write a message/i);
            await userEvent.type(textarea, '    ');

            const sendButton = screen.getByRole('button', { name: /Send/i });
            await userEvent.click(sendButton);

            expect(sendChatMock).not.toHaveBeenCalled();
            expect(screen.getByRole('alert')).toHaveTextContent(/Message cannot be empty/i);
        });

        it('preserves draft text when sendChat fails with an error', async () => {
            const sendChatMock = vi.fn().mockRejectedValue(new Error('Network failure'));
            renderWithContext(<RoomChat />, { sendChat: sendChatMock });

            const textarea = screen.getByPlaceholderText(/Write a message/i) as HTMLTextAreaElement;
            await userEvent.type(textarea, 'Valuable draft text');

            const sendButton = screen.getByRole('button', { name: /Send/i });
            await userEvent.click(sendButton);

            await waitFor(() => {
                expect(screen.getByRole('alert')).toHaveTextContent('Failed to send message');
            });

            // The draft should still be in the textarea
            expect(textarea.value).toBe('Valuable draft text');
        });

        it('character counter displays used characters out of 500', async () => {
            renderWithContext(<RoomChat />);

            const textarea = screen.getByPlaceholderText(/Write a message/i) as HTMLTextAreaElement;
            const counter = screen.getByTestId('chat-char-counter');

            expect(textarea).toHaveAttribute('maxLength', '500');
            expect(counter).toHaveTextContent(/^0\/500$/);
            expect(counter).not.toHaveAttribute('aria-live');
            expect(textarea).toHaveAttribute('aria-describedby', counter.id);

            await userEvent.type(textarea, 'Hello');
            expect(counter).toHaveTextContent(/^5\/500$/);
            expect(counter).toHaveAttribute('aria-label', '495 characters left');
        });
    });

    // =========================================================================
    // 4. Disabled states when disconnected, replaced, kicked, error
    // =========================================================================
    describe('RoomChat & RoomPanel - Disabled States', () => {
        it('disables chat textarea and send button when status is idle', () => {
            renderWithContext(<RoomChat />, { status: 'idle' });

            const textarea = screen.getByPlaceholderText(/Write a message/i);
            const sendButton = screen.getByRole('button', { name: /Send/i });

            expect(textarea).toBeDisabled();
            expect(sendButton).toBeDisabled();
        });

        it('disables chat textarea and send button when status is replaced', () => {
            renderWithContext(<RoomChat />, { status: 'replaced' });

            const textarea = screen.getByPlaceholderText(/Write a message/i);
            const sendButton = screen.getByRole('button', { name: /Send/i });

            expect(textarea).toBeDisabled();
            expect(sendButton).toBeDisabled();
        });

        it('disables reaction buttons in RoomPanel when status is not connected', () => {
            const room = createMockRoom();
            renderWithContext(<RoomPanel />, { room, status: 'error' });

            const heartBtn = screen.getByRole('button', { name: /Heart/i });
            const fireBtn = screen.getByRole('button', { name: /Fire/i });

            expect(heartBtn).toBeDisabled();
            expect(fireBtn).toBeDisabled();
        });

        it('enables reaction buttons in RoomPanel when status is connected', () => {
            const room = createMockRoom();
            renderWithContext(<RoomPanel />, { room, status: 'connected' });

            const heartBtn = screen.getByRole('button', { name: /Heart/i });
            const fireBtn = screen.getByRole('button', { name: /Fire/i });

            expect(heartBtn).not.toBeDisabled();
            expect(fireBtn).not.toBeDisabled();
        });
    });

    // =========================================================================
    // 5. Reactions: buttons in RoomPanel & live overlay
    // =========================================================================
    describe('Reactions - Buttons & Live ReactionOverlay', () => {
        it('renders all 6 allowlist reaction buttons with localized titles in RoomPanel and handles clicks', async () => {
            const sendReactionMock = vi.fn().mockResolvedValue(undefined);
            const room = createMockRoom();
            renderWithContext(<RoomPanel />, { room, status: 'connected', sendReaction: sendReactionMock });

            const expectedReactions: Array<{ emoji: ReactionEmoji; label: RegExp }> = [
                { emoji: 'heart', label: /Heart/i },
                { emoji: 'laugh', label: /Laugh/i },
                { emoji: 'clap', label: /Clap/i },
                { emoji: 'fire', label: /Fire/i },
                { emoji: 'surprise', label: /Surprise/i },
                { emoji: 'sad', label: /Sad/i },
            ];

            for (const { emoji, label } of expectedReactions) {
                const btn = screen.getByRole('button', { name: label });
                expect(btn).toBeInTheDocument();
                expect(btn.querySelector(`[data-reaction="${emoji}"]`)).toHaveTextContent(REACTION_MAP[emoji]);

                await userEvent.click(btn);
                expect(sendReactionMock).toHaveBeenCalledWith(emoji);
            }
        });

        it('renders emoji reactions while keeping accessible labels and IDs', () => {
            const sendReactionMock = vi.fn().mockResolvedValue(undefined);
            const room = createMockRoom();
            renderWithContext(<RoomPanel />, { room, status: 'connected', sendReaction: sendReactionMock });

            const reactionsToolbar = screen.getByRole('toolbar', { name: /Reactions/i });
            expect(reactionsToolbar).toBeInTheDocument();

            const buttons = reactionsToolbar.querySelectorAll('button');
            expect(buttons).toHaveLength(6);

            for (const btn of buttons) {
                const symbol = btn.querySelector('[data-reaction]');
                expect(symbol).toBeInTheDocument();
                expect(btn.querySelector('svg')).toBeNull();
                const reactionAttr = symbol?.getAttribute('data-reaction') as ReactionEmoji;
                expect(['heart', 'laugh', 'clap', 'fire', 'surprise', 'sad']).toContain(reactionAttr);
                expect(symbol).toHaveTextContent(REACTION_MAP[reactionAttr]);
                expect(btn.getAttribute('aria-label')).toBeTruthy();
            }
        });

        it('ReactionOverlay renders incoming reactions with emoji and sender name', () => {
            const mockReactions: RoomReaction[] = [
                {
                    id: 'r-1',
                    profileId: 2,
                    login: 'Bob',
                    avatar: null,
                    emoji: 'fire',
                    createdAt: Date.now(),
                },
                {
                    id: 'r-2',
                    profileId: 3,
                    login: 'Charlie',
                    avatar: null,
                    emoji: 'heart',
                    createdAt: Date.now(),
                },
            ];

            renderWithContext(<ReactionOverlay reactions={mockReactions} />);

            expect(screen.getByText('Bob')).toBeInTheDocument();
            expect(document.querySelector('[data-testid="reaction-overlay"] [data-reaction="fire"]')).toHaveTextContent(REACTION_MAP.fire);
            expect(screen.getByText('Charlie')).toBeInTheDocument();
            expect(document.querySelector('[data-testid="reaction-overlay"] [data-reaction="heart"]')).toHaveTextContent(REACTION_MAP.heart);
        });

        it('ReactionOverlay cleans up reactions on expiry timer', () => {
            vi.useFakeTimers();

            try {
                const mockReactions: RoomReaction[] = [
                    {
                        id: 'r-expire',
                        profileId: 2,
                        login: 'ExpiringUser',
                        avatar: null,
                        emoji: 'laugh',
                        createdAt: Date.now(),
                    },
                ];

                renderWithContext(<ReactionOverlay reactions={mockReactions} />);

                expect(screen.getByText('ExpiringUser')).toBeInTheDocument();

                // Advance time past 4 seconds TTL
                act(() => {
                    vi.advanceTimersByTime(4100);
                });

                expect(screen.queryByText('ExpiringUser')).toBeNull();
            } finally {
                vi.useRealTimers();
            }
        });
    });

    // =========================================================================
    // 6. Prefers-reduced-motion
    // =========================================================================
    describe('Accessibility - Prefers-reduced-motion', () => {
        const originalMatchMedia = window.matchMedia;

        afterEach(() => {
            window.matchMedia = originalMatchMedia;
        });

        it('ReactionOverlay respects prefers-reduced-motion: reduce', () => {
            window.matchMedia = vi.fn().mockImplementation((query: string) => ({
                matches: query === '(prefers-reduced-motion: reduce)',
                media: query,
                onchange: null,
                addListener: vi.fn(),
                removeListener: vi.fn(),
                addEventListener: vi.fn(),
                removeEventListener: vi.fn(),
                dispatchEvent: vi.fn(),
            }));

            const mockReactions: RoomReaction[] = [
                {
                    id: 'r-reduced',
                    profileId: 2,
                    login: 'MotionUser',
                    avatar: null,
                    emoji: 'heart',
                    createdAt: Date.now(),
                },
            ];

            renderWithContext(<ReactionOverlay reactions={mockReactions} />);

            const overlay = screen.getByTestId('reaction-overlay');
            expect(overlay).toHaveAttribute('data-reduced-motion', 'true');

            const bubble = screen.getByTestId('reaction-bubble');
            expect(bubble.className).toMatch(/reducedMotionItem/);
        });
    });

    // =========================================================================
    // 7. Autoscroll & Unread/new-message affordance
    // =========================================================================
    describe('RoomChat - Autoscroll & New Messages Badge', () => {
        it('displays new messages affordance button when user is scrolled up and new message arrives', async () => {
            const initialChat: RoomChatMessage[] = [
                { id: '1', profileId: 2, login: 'Bob', avatar: null, text: 'Old message 1', createdAt: 1000 },
                { id: '2', profileId: 2, login: 'Bob', avatar: null, text: 'Old message 2', createdAt: 2000 },
            ];

            const room = createMockRoom({ chat: initialChat });
            const { rerender, container } = renderWithContext(<RoomChat />, { room });

            const scrollContainer = container.querySelector('[role="log"]') as HTMLDivElement;
            expect(scrollContainer).not.toBeNull();

            // Simulate user scrolling up (scrollHeight: 1000, clientHeight: 200, scrollTop: 200 -> distance = 600 > 60)
            Object.defineProperty(scrollContainer, 'scrollHeight', { value: 1000, configurable: true });
            Object.defineProperty(scrollContainer, 'clientHeight', { value: 200, configurable: true });
            Object.defineProperty(scrollContainer, 'scrollTop', { value: 200, writable: true, configurable: true });

            fireEvent.scroll(scrollContainer);

            // Now a new message arrives while user was scrolled up
            const updatedChat: RoomChatMessage[] = [
                ...initialChat,
                { id: '3', profileId: 2, login: 'Bob', avatar: null, text: 'New incoming message', createdAt: 3000 },
            ];
            const updatedRoom = createMockRoom({ chat: updatedChat });

            const englishSettings: AppSettings = {
                ...defaultAppSettings,
                appearance: {
                    ...defaultAppSettings.appearance,
                    language: 'english',
                },
            };

            rerender(
                <MemoryRouter>
                    <SettingsContext.Provider value={{ settings: englishSettings, setSettings: vi.fn() }}>
                        <UserContext.Provider value={{ userId: 1, userToken: 'token-123', setUserId: vi.fn(), setUserToken: vi.fn() }}>
                            <RoomContext.Provider value={createRoomContext({ room: updatedRoom })}>
                                <RoomChat />
                            </RoomContext.Provider>
                        </UserContext.Provider>
                    </SettingsContext.Provider>
                </MemoryRouter>
            );

            // New messages affordance badge should appear
            const newMessagesBtn = await screen.findByRole('button', { name: /(New messages|Новые сообщения)/i });
            expect(newMessagesBtn).toBeInTheDocument();

            // Clicking the button scrolls to bottom and removes the badge
            await userEvent.click(newMessagesBtn);
            expect(screen.queryByRole('button', { name: /(New messages|Новые сообщения)/i })).toBeNull();
        });
    });

    // =========================================================================
    // 8. Russian localization
    // =========================================================================
    describe('Room social keyboard boundaries', () => {
        it('keeps social button keys out of global playback shortcuts', () => {
            renderWithContext(<RoomPanel />, { room: createMockRoom(), status: 'connected' });
            const globalKeys = vi.fn();
            window.addEventListener('keydown', globalKeys);
            try {
                fireEvent.keyDown(screen.getByRole('button', { name: 'Send' }), { key: ' ', code: 'Space' });
                fireEvent.keyDown(screen.getByRole('button', { name: 'Heart' }), { key: 'Enter' });
                expect(globalKeys).not.toHaveBeenCalled();
            } finally {
                window.removeEventListener('keydown', globalKeys);
            }
        });
        it('moves focus between reaction buttons with arrows and Home/End', () => {
            renderWithContext(<RoomPanel />, { room: createMockRoom(), status: 'connected' });
            const heart = screen.getByRole('button', { name: 'Heart' });
            heart.focus();
            fireEvent.keyDown(heart, { key: 'ArrowRight' });
            expect(screen.getByRole('button', { name: 'Laugh' })).toHaveFocus();
            fireEvent.keyDown(document.activeElement!, { key: 'End' });
            expect(screen.getByRole('button', { name: 'Sad' })).toHaveFocus();
            fireEvent.keyDown(document.activeElement!, { key: 'Home' });
            expect(heart).toHaveFocus();
        });
    });
    describe('Russian Localization', () => {
        it('renders chat and reactions in Russian when language is set to russian', () => {
            const room = createMockRoom();
            renderWithContext(<RoomPanel />, { room, status: 'connected' }, 'russian');

            expect(screen.getByPlaceholderText('Написать сообщение…')).toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'Отправить' })).toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'Сердце' })).toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'Огонь' })).toBeInTheDocument();
        });
    });
});
