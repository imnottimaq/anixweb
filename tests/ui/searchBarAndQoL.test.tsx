import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import SearchBar from '../../src/components/SearchBar';
import ScrollToTop from '../../src/components/ScrollToTop';
import { SettingsContext } from '../../src/shared/contexts/settingsContext';
import { defaultAppSettings } from '../../src/shared/types/settings';
import { SearchContext } from '../../src/shared/contexts/searchContext';

const mockGet = vi.fn();
vi.mock('../../src/shared/apiClient', () => ({
    useApi: () => ({
        get: (...args: unknown[]) => mockGet(...args),
        postViaAgent: vi.fn(),
    }),
}));

function renderSearchBar() {
    return render(
        <MemoryRouter>
            <SettingsContext.Provider value={{ settings: defaultAppSettings, setSettings: vi.fn() }}>
                <SearchContext.Provider value={{ searchScope: { type: 'releases' }, setSearchScope: vi.fn() }}>
                    <SearchBar />
                </SearchContext.Provider>
            </SettingsContext.Provider>
        </MemoryRouter>
    );
}

describe('QoL: SearchBar Recent Searches and Hotkeys', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
    });

    it('displays recent searches from history when search is expanded and query is empty', async () => {
        localStorage.setItem('search_history', JSON.stringify(['Наруто', 'Блич']));

        renderSearchBar();

        // Click search trigger button to expand
        const trigger = screen.getByRole('button', { name: /поиск/i });
        fireEvent.click(trigger);

        await waitFor(() => {
            expect(screen.getByText('Недавние запросы')).toBeInTheDocument();
        });

        expect(screen.getByRole('button', { name: 'Наруто' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Блич' })).toBeInTheDocument();
    });

    it('fills input and executes search when clicking a recent search tag', async () => {
        localStorage.setItem('search_history', JSON.stringify(['Ванпис']));

        renderSearchBar();

        const trigger = screen.getByRole('button', { name: /поиск/i });
        fireEvent.click(trigger);

        const historyBtn = await screen.findByRole('button', { name: 'Ванпис' });
        fireEvent.click(historyBtn);

        const input = screen.getByRole('textbox') as HTMLInputElement;
        expect(input.value).toBe('Ванпис');
    });

    it('allows clearing all recent searches', async () => {
        localStorage.setItem('search_history', JSON.stringify(['Атака титанов']));

        renderSearchBar();

        const trigger = screen.getByRole('button', { name: /поиск/i });
        fireEvent.click(trigger);

        const clearBtn = await screen.findByRole('button', { name: /очистить историю/i });
        fireEvent.click(clearBtn);

        await waitFor(() => {
            expect(screen.queryByRole('button', { name: 'Атака титанов' })).not.toBeInTheDocument();
        });

        expect(localStorage.getItem('search_history')).toBeNull();
    });

    it('allows deleting a single item from recent searches', async () => {
        localStorage.setItem('search_history', JSON.stringify(['Хантер', 'Токийский гуль']));

        renderSearchBar();

        const trigger = screen.getByRole('button', { name: /поиск/i });
        fireEvent.click(trigger);

        const removeBtn = await screen.findByRole('button', { name: /Удалить Хантер/i });
        fireEvent.click(removeBtn);

        await waitFor(() => {
            expect(screen.queryByRole('button', { name: 'Хантер' })).not.toBeInTheDocument();
        });

        expect(screen.getByRole('button', { name: 'Токийский гуль' })).toBeInTheDocument();
        expect(JSON.parse(localStorage.getItem('search_history') || '[]')).toEqual(['Токийский гуль']);
    });

    it('opens search on Cmd+K or Ctrl+K shortcut', async () => {
        renderSearchBar();

        // Dispatch Cmd+K
        fireEvent.keyDown(window, { key: 'k', metaKey: true });

        await waitFor(() => {
            const input = screen.getByRole('textbox');
            expect(input).toBeInTheDocument();
        });
    });

    it('opens search on / shortcut when not focused on an input', async () => {
        renderSearchBar();

        fireEvent.keyDown(window, { key: '/' });

        await waitFor(() => {
            const input = screen.getByRole('textbox');
            expect(input).toBeInTheDocument();
        });
    });
});

describe('QoL: ScrollToTop Button', () => {
    it('appears when scroll position is past threshold and scrolls to top on click', async () => {
        const scrollToSpy = vi.fn();
        window.scrollTo = scrollToSpy;

        render(
            <MemoryRouter>
                <SettingsContext.Provider value={{ settings: defaultAppSettings, setSettings: vi.fn() }}>
                    <ScrollToTop />
                </SettingsContext.Provider>
            </MemoryRouter>
        );

        // Initially at top (scrollY = 0), not visible
        expect(screen.queryByRole('button', { name: /наверх/i })).not.toBeInTheDocument();

        // Simulate scroll past threshold
        Object.defineProperty(window, 'scrollY', { value: 500, configurable: true, writable: true });
        fireEvent.scroll(window);

        // Run animation frames
        await waitFor(() => {
            expect(screen.getByRole('button', { name: /наверх/i })).toBeInTheDocument();
        });

        // Click button
        const btn = screen.getByRole('button', { name: /наверх/i });
        fireEvent.click(btn);

        expect(scrollToSpy).toHaveBeenCalledWith({
            top: 0,
            behavior: 'smooth',
        });
    });
});
