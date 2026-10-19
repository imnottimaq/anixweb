import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, render, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DubSelectModal from '../../src/modals/DubSelectModal';
import { SettingsContext } from '../../src/shared/contexts/settingsContext';
import { defaultAppSettings } from '../../src/shared/types/settings';

const mockGet = vi.fn();
const mockExtract = vi.fn();
vi.mock('../../src/utils/LinkParser', () => ({ extractVideoLinks: (...args: unknown[]) => mockExtract(...args) }));
vi.mock('../../src/shared/apiClient', () => ({
    useApi: () => ({
        get: (...args: unknown[]) => mockGet(...args),
    }),
}));

const mockDubs = [
    { id: 1, name: 'AniLibria', episodes_count: 12, view_count: 1500 },
    { id: 2, name: 'Studio Band', episodes_count: 12, view_count: 2200 },
];

const mockSources = [
    { id: 10, name: 'Kodik', episodes_count: 12 },
    { id: 11, name: 'Libria Direct', episodes_count: 12 },
];

const mockEpisodes = [
    { name: 'Серия 1: Начало', position: 1, url: 'https://cdn.example.com/ep1', is_watched: true },
    { name: 'Серия 2: Встреча', position: 2, url: 'https://cdn.example.com/ep2', is_watched: false },
    { name: 'Серия 3: Финал', position: 3, url: 'https://cdn.example.com/ep3', is_watched: false },
];

function defaultMockImplementation(path: string) {
    const parts = path.split('?')[0].split('/').filter(Boolean);
    if (parts[0] === 'episode') {
        if (parts.length === 2) return Promise.resolve({ code: 0, types: mockDubs });
        if (parts.length === 3) return Promise.resolve({ code: 0, sources: mockSources });
        if (parts.length === 4) return Promise.resolve({ code: 0, episodes: mockEpisodes });
    }
    return Promise.resolve({ code: 0 });
}

function renderModal(props: Partial<React.ComponentProps<typeof DubSelectModal>> = {}) {
    return render(
        <SettingsContext.Provider value={{ settings: defaultAppSettings, setSettings: vi.fn() }}>
            <DubSelectModal
                isOpen={true}
                onClose={vi.fn()}
                releaseId={100}
                token="test-token"
                resolveSources={false}
                onEpisodeSelect={vi.fn()}
                {...props}
            />
        </SettingsContext.Provider>
    );
}

