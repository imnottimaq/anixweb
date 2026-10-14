import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { useContext, type ReactElement } from 'react';
import PopularScreen from '../../src/pages/PopularScreen';
import ScheduleScreen from '../../src/pages/ScheduleScreen';
import OverviewScreen from '../../src/pages/OverviewScreen';
import RootLayout from '../../src/app/RootLayout';
import { extractReleaseId, getCommentReleaseDisplayTitle, resolveCommentReleases, isUsableTitle } from '../../src/shared/discover/commentTitle';
import { SettingsContext } from '../../src/shared/contexts/settingsContext';
import { UserContext } from '../../src/shared/contexts/userContext';
import { RoomContext, type RoomContextValue } from '../../src/shared/contexts/roomContext';
import { SearchContext } from '../../src/shared/contexts/searchContext';
import { ReleaseActionsContext } from '../../src/shared/contexts/releaseActionsContext';
import { defaultAppSettings, type AppSettings } from '../../src/shared/types/settings';
import { mockAnime1 } from '../e2e/fixtures/mockData';

const { mockGet, mockPost, api } = vi.hoisted(() => {
    const mockGet = vi.fn(); const mockPost = vi.fn();
    return { mockGet, mockPost, api: { get: mockGet, post: mockPost, postForm: vi.fn(), getViaAgent: vi.fn(), postViaAgent: vi.fn(), postFormViaAgent: vi.fn() } };
});
vi.mock('../../src/shared/apiClient', () => ({ useApi: () => api }));
const englishSettings: AppSettings = { ...defaultAppSettings, appearance: { ...defaultAppSettings.appearance, language: 'english' } };
const anime = { ...mockAnime1, title_original: 'First release', title_ru: 'Первый релиз' };
function providers(ui: ReactElement, activeRoomId: string | null = null, settings = englishSettings) {
    const room: RoomContextValue = { activeRoomId, room: null, status: 'idle', error: null, self: null, reactions: [],
        join: vi.fn(async () => {}), joinByCode: vi.fn(async () => 'room'), create: vi.fn(async () => 'room'), leave: vi.fn(async () => {}),
        send: vi.fn(async () => {}), sendChat: vi.fn(async () => {}), sendReaction: vi.fn(async () => {}), serverNow: Date.now };
    return render(<MemoryRouter><SettingsContext.Provider value={{ settings, setSettings: vi.fn() }}>
        <UserContext.Provider value={{ userToken: '', userId: 1, setUserToken: vi.fn(), setUserId: vi.fn() }}>
            <RoomContext.Provider value={room}><SearchContext.Provider value={{ searchScope: { type: 'releases' }, setSearchScope: vi.fn() }}>{ui}</SearchContext.Provider></RoomContext.Provider>
        </UserContext.Provider></SettingsContext.Provider></MemoryRouter>);
}
beforeEach(() => { vi.resetAllMocks(); localStorage.setItem('onboarded', 'true'); mockGet.mockResolvedValue({ code: 0, content: [] }); mockPost.mockResolvedValue({ code: 0, content: [] }); });

describe('Jackson release identity references', () => {
    it('resolves forward/interleaved references using @id, never comment IDs or catalog IDs as references', () => {
        const a = { '@id': 71, id: 9101, title_ru: 'Первый', title_original: 'First' };
        const b = { '@id': 82, id: 9102, title_ru: 'Второй', title_original: 'Second' };
        const comments = [82, a, b, 71, 82, 999, 9101, null].map((release, i) => ({ id: i + 1, profile: { login: 'viewer' }, message: `Comment ${i}`, release }));
        const result = resolveCommentReleases(comments);
        expect(result.map(extractReleaseId)).toEqual([9102, 9101, 9102, 9101, 9102, null, null, null]);
        expect(getCommentReleaseDisplayTitle(result[0], 'english')).toBe('Second');
        expect(getCommentReleaseDisplayTitle(result[1], 'russian')).toBe('Первый');
        expect(comments[0].release).toBe(82);
    });
    it('rejects unproven IDs and unrelated previous/parent release inheritance', () => {
        expect(extractReleaseId(71)).toBeNull(); expect(extractReleaseId('71')).toBeNull();
        expect(extractReleaseId({ '@id': 71 })).toBeNull();
        expect(extractReleaseId({ id: 5, release: { id: 101 } })).toBe(101);
        expect(extractReleaseId({ id: 5, release: 101 })).toBeNull();
        const result = resolveCommentReleases([{ id: 1, profile: { login: 'a' }, message: 'First', release: { id: 101 } },
            { id: 2, profile: { login: 'b' }, message: 'Unknown', parent_comment_id: 1 }]);
        expect(extractReleaseId(result[1])).toBeNull();
    });
    it('uses locale title fallback and suppresses bogus title placeholders', () => {
        expect(getCommentReleaseDisplayTitle({ id: 101, title_original: 'Original' }, 'russian')).toBe('Original');
        expect(getCommentReleaseDisplayTitle({ title_ru: 'Русский' }, 'english')).toBe('Русский');
        for (const value of ['', '  ', 'undefined', 'NULL', '[object Object]', '20389']) expect(isUsableTitle(value)).toBe(false);
    });
});

