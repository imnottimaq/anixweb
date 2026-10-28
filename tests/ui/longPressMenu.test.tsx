import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, render, act } from '@testing-library/react';
import { MemoryRouter, Link } from 'react-router-dom';
import ReleaseActionsProvider from '../../src/components/ReleaseContextMenu';
import { UserContext } from '../../src/shared/contexts/userContext';
import { SettingsContext } from '../../src/shared/contexts/settingsContext';
import { SearchContext } from '../../src/shared/contexts/searchContext';
import { defaultAppSettings } from '../../src/shared/types/settings';
import HomepageScreen from '../../src/pages/HomepageScreen';
import FavoritesScreen from '../../src/pages/FavoritesScreen';

describe('Long-Press Context Menu', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            text: async () => JSON.stringify({ code: 0, content: [] }),
            json: async () => ({ code: 0, content: [] }),
        }));
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('opens release context menu on 500ms touch hold and suppresses subsequent click', () => {
        let clicked = false;
        render(
            <MemoryRouter>
                <UserContext.Provider value={{ userToken: 'test-token', userId: 1, setUserToken: vi.fn(), setUserId: vi.fn() }}>
                    <SettingsContext.Provider value={{ settings: defaultAppSettings, setSettings: vi.fn() }}>
                        <ReleaseActionsProvider>
                            <Link
                                to="/anime/42"
                                data-release-list-status="1"
                                data-release-favorite="false"
                                onClick={() => { clicked = true; }}
                            >
                                <img src="/test.jpg" alt="Attack on Titan" />
                                <span>Attack on Titan</span>
                            </Link>
                        </ReleaseActionsProvider>
                    </SettingsContext.Provider>
                </UserContext.Provider>
            </MemoryRouter>
        );

        const card = screen.getByRole('link', { name: /attack on titan/i });

        // Touch start at (100, 150)
        fireEvent.touchStart(card, {
            touches: [{ clientX: 100, clientY: 150 }],
        });

        // Advance 200ms - menu should not be open yet
        act(() => {
            vi.advanceTimersByTime(200);
        });
        expect(screen.queryByRole('menu')).not.toBeInTheDocument();

        // Advance remaining 300ms (total 500ms)
        act(() => {
            vi.advanceTimersByTime(300);
        });

        // Context menu should now be visible!
        const menu = screen.getByRole('menu', { name: /действие с релизом|действия с релизом|release actions/i });
        expect(menu).toBeInTheDocument();

        // Finger lifts - touchend and synthetic click
        fireEvent.touchEnd(card);
        fireEvent.click(card);

        // The click should have been suppressed!
        expect(clicked).toBe(false);
    });

    it('cancels long press if touch moves more than 10px (user is scrolling)', () => {
        let clicked = false;
        render(
            <MemoryRouter>
                <UserContext.Provider value={{ userToken: 'test-token', userId: 1, setUserToken: vi.fn(), setUserId: vi.fn() }}>
                    <SettingsContext.Provider value={{ settings: defaultAppSettings, setSettings: vi.fn() }}>
                        <ReleaseActionsProvider>
                            <Link
                                to="/anime/42"
                                data-release-list-status="1"
                                data-release-favorite="false"
                                onClick={() => { clicked = true; }}
                            >
                                <span>Attack on Titan</span>
                            </Link>
                        </ReleaseActionsProvider>
                    </SettingsContext.Provider>
                </UserContext.Provider>
            </MemoryRouter>
        );

        const card = screen.getByRole('link', { name: /attack on titan/i });

        // Touch start at (100, 100)
        fireEvent.touchStart(card, {
            touches: [{ clientX: 100, clientY: 100 }],
        });

        // Touch moves 15px vertically (scroll gesture)
        fireEvent.touchMove(card, {
            touches: [{ clientX: 100, clientY: 115 }],
        });

        // Advance beyond 500ms
        act(() => {
            vi.advanceTimersByTime(600);
        });

        // Menu should NOT open
        expect(screen.queryByRole('menu')).not.toBeInTheDocument();

        // Finger lifts and clicks normally
        fireEvent.touchEnd(card);
        fireEvent.click(card);
        expect(clicked).toBe(true);
    });

    it('cancels long press if finger is lifted before 500ms (normal tap)', () => {
        let clicked = false;
        render(
            <MemoryRouter>
                <UserContext.Provider value={{ userToken: 'test-token', userId: 1, setUserToken: vi.fn(), setUserId: vi.fn() }}>
                    <SettingsContext.Provider value={{ settings: defaultAppSettings, setSettings: vi.fn() }}>
                        <ReleaseActionsProvider>
                            <Link
                                to="/anime/42"
                                data-release-list-status="1"
                                data-release-favorite="false"
                                onClick={() => { clicked = true; }}
                            >
                                <span>Attack on Titan</span>
                            </Link>
                        </ReleaseActionsProvider>
                    </SettingsContext.Provider>
                </UserContext.Provider>
            </MemoryRouter>
        );

        const card = screen.getByRole('link', { name: /attack on titan/i });

        // Touch start at (100, 100)
        fireEvent.touchStart(card, {
            touches: [{ clientX: 100, clientY: 100 }],
        });

        // Lift after 150ms
        act(() => {
            vi.advanceTimersByTime(150);
        });
        fireEvent.touchEnd(card);

        // Advance past 500ms
        act(() => {
            vi.advanceTimersByTime(500);
        });

        // Menu should not open
        expect(screen.queryByRole('menu')).not.toBeInTheDocument();

        // Normal tap click goes through
        fireEvent.click(card);
        expect(clicked).toBe(true);
    });

    it('does not trigger long press on non-release elements', () => {
        render(
            <MemoryRouter>
                <UserContext.Provider value={{ userToken: 'test-token', userId: 1, setUserToken: vi.fn(), setUserId: vi.fn() }}>
                    <SettingsContext.Provider value={{ settings: defaultAppSettings, setSettings: vi.fn() }}>
                        <ReleaseActionsProvider>
                            <Link to="/about">
                                <span>About Us</span>
                            </Link>
                            <button type="button">Regular Button</button>
                        </ReleaseActionsProvider>
                    </SettingsContext.Provider>
                </UserContext.Provider>
            </MemoryRouter>
        );

        const aboutLink = screen.getByRole('link', { name: /about us/i });
        fireEvent.touchStart(aboutLink, { touches: [{ clientX: 50, clientY: 50 }] });
        act(() => {
            vi.advanceTimersByTime(600);
        });
        expect(screen.queryByRole('menu')).not.toBeInTheDocument();

        const button = screen.getByRole('button', { name: /regular button/i });
        fireEvent.touchStart(button, { touches: [{ clientX: 50, clientY: 50 }] });
        act(() => {
            vi.advanceTimersByTime(600);
        });
        expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });

    it('opens tab context menu on 500ms touch hold on tabs in HomepageScreen', async () => {
        render(
            <MemoryRouter>
                <SettingsContext.Provider value={{ settings: defaultAppSettings, setSettings: vi.fn() }}>
                    <UserContext.Provider value={{ userToken: 'test-token', userId: 1, setUserToken: vi.fn(), setUserId: vi.fn() }}>
                        <SearchContext.Provider value={{ searchScope: { type: 'releases' }, setSearchScope: vi.fn() }}>
                            <HomepageScreen />
                        </SearchContext.Provider>
                    </UserContext.Provider>
                </SettingsContext.Provider>
            </MemoryRouter>
        );

        const ongoingTab = screen.getByRole('tab', { name: /онгоинг/i });

        // Touch hold on the ongoing tab
        act(() => {
            fireEvent.touchStart(ongoingTab, {
                touches: [{ clientX: 120, clientY: 80 }],
            });
        });

        // 200ms - not yet
        act(() => {
            vi.advanceTimersByTime(200);
        });
        expect(screen.queryByRole('menu')).not.toBeInTheDocument();

        // Reach 500ms
        act(() => {
            vi.advanceTimersByTime(300);
        });

        // Tab menu should open!
        const menu = screen.getByRole('menu');
        expect(menu).toBeInTheDocument();
        expect(screen.getByRole('menuitem', { name: 'Сделать вкладкой по умолчанию' })).toBeInTheDocument();

        // Release finger and verify click is swallowed
        act(() => {
            fireEvent.touchEnd(ongoingTab);
            fireEvent.click(ongoingTab);
        });

        // Menu is still open
        expect(menu).toBeInTheDocument();
    });

    it('opens tab context menu on 500ms touch hold on tabs in FavoritesScreen and ignores when viewing external profile', async () => {
        const { unmount } = render(
            <MemoryRouter>
                <SettingsContext.Provider value={{ settings: defaultAppSettings, setSettings: vi.fn() }}>
                    <UserContext.Provider value={{ userToken: 'test-token', userId: 1, setUserToken: vi.fn(), setUserId: vi.fn() }}>
                        <SearchContext.Provider value={{ searchScope: { type: 'releases' }, setSearchScope: vi.fn() }}>
                            <FavoritesScreen />
                        </SearchContext.Provider>
                    </UserContext.Provider>
                </SettingsContext.Provider>
            </MemoryRouter>
        );

        const plannedTab = screen.getByRole('tab', { name: /в планах/i });

        act(() => {
            fireEvent.touchStart(plannedTab, {
                touches: [{ clientX: 150, clientY: 90 }],
            });
        });

        act(() => {
            vi.advanceTimersByTime(500);
        });

        const menu = screen.getByRole('menu');
        expect(menu).toBeInTheDocument();
        expect(screen.getByRole('menuitem', { name: 'Сделать вкладкой по умолчанию' })).toBeInTheDocument();

        unmount();
    });
});
