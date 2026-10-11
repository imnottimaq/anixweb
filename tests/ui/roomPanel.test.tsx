import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import RoomPanel from '../../src/components/RoomPanel';
import { RoomContext, type RoomContextValue } from '../../src/shared/contexts/roomContext';
import { UserContext } from '../../src/shared/contexts/userContext';
import { SettingsContext } from '../../src/shared/contexts/settingsContext';
import { defaultAppSettings, type AppSettings } from '../../src/shared/types/settings';
import type { WatchRoomState } from '../../src/shared/roomProtocol';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
    const actual = await vi.importActual('react-router-dom');
    return {
        ...actual,
        useNavigate: () => mockNavigate,
    };
});

describe('RoomPanel UI Component', () => {
    let clipboardWriteMock: ReturnType<typeof vi.fn>;

    beforeAll(() => {
        if (typeof HTMLDialogElement !== 'undefined') {
            HTMLDialogElement.prototype.showModal = function () {
                this.setAttribute('open', '');
            };
            HTMLDialogElement.prototype.close = function () {
                this.removeAttribute('open');
                this.dispatchEvent(new Event('close'));
            };
        }
    });

    beforeEach(() => {
        vi.clearAllMocks();
        clipboardWriteMock = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, 'clipboard', {
            value: {
                writeText: clipboardWriteMock,
            },
            writable: true,
            configurable: true,
        });
    });

    const createRoomState = (overrides: Partial<WatchRoomState> = {}): WatchRoomState => ({
        protocolVersion: 2,
        revision: 1,
        roomId: '12345678-1234-1234-1234-123456789abc',
        joinCode: 'ABCDEFGH',
        title: 'Watch Party Room',
        visibility: 'private',
        hostId: 1,
        media: {
            releaseId: 10,
            releaseName: 'Demon Slayer',
            dubId: 2,
            sourceId: 3,
            episode: 1,
            episodeName: 'Episode 1',
        },
        mediaVersion: 1,
        syncEpoch: 1,
        playback: {
            position: 120,
            paused: false,
            intent: 'playing',
            rate: 1,
            updatedAt: Date.now(),
        },
        barrier: null,
        participants: [
            {
                profileId: 1,
                login: 'Alice (Host)',
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
            {
                profileId: 2,
                login: 'Bob (Viewer)',
                avatar: null,
                canControl: false,
                connected: true,
                viewing: true,
                status: 'loading',
                readyEpoch: null,
                excludedEpoch: null,
                disconnectedAt: null,
                error: null,
            },
            {
                profileId: 3,
                login: 'Charlie (Controller)',
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

    const renderRoomPanel = (
        contextOverrides: Partial<RoomContextValue> = {},
        currentUserId = 1,
        compact = false,
        settingsOverrides: Partial<AppSettings> = {}
    ) => {
        const room = contextOverrides.room !== undefined ? contextOverrides.room : createRoomState();
        const defaultRoomContext: RoomContextValue = {
            activeRoomId: room?.roomId ?? '12345678-1234-1234-1234-123456789abc',
            room,
            status: 'connected',
            error: null,
            self: { profileId: currentUserId, login: `User${currentUserId}`, avatar: null },
            join: vi.fn().mockResolvedValue(undefined),
            joinByCode: vi.fn().mockResolvedValue('12345678-1234-1234-1234-123456789abc'),
            create: vi.fn().mockResolvedValue('12345678-1234-1234-1234-123456789abc'),
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
                language: 'english',
            },
            ...settingsOverrides,
        };

        const result = render(
            <MemoryRouter>
                <SettingsContext.Provider value={{ settings, setSettings: vi.fn() }}>
                    <UserContext.Provider
                        value={{
                            userId: currentUserId,
                            userToken: 'token-123',
                            setUserId: vi.fn(),
                            setUserToken: vi.fn(),
                        }}
                    >
                        <RoomContext.Provider value={defaultRoomContext}>
                            <RoomPanel compact={compact} />
                        </RoomContext.Provider>
                    </UserContext.Provider>
                </SettingsContext.Provider>
            </MemoryRouter>
        );

        return { ...result, roomContext: defaultRoomContext };
    };

    it('renders host view with full permissions and participant action menus', () => {
        const { container } = renderRoomPanel({}, 1); // Current user is Alice (Host, id: 1)

        // Check host role badge and hint
        expect(screen.getByText('You choose episodes and assign playback controls.')).toBeInTheDocument();
        const badges = screen.getAllByText('Host');
        expect(badges.length).toBeGreaterThanOrEqual(1);

        // Host sees action menus (details tags) for OTHER participants (Bob, Charlie) but NOT for herself
        const detailsMenus = container.querySelectorAll('details');
        expect(detailsMenus.length).toBe(2);

        // Verify participant listing
        expect(screen.getByText(/Alice \(Host\)/)).toBeInTheDocument();
        expect(screen.getByText(/Bob \(Viewer\)/)).toBeInTheDocument();
        expect(screen.getByText(/Charlie \(Controller\)/)).toBeInTheDocument();
    });

    it('renders read-only viewer without action menus and exits directly on leave', async () => {
        const user = userEvent.setup();
        const { container, roomContext } = renderRoomPanel({}, 2); // Current user is Bob (Viewer, id: 2)

        // Role badge reflects Viewer
        expect(screen.getByText('Viewer')).toBeInTheDocument();
        expect(screen.getByText('Episodes and playback follow the room.')).toBeInTheDocument();

        // Viewer must NOT see any participant management menus
        const detailsMenus = container.querySelectorAll('details');
        expect(detailsMenus.length).toBe(0);

        // Viewer clicking Leave does NOT open host confirmation modal; calls leave() and navigates directly
        const leaveButton = screen.getByRole('button', { name: /leave/i });
        await user.click(leaveButton);

        expect(roomContext.leave).toHaveBeenCalledTimes(1);
        expect(mockNavigate).toHaveBeenCalledWith('/together');
    });

    it('renders controller without participant management menus', () => {
        const { container } = renderRoomPanel({}, 3); // Current user is Charlie (Controller, id: 3)

        // Role badge reflects Controller
        expect(screen.getAllByText('Can control').length).toBeGreaterThanOrEqual(1);
        expect(screen.getByText('You can choose episodes and control playback.')).toBeInTheDocument();

        // Controller cannot manage participants
        const detailsMenus = container.querySelectorAll('details');
        expect(detailsMenus.length).toBe(0);
    });

    it('allows host to grant and revoke control for participants', async () => {
        const user = userEvent.setup();
        const { roomContext } = renderRoomPanel({}, 1); // Host

        // Grant control to Bob (id: 2, currently cannot control)
        const grantButton = screen.getByRole('button', { name: /allow control/i });
        await user.click(grantButton);

        expect(roomContext.send).toHaveBeenCalledWith({
            type: 'grant_control',
            profileId: 2,
        });

        // Revoke control from Charlie (id: 3, currently can control)
        const revokeButton = screen.getByRole('button', { name: /revoke control/i });
        await user.click(revokeButton);

        expect(roomContext.send).toHaveBeenCalledWith({
            type: 'revoke_control',
            profileId: 3,
        });
    });

    it('handles host transfer modal: opening, cancelling, and confirming', async () => {
        const user = userEvent.setup();
        const { roomContext, container } = renderRoomPanel({}, 1); // Host

        const dialog = container.querySelector('dialog') as HTMLDialogElement;
        expect(dialog).not.toHaveAttribute('open');

        // Click Transfer Host for Bob
        const transferButtons = screen.getAllByRole('button', { name: /transfer host/i });
        await user.click(transferButtons[0]);

        // Confirmation dialog is now open
        expect(dialog).toHaveAttribute('open');
        expect(screen.getByText(/Make Bob \(Viewer\) the host\?/i)).toBeInTheDocument();

        // 1. Cancel transfer
        const cancelButton = screen.getByRole('button', { name: /cancel/i });
        await user.click(cancelButton);

        expect(roomContext.send).not.toHaveBeenCalled();
        expect(dialog).not.toHaveAttribute('open');

        // 2. Open again and confirm transfer
        await user.click(transferButtons[0]);
        expect(dialog).toHaveAttribute('open');

        // Inside dialog, confirm button says "Transfer host"
        const dialogActions = dialog.querySelector('div')!;
        const confirmButton = dialogActions.querySelectorAll('button')[1];
        expect(confirmButton).toHaveTextContent(/transfer host/i);
        await user.click(confirmButton);

        expect(roomContext.send).toHaveBeenCalledWith({
            type: 'transfer_host',
            profileId: 2,
        });
    });

    it('handles host leave confirmation modal', async () => {
        const user = userEvent.setup();
        const { roomContext, container } = renderRoomPanel({}, 1); // Host

        const dialog = container.querySelector('dialog') as HTMLDialogElement;
        expect(dialog).not.toHaveAttribute('open');

        // Host clicks leave in footer
        const leaveButton = screen.getByRole('button', { name: /^leave$/i });
        await user.click(leaveButton);

        // Confirmation dialog opens because user is host
        expect(dialog).toHaveAttribute('open');
        expect(screen.getByText(/Leave this room\?/i)).toBeInTheDocument();
        expect(roomContext.leave).not.toHaveBeenCalled();

        // Cancel leave
        const cancelButton = screen.getByRole('button', { name: /cancel/i });
        await user.click(cancelButton);
        expect(roomContext.leave).not.toHaveBeenCalled();
        expect(dialog).not.toHaveAttribute('open');

        // Click leave again and confirm
        await user.click(leaveButton);
        expect(dialog).toHaveAttribute('open');

        const dialogActions = dialog.querySelector('div')!;
        const confirmLeaveButton = dialogActions.querySelectorAll('button')[1];
        expect(confirmLeaveButton).toHaveTextContent(/leave room/i);
        await user.click(confirmLeaveButton);

        await waitFor(() => {
            expect(roomContext.leave).toHaveBeenCalledTimes(1);
            expect(mockNavigate).toHaveBeenCalledWith('/together');
        });
    });

    it('handles kick participant modal: open, cancel, and confirm', async () => {
        const user = userEvent.setup();
        const { roomContext, container } = renderRoomPanel({}, 1); // Host

        const dialog = container.querySelector('dialog') as HTMLDialogElement;

        // Click kick button for Bob
        const kickButtons = screen.getAllByRole('button', { name: /remove from room/i });
        await user.click(kickButtons[0]);

        // Kick dialog opens
        expect(dialog).toHaveAttribute('open');
        expect(screen.getByText(/Remove Bob \(Viewer\)\?/i)).toBeInTheDocument();

        // Cancel
        const cancelButton = screen.getByRole('button', { name: /cancel/i });
        await user.click(cancelButton);
        expect(roomContext.send).not.toHaveBeenCalled();
        expect(dialog).not.toHaveAttribute('open');

        // Open and confirm kick
        await user.click(kickButtons[0]);
        const dialogActions = dialog.querySelector('div')!;
        const confirmKickButton = dialogActions.querySelectorAll('button')[1];
        expect(confirmKickButton).toHaveTextContent(/remove participant/i);
        await user.click(confirmKickButton);

        expect(roomContext.send).toHaveBeenCalledWith({
            type: 'kick',
            profileId: 2,
        });
    });

    it('handles terminal replacement status: displays banner and triggers continue here action', async () => {
        const user = userEvent.setup();
        const mockJoin = vi.fn().mockResolvedValue(undefined);

        renderRoomPanel({
            status: 'replaced',
            activeRoomId: 'replaced-room-id-1234',
            join: mockJoin,
        }, 1);

        // Terminal replaced notice is visible
        const notices = screen.getAllByText('Room is open in another tab');
        expect(notices.length).toBeGreaterThanOrEqual(1);

        // Continue here button is available
        const continueBtn = screen.getByRole('button', { name: /continue here/i });
        expect(continueBtn).toBeInTheDocument();

        await user.click(continueBtn);
        expect(mockJoin).toHaveBeenCalledWith('replaced-room-id-1234', 'ABCDEFGH', true);
    });

    it('copies invite link and room code to clipboard', async () => {
        renderRoomPanel({}, 1);

        const copyLinkBtn = screen.getByRole('button', { name: /copy link/i });
        copyLinkBtn.click();
        await waitFor(() => {
            expect(clipboardWriteMock).toHaveBeenCalledWith(
                expect.stringContaining('together/12345678-1234-1234-1234-123456789abc?code=ABCDEFGH')
            );
        });

        const copyCodeBtn = screen.getByRole('button', { name: /copy code: ABCDEFGH/i });
        copyCodeBtn.click();
        await waitFor(() => {
            expect(clipboardWriteMock).toHaveBeenCalledWith('ABCDEFGH');
        });
    });

    it('renders readiness countdown barrier when active', () => {
        const barrierRoom = createRoomState({
            barrier: {
                id: 1,
                target: 1,
                deadline: Date.now() + 5000,
            },
        });

        renderRoomPanel({ room: barrierRoom }, 1);

        const waitingStatus = screen.getByRole('status');
        expect(waitingStatus).toBeInTheDocument();
        expect(screen.getByText(/Waiting for viewers/i)).toBeInTheDocument();
        expect(screen.getByText(/Loading: Bob \(Viewer\)/i)).toBeInTheDocument();
    });

    it('renders compact mode with room title in header', () => {
        renderRoomPanel({}, 1, true);
        expect(screen.getByRole('heading', { level: 2, name: 'Watch Party Room' })).toBeInTheDocument();
    });

    it('renders host-only close room button for host and opens confirmation dialog', async () => {
        const user = userEvent.setup();
        const mockCloseRoom = vi.fn().mockResolvedValue(undefined);

        // Render as host (profileId 1)
        renderRoomPanel({ closeRoom: mockCloseRoom }, 1);

        const closeBtn = screen.getByRole('button', { name: /close room/i });
        expect(closeBtn).toBeInTheDocument();

        await user.click(closeBtn);

        // Dialog is open with title
        expect(screen.getByRole('heading', { level: 2, name: /close room\?/i })).toBeInTheDocument();
        expect(screen.getByText(/room will be closed for everyone/i)).toBeInTheDocument();

        // Confirm button inside dialog
        const dialog = document.querySelector('dialog') as HTMLDialogElement;
        const confirmBtn = within(dialog).getByRole('button', { name: /^close room$/i });
        expect(confirmBtn).toBeInTheDocument();

        await user.click(confirmBtn);

        expect(mockCloseRoom).toHaveBeenCalledTimes(1);
        expect(mockNavigate).toHaveBeenCalledWith('/together');
    });

    it('does not render close room button for non-host participants', () => {
        // Render as participant (profileId 2), host is 1
        renderRoomPanel({}, 2);

        expect(screen.queryByRole('button', { name: /close room/i })).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: /leave/i })).toBeInTheDocument();
    });
});