describe('Popular pagination and keyboard access', () => {
    it('uses one-row page metadata, keeps loaded cards on failure, and retries precisely the failed page', async () => {
        mockPost.mockResolvedValueOnce({ code: 0, current_page: 0, total_page_count: 2, content: [anime] })
            .mockRejectedValueOnce(new Error('Outage'))
            .mockResolvedValueOnce({ code: 0, current_page: 1, total_page_count: 2, content: [{ ...anime, id: 102, title_original: 'Second release' }] });
        const user = userEvent.setup(); providers(<PopularScreen />);
        const first = await screen.findByRole('link', { name: /First release/ });
        await user.click(screen.getByRole('button', { name: 'Load more' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('Failed to load popular releases');
        expect(first).toBeVisible();
        await user.click(screen.getByRole('button', { name: 'Try again' }));
        expect(await screen.findByRole('link', { name: /Second release/ })).toBeVisible(); expect(first).toBeVisible();
        expect(mockPost.mock.calls.map(call => call[0])).toEqual(['/filter/0?extended_mode=true', '/filter/1?extended_mode=true', '/filter/1?extended_mode=true']);
        expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
        expect(mockPost.mock.calls[0][1]).toMatchObject({ sort: 3 });
        expect(mockPost.mock.calls[0][3].signal).toBeInstanceOf(AbortSignal);
    });
    it('aborts old requests, moves focus with arrows/Home/End, and points all tabs at the actual panel', async () => {
        mockPost.mockImplementation(() => new Promise(() => {}));
        const user = userEvent.setup(); providers(<PopularScreen />);
        await waitFor(() => expect(mockPost).toHaveBeenCalledTimes(1));
        const signal = mockPost.mock.calls[0][3].signal as AbortSignal;
        const all = screen.getByRole('tab', { name: 'All' }); all.focus();
        await user.keyboard('{ArrowRight}');
        expect(screen.getByRole('tab', { name: 'Ongoing' })).toHaveFocus(); expect(signal.aborted).toBe(true);
        await user.keyboard('{End}'); expect(screen.getByRole('tab', { name: 'OVA' })).toHaveFocus();
        await user.keyboard('{Home}'); expect(all).toHaveFocus();
        for (const tab of screen.getAllByRole('tab')) expect(tab).toHaveAttribute('aria-controls', 'popular-panel');
        expect(screen.getAllByRole('tab').filter(tab => tab.tabIndex === 0)).toHaveLength(1);
    });
    it('shows initial failure/empty states and retries a first-page outage', async () => {
        mockPost.mockRejectedValueOnce(new Error('Outage')).mockResolvedValueOnce({ content: [] });
        const user = userEvent.setup(); providers(<PopularScreen />);
        expect(await screen.findByRole('alert')).toHaveTextContent('Failed to load popular releases');
        await user.click(screen.getByRole('button', { name: 'Try again' }));
        expect(await screen.findByText('No popular releases found.')).toBeVisible();
    });
});

describe('Schedule real weekday response', () => {
    it('retries an outage, displays each day and all-week view, and supports keyboard tabs', async () => {
        mockGet.mockRejectedValueOnce(new Error('Outage')).mockResolvedValueOnce({ code: 0, monday: [anime], tuesday: [], wednesday: [] });
        const user = userEvent.setup(); providers(<ScheduleScreen />);
        expect(await screen.findByRole('alert')).toHaveTextContent('Failed to load schedule');
        await user.click(screen.getByRole('button', { name: 'Try again' }));
        const monday = screen.getByRole('tab', { name: /^Monday/ }); await user.click(monday);
        expect(await screen.findByRole('link', { name: /First release/ })).toBeVisible();
        monday.focus(); await user.keyboard('{ArrowRight}'); expect(screen.getByRole('tab', { name: /^Tuesday/ })).toHaveFocus();
        expect(screen.getByText('Nothing scheduled for this day.')).toBeVisible();
        await user.keyboard('{Home}'); expect(screen.getByRole('tab', { name: /^All week/ })).toHaveFocus();
        expect(screen.getByRole('link', { name: /First release/ })).toBeVisible();
        expect(mockGet.mock.calls[1]).toEqual(['/schedule', expect.objectContaining({ signal: expect.any(AbortSignal) })]);
    });
});

describe('Overview and shared navigation', () => {
    it('renders catalog-ID comment links and leaves unresolved references as readable articles', async () => {
        const releases = resolveCommentReleases([{ id: 1, profile: { login: 'User' }, message: 'Resolved comment', release: 71 },
            { id: 2, profile: { login: 'Other' }, message: 'Full release', release: { '@id': 71, id: 9101, title_original: 'First season' } },
            { id: 3, profile: { login: 'Unknown' }, message: 'Unknown reference', release: 999 }]);
        mockGet.mockImplementation((path: string) => Promise.resolve({ code: 0, content: path === '/discover/comments' ? releases : [] }));
        providers(<OverviewScreen />);
        expect(await screen.findByRole('link', { name: /Resolved comment/ })).toHaveAttribute('href', '/anime/9101');
        expect(screen.queryByRole('link', { name: /Unknown reference/ })).not.toBeInTheDocument();
        expect(screen.getByText('Unknown reference')).toBeVisible();
        expect(screen.getByRole('link', { name: 'Popular' })).toHaveAttribute('href', '/popular');
        expect(screen.getByRole('link', { name: 'Schedule' })).toHaveAttribute('href', '/schedule');
    });
    it('surfaces partial failure, retries it, and does not cache outages on remount', async () => {
        let fail = true;
        mockGet.mockImplementation((path: string) => path.includes('recommendations') && fail ? Promise.reject(new Error('Outage')) : Promise.resolve({ code: 0, content: path.includes('recommendations') ? [anime] : [] }));
        const user = userEvent.setup(); const view = providers(<OverviewScreen />);
        expect(await screen.findByRole('alert')).toHaveTextContent('Some sections could not be loaded');
        fail = false; await user.click(screen.getByRole('button', { name: 'Try again' }));
        expect(await screen.findByRole('link', { name: /First release/ })).toBeVisible();
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        view.unmount(); providers(<OverviewScreen />);
        await screen.findByRole('link', { name: /First release/ });
        expect(mockGet.mock.calls.filter(call => call[0].includes('recommendations'))).toHaveLength(3);
    });
    it('preserves release provider and navigation controls; Escape restores menu-trigger focus', async () => {
        function Probe() { return <span data-testid="release-provider">{useContext(ReleaseActionsContext) ? 'available' : 'missing'}</span>; }
        const user = userEvent.setup(); providers(<Routes><Route path="/" element={<RootLayout />}><Route index element={<Probe />} /></Route></Routes>, 'active-room');
        expect(screen.getByTestId('release-provider')).toHaveTextContent('available');
        const nav = screen.getByRole('navigation', { name: 'Primary navigation' });
        expect(within(nav).queryByRole('link', { name: 'Popular' })).not.toBeInTheDocument();
        expect(within(nav).queryByRole('link', { name: 'Schedule' })).not.toBeInTheDocument();
        for (const [name, path] of [['Home', '/'], ['Overview', '/overview'], ['Favorites', '/favorites']]) expect(within(nav).getByRole('link', { name })).toHaveAttribute('href', path);
        expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/settings');
        expect(screen.getByRole('link', { name: /return/i })).toHaveAttribute('href', '/together/active-room');
        const menu = screen.getByRole('button', { name: 'Menu' }); await user.click(menu);
        expect(menu).toHaveAttribute('aria-expanded', 'true');
        fireEvent.keyDown(document, { key: 'Escape' }); expect(menu).toHaveAttribute('aria-expanded', 'false'); expect(menu).toHaveFocus();
    });
});