describe('DubSelectModal Redesign (src/modals/DubSelectModal.tsx)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGet.mockImplementation(defaultMockImplementation);
        mockExtract.mockResolvedValue({'720':[{src:'video.mp4',type:'video/mp4'}]});
    });

    it('loads dubs, sources, and displays episode list', async () => {
        renderModal();

        await waitFor(() => {
            expect(screen.getByText('Серия 1: Начало')).toBeInTheDocument();
        });

        expect(screen.getByText('Серия 2: Встреча')).toBeInTheDocument();
        expect(screen.getByText('Серия 3: Финал')).toBeInTheDocument();
    });

    it('calls onEpisodeSelect when an episode button is clicked', async () => {
        const onEpisodeSelect = vi.fn();
        renderModal({ onEpisodeSelect });

        await waitFor(() => {
            expect(screen.getByText('Серия 2: Встреча')).toBeInTheDocument();
        });

        fireEvent.click(screen.getByText('Серия 2: Встреча'));

        await waitFor(() => {
            expect(onEpisodeSelect).toHaveBeenCalledTimes(1);
        });

        expect(onEpisodeSelect).toHaveBeenCalledWith(
            {},
            expect.objectContaining({ name: 'Серия 2: Встреча', position: 2 }),
            expect.any(Array),
            10,
            1
        );
    });

    it('supports autoSelect for room synchronization without marking as watched', async () => {
        const onEpisodeSelect = vi.fn();
        renderModal({
            autoSelect: { dubId: 1, sourceId: 10, episode: 3 },
            onEpisodeSelect,
        });

        await waitFor(() => {
            expect(onEpisodeSelect).toHaveBeenCalledTimes(1);
        });

        expect(onEpisodeSelect).toHaveBeenCalledWith(
            {},
            expect.objectContaining({ name: 'Серия 3: Финал', position: 3 }),
            expect.any(Array),
            10,
            1
        );

        // Watch endpoint must NOT be called for room auto-selection
        expect(mockGet).not.toHaveBeenCalledWith(expect.stringContaining('/watch/'));
    });

    it('shows retry button on API failure and retries fetching', async () => {
        let attempts = 0;
        mockGet.mockImplementation(async (path: string) => {
            attempts += 1;
            if (attempts === 1) throw new Error('Network error');
            const parts = path.split('?')[0].split('/').filter(Boolean);
            if (parts[0] === 'episode') {
                if (parts.length === 2) return { code: 0, types: mockDubs };
                if (parts.length === 3) return { code: 0, sources: mockSources };
                if (parts.length === 4) return { code: 0, episodes: mockEpisodes };
            }
            return { code: 0 };
        });

        renderModal();

        await waitFor(() => {
            expect(screen.getByRole('button', { name: /Попробовать снова/i })).toBeInTheDocument();
        });

        const retryButton = screen.getByRole('button', { name: /Попробовать снова/i });
        fireEvent.click(retryButton);

        await waitFor(() => {
            expect(mockGet).toHaveBeenCalledTimes(2);
        });
    });

    it('Enter on a real focused episode uses that episode rather than the list virtual index', async () => {
        const onEpisodeSelect=vi.fn(); renderModal({onEpisodeSelect});
        const list=await screen.findByRole('listbox');
        await screen.findByRole('option',{name:/2:/});
        fireEvent.keyDown(list,{key:'ArrowDown'});
        screen.getByRole('option',{name:/2:/}).focus();
        await userEvent.keyboard('{Enter}');
        await waitFor(()=>expect(onEpisodeSelect).toHaveBeenCalledTimes(1));
        expect(onEpisodeSelect.mock.calls[0][1].position).toBe(2);
    });

    it('Enter on the watched-eye action opens confirmation instead of selecting an episode', async () => {
        const onEpisodeSelect=vi.fn(); renderModal({onEpisodeSelect});
        const list=await screen.findByRole('listbox');
        await screen.findByRole('option',{name:/1:/});
        fireEvent.keyDown(list,{key:'ArrowDown'});
        (list.querySelector('button[aria-label]') as HTMLButtonElement).focus();
        await userEvent.keyboard('{Enter}');
        expect(onEpisodeSelect).not.toHaveBeenCalled();
        expect(screen.getAllByRole('dialog')).toHaveLength(2);
    });

    it('a source change invalidates pending extraction and resets the keyboard selection', async () => {
        let finish!: (sources: Record<string, unknown>)=>void;
        mockExtract.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
        const onEpisodeSelect=vi.fn(); renderModal({onEpisodeSelect,resolveSources:true});
        const first=await screen.findByRole('option',{name:/1:/});
        const list=screen.getByRole('listbox'); fireEvent.keyDown(list,{key:'ArrowDown'});
        fireEvent.click(first);
        expect(mockExtract).toHaveBeenCalledTimes(1);
        fireEvent.change(screen.getAllByRole('combobox')[1],{target:{value:'11'}});
        await screen.findByRole('option',{name:/1:/});
        await act(async()=>{finish({'720':[{src:'old.mp4',type:'video/mp4'}]});});
        expect(onEpisodeSelect).not.toHaveBeenCalled();
        expect(list).not.toHaveAttribute('aria-activedescendant');
        expect(mockExtract.mock.calls[0][1].aborted).toBe(true);
    });

    it('closing immediately cancels extraction before the modal close animation completes', async () => {
        let finish!: (sources: Record<string, unknown>)=>void;
        mockExtract.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
        const onEpisodeSelect=vi.fn(); renderModal({onEpisodeSelect,resolveSources:true});
        fireEvent.click(await screen.findByRole('option',{name:/1:/}));
        fireEvent.click(screen.getByRole('button',{name:'Закрыть'}));
        await act(async()=>{finish({'720':[{src:'old.mp4',type:'video/mp4'}]});});
        expect(onEpisodeSelect).not.toHaveBeenCalled();
        expect(mockExtract.mock.calls[0][1].aborted).toBe(true);
    });

    it('traps tab focus within dialog and restores focus upon closing', async () => {
        const trigger = document.createElement('button');
        trigger.textContent = 'Open modal';
        document.body.appendChild(trigger);
        trigger.focus();
        expect(document.activeElement).toBe(trigger);

        const { unmount } = renderModal();
        await waitFor(() => {
            expect(screen.getByText('Серия 1: Начало')).toBeInTheDocument();
        });

        const dialog = screen.getByRole('dialog');
        const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
            'button:not(:disabled), select:not(:disabled), input:not(:disabled), [tabindex="0"]'
        ));
        expect(focusable.length).toBeGreaterThan(0);
        expect(dialog.contains(document.activeElement)).toBe(true);

        const last = focusable[focusable.length - 1];
        last.focus();
        fireEvent.keyDown(document, { key: 'Tab' });
        expect(document.activeElement).toBe(focusable[0]);

        focusable[0].focus();
        fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
        expect(document.activeElement).toBe(last);

        unmount();
        expect(document.activeElement).toBe(trigger);
        trigger.remove();
    });

    it('keeps title, close button, and labeled responsive dub and provider controls within a 390px dialog bounds', async () => {
        renderModal();
        await waitFor(() => {
            expect(screen.getByText('Серия 1: Начало')).toBeInTheDocument();
        });

        const dialog = screen.getByRole('dialog');
        const closeBtn = screen.getByRole('button', { name: 'Закрыть' });
        const dubSelect = screen.getByRole('combobox', { name: /Озвучка/i });
        const providerSelect = screen.getByRole('combobox', { name: /Источник/i });

        expect(closeBtn).toBeInTheDocument();
        expect(dubSelect).toBeInTheDocument();
        expect(providerSelect).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Закрыть' })).toBeInTheDocument();
        expect(screen.getByText('Озвучка')).toBeInTheDocument();
        expect(screen.getByText('Источник')).toBeInTheDocument();

        const dialogWidth = 390;
        const padding = 16;
        const innerWidth = dialogWidth - padding * 2;

        vi.spyOn(dialog, 'getBoundingClientRect').mockReturnValue({
            left: 0,
            right: dialogWidth,
            top: 0,
            bottom: 600,
            width: dialogWidth,
            height: 600,
            x: 0,
            y: 0,
            toJSON: () => {},
        });

        vi.spyOn(closeBtn, 'getBoundingClientRect').mockReturnValue({
            left: dialogWidth - padding - 32,
            right: dialogWidth - padding,
            top: padding,
            bottom: padding + 32,
            width: 32,
            height: 32,
            x: dialogWidth - padding - 32,
            y: padding,
            toJSON: () => {},
        });

        vi.spyOn(dubSelect, 'getBoundingClientRect').mockReturnValue({
            left: padding,
            right: padding + innerWidth,
            top: 60,
            bottom: 92,
            width: innerWidth,
            height: 32,
            x: padding,
            y: 60,
            toJSON: () => {},
        });

        vi.spyOn(providerSelect, 'getBoundingClientRect').mockReturnValue({
            left: padding,
            right: padding + innerWidth,
            top: 104,
            bottom: 136,
            width: innerWidth,
            height: 32,
            x: padding,
            y: 104,
            toJSON: () => {},
        });

        const dialogRect = dialog.getBoundingClientRect();
        for (const element of [closeBtn, dubSelect, providerSelect]) {
            const rect = element.getBoundingClientRect();
            expect(rect.left).toBeGreaterThanOrEqual(dialogRect.left);
            expect(rect.right).toBeLessThanOrEqual(dialogRect.right);
            expect(rect.top).toBeGreaterThanOrEqual(dialogRect.top);
            expect(rect.bottom).toBeLessThanOrEqual(dialogRect.bottom);
        }
    });
});

