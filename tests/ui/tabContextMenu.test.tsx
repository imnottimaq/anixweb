import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, render, act, within } from '@testing-library/react';
import type { Dispatch, ReactNode, SetStateAction } from 'react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import TabContextMenu, { type TabContextMenuItem } from '../../src/components/TabContextMenu';
import HomepageScreen from '../../src/pages/HomepageScreen';
import FavoritesScreen from '../../src/pages/FavoritesScreen';
import { SettingsContext } from '../../src/shared/contexts/settingsContext';
import { UserContext } from '../../src/shared/contexts/userContext';
import { SearchContext, type SearchScope } from '../../src/shared/contexts/searchContext';
import { defaultAppSettings, type AppSettings } from '../../src/shared/types/settings';
import { dictionaries } from '../../src/shared/i18n';

function Providers({
    children,
    settings = defaultAppSettings,
    setSettings = vi.fn(),
    userToken = '',
    userId = 0,
    searchScope = { type: 'releases' as const },
    setSearchScope = vi.fn(),
}: {
    children: ReactNode;
    settings?: AppSettings;
    setSettings?: Dispatch<SetStateAction<AppSettings>>;
    userToken?: string;
    userId?: number;
    searchScope?: SearchScope;
    setSearchScope?: Dispatch<SetStateAction<SearchScope>>;
}) {
    return (
        <MemoryRouter>
            <SettingsContext.Provider value={{ settings, setSettings }}>
                <UserContext.Provider value={{ userToken, userId, setUserToken: vi.fn(), setUserId: vi.fn() }}>
                    <SearchContext.Provider value={{ searchScope, setSearchScope }}>
                        {children}
                    </SearchContext.Provider>
                </UserContext.Provider>
            </SettingsContext.Provider>
        </MemoryRouter>
    );
}

describe('TabContextMenu Component', () => {
    beforeEach(() => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            text: async () => JSON.stringify({ code: 0, content: [] }),
            json: async () => ({ code: 0, content: [] }),
        }));
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('renders menu items and title in a portal', () => {
        const onClose = vi.fn();
        const items: TabContextMenuItem[] = [
            { key: 'opt1', label: 'Option 1', onClick: vi.fn() },
            { key: 'opt2', label: 'Option 2', onClick: vi.fn(), disabled: true },
        ];

        render(
            <Providers>
                <TabContextMenu
                    x={100}
                    y={150}
                    trigger={null}
                    title="Menu Title"
                    items={items}
                    onClose={onClose}
                />
            </Providers>
        );

        const menu = screen.getByRole('menu');
        expect(menu).toBeInTheDocument();
        expect(screen.getByText('Menu Title')).toBeInTheDocument();
        expect(screen.getByRole('menuitem', { name: 'Option 1' })).toBeEnabled();
        expect(screen.getByRole('menuitem', { name: 'Option 2' })).toBeDisabled();
    });

    it('focuses first enabled menu item on open', () => {
        const items: TabContextMenuItem[] = [
            { key: 'disabled-first', label: 'First Disabled', onClick: vi.fn(), disabled: true },
            { key: 'enabled-second', label: 'Second Enabled', onClick: vi.fn() },
        ];

        render(
            <Providers>
                <TabContextMenu
                    x={50}
                    y={50}
                    trigger={null}
                    items={items}
                    onClose={vi.fn()}
                />
            </Providers>
        );

        const secondItem = screen.getByRole('menuitem', { name: 'Second Enabled' });
        expect(document.activeElement).toBe(secondItem);
    });

    it('handles keyboard navigation (ArrowDown, ArrowUp, Home, End)', () => {
        const items: TabContextMenuItem[] = [
            { key: 'item-1', label: 'Item 1', onClick: vi.fn() },
            { key: 'item-2', label: 'Item 2', onClick: vi.fn() },
            { key: 'item-3', label: 'Item 3', onClick: vi.fn() },
        ];

        render(
            <Providers>
                <TabContextMenu
                    x={50}
                    y={50}
                    trigger={null}
                    items={items}
                    onClose={vi.fn()}
                />
            </Providers>
        );

        const item1 = screen.getByRole('menuitem', { name: 'Item 1' });
        const item2 = screen.getByRole('menuitem', { name: 'Item 2' });
        const item3 = screen.getByRole('menuitem', { name: 'Item 3' });

        expect(document.activeElement).toBe(item1);

        // ArrowDown -> item2
        fireEvent.keyDown(item1, { key: 'ArrowDown' });
        expect(document.activeElement).toBe(item2);

        // ArrowDown -> item3
        fireEvent.keyDown(item2, { key: 'ArrowDown' });
        expect(document.activeElement).toBe(item3);

        // ArrowDown -> wraps to item1
        fireEvent.keyDown(item3, { key: 'ArrowDown' });
        expect(document.activeElement).toBe(item1);

        // ArrowUp -> wraps backwards to item3
        fireEvent.keyDown(item1, { key: 'ArrowUp' });
        expect(document.activeElement).toBe(item3);

        // Home -> item1
        fireEvent.keyDown(item3, { key: 'Home' });
        expect(document.activeElement).toBe(item1);

        // End -> item3
        fireEvent.keyDown(item1, { key: 'End' });
        expect(document.activeElement).toBe(item3);
    });

    it('closes on Escape and restores focus to trigger button', () => {
        const trigger = document.createElement('button');
        document.body.appendChild(trigger);
        trigger.focus();

        const onClose = vi.fn();
        const items: TabContextMenuItem[] = [
            { key: 'action', label: 'Action', onClick: vi.fn() },
        ];

        render(
            <Providers>
                <TabContextMenu
                    x={50}
                    y={50}
                    trigger={trigger}
                    items={items}
                    onClose={onClose}
                />
            </Providers>
        );

        const menu = screen.getByRole('menu');
        fireEvent.keyDown(menu, { key: 'Escape' });

        expect(onClose).toHaveBeenCalledOnce();
        expect(document.activeElement).toBe(trigger);

        trigger.remove();
    });

    it('executes item onClick and closes menu on item click', () => {
        const onClick = vi.fn();
        const onClose = vi.fn();
        const trigger = document.createElement('button');
        document.body.appendChild(trigger);

        const items: TabContextMenuItem[] = [
            { key: 'select', label: 'Select Me', onClick },
        ];

        render(
            <Providers>
                <TabContextMenu
                    x={50}
                    y={50}
                    trigger={trigger}
                    items={items}
                    onClose={onClose}
                />
            </Providers>
        );

        fireEvent.click(screen.getByRole('menuitem', { name: 'Select Me' }));
        expect(onClick).toHaveBeenCalledOnce();
        expect(onClose).toHaveBeenCalledOnce();
        expect(document.activeElement).toBe(trigger);

        trigger.remove();
    });

    it('does not restore focus to trigger when restoreFocusOnSelect is false', () => {
        const trigger = document.createElement('button');
        const otherInput = document.createElement('input');
        document.body.appendChild(trigger);
        document.body.appendChild(otherInput);

        const onClick = vi.fn(() => otherInput.focus());
        const onClose = vi.fn();

        const items: TabContextMenuItem[] = [
            { key: 'modal-opener', label: 'Open Modal', onClick, restoreFocusOnSelect: false },
        ];

        render(
            <Providers>
                <TabContextMenu
                    x={50}
                    y={50}
                    trigger={trigger}
                    items={items}
                    onClose={onClose}
                />
            </Providers>
        );

        fireEvent.click(screen.getByRole('menuitem', { name: 'Open Modal' }));
        expect(onClick).toHaveBeenCalledOnce();
        expect(onClose).toHaveBeenCalledOnce();
        // Since restoreFocusOnSelect is false, trigger is not refocused, so otherInput keeps focus
        expect(document.activeElement).toBe(otherInput);

        trigger.remove();
        otherInput.remove();
    });

    it('closes on outside pointerdown', () => {
        const onClose = vi.fn();
        render(
            <Providers>
                <div>Outside Content</div>
                <TabContextMenu
                    x={50}
                    y={50}
                    trigger={null}
                    items={[{ key: '1', label: 'Item', onClick: vi.fn() }]}
                    onClose={onClose}
                />
            </Providers>
        );

        fireEvent.pointerDown(document.body);
        expect(onClose).toHaveBeenCalledOnce();
    });
});

describe('HomepageScreen Tab Context Menu & Defaults', () => {
    beforeEach(() => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            text: async () => JSON.stringify({ code: 0, content: [] }),
            json: async () => ({ code: 0, content: [] }),
        }));
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('initializes with default tab specified in settings.content.defaultTabOnHome', async () => {
        const customSettings: AppSettings = {
            ...defaultAppSettings,
            content: {
                ...defaultAppSettings.content,
                defaultTabOnHome: 'ongoing',
            },
        };

        render(
            <Providers settings={customSettings}>
                <HomepageScreen />
            </Providers>
        );
        await act(async () => {});

        const ongoingTab = screen.getByRole('tab', { name: 'Онгоинг' });
        expect(ongoingTab).toHaveAttribute('aria-selected', 'true');
    });

    it('opens context menu on tab right-click with tab name title and make-default option', async () => {
        const setSettings = vi.fn();
        render(
            <Providers setSettings={setSettings}>
                <HomepageScreen />
            </Providers>
        );
        await act(async () => {});

        const ongoingTab = screen.getByRole('tab', { name: 'Онгоинг' });
        fireEvent.contextMenu(ongoingTab, { clientX: 120, clientY: 200 });

        const menu = screen.getByRole('menu');
        expect(menu).toBeInTheDocument();
        expect(within(menu).getByText('Онгоинг')).toBeInTheDocument();

        const makeDefaultButton = screen.getByRole('menuitem', { name: 'Сделать вкладкой по умолчанию' });
        expect(makeDefaultButton).toBeEnabled();

        fireEvent.click(makeDefaultButton);
        expect(setSettings).toHaveBeenCalledOnce();

        // Verify it updates defaultTabOnHome to 'ongoing' while preserving other content settings
        const updater = setSettings.mock.calls[0][0];
        const updated = updater(defaultAppSettings);
        expect(updated.content.defaultTabOnHome).toBe('ongoing');
        expect(updated.content.defaultTabOnFavorites).toBe(defaultAppSettings.content.defaultTabOnFavorites);
    });

    it('shows disabled "Вкладка по умолчанию" for the current default home tab', async () => {
        render(
            <Providers>
                <HomepageScreen />
            </Providers>
        );
        await act(async () => {});

        // defaultAppSettings.content.defaultTabOnHome is 'latest' ('Последнее')
        const latestTab = screen.getByRole('tab', { name: 'Последнее' });
        fireEvent.contextMenu(latestTab, { clientX: 100, clientY: 100 });

        const isDefaultButton = screen.getByRole('menuitem', { name: 'Вкладка по умолчанию' });
        expect(isDefaultButton).toBeDisabled();
    });

    it('opens FilterModal when "Изменить фильтры" is clicked in My Tab context menu', async () => {
        render(
            <Providers>
                <HomepageScreen />
            </Providers>
        );
        await act(async () => {});

        const myTab = screen.getByRole('tab', { name: 'Моя вкладка' });
        fireEvent.contextMenu(myTab, { clientX: 100, clientY: 100 });

        const changeFiltersButton = screen.getByRole('menuitem', { name: 'Изменить фильтры' });
        expect(changeFiltersButton).toBeInTheDocument();

        fireEvent.click(changeFiltersButton);

        // FilterModal should now be open
        expect(screen.getByRole('dialog', { name: 'Фильтры' })).toBeInTheDocument();
    });

    it('opens context menu via keyboard ContextMenu or Shift+F10 key', async () => {
        render(
            <Providers>
                <HomepageScreen />
            </Providers>
        );
        await act(async () => {});

        const filmsTab = screen.getByRole('tab', { name: 'Фильмы' });
        fireEvent.keyDown(filmsTab, { key: 'ContextMenu' });

        const menu = screen.getByRole('menu');
        expect(menu).toBeInTheDocument();
        expect(within(menu).getByText('Фильмы')).toBeInTheDocument();
    });
});

describe('FavoritesScreen Tab Context Menu & Independent Defaults', () => {
    beforeEach(() => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            text: async () => JSON.stringify({ code: 0, content: [] }),
            json: async () => ({ code: 0, content: [] }),
        }));
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('initializes with default tab specified in settings.content.defaultTabOnFavorites', () => {
        const customSettings: AppSettings = {
            ...defaultAppSettings,
            content: {
                ...defaultAppSettings.content,
                defaultTabOnFavorites: 'watching',
            },
        };

        render(
            <Providers settings={customSettings}>
                <FavoritesScreen />
            </Providers>
        );

        const watchingTab = screen.getByRole('tab', { name: 'Смотрю' });
        expect(watchingTab).toHaveAttribute('aria-selected', 'true');
    });

    it('opens context menu on Favorites tab right-click and updates defaultTabOnFavorites independently', () => {
        const setSettings = vi.fn();
        render(
            <Providers setSettings={setSettings}>
                <FavoritesScreen />
            </Providers>
        );

        const plannedTab = screen.getByRole('tab', { name: 'В планах' });
        fireEvent.contextMenu(plannedTab, { clientX: 100, clientY: 150 });

        const menu = screen.getByRole('menu');
        expect(menu).toBeInTheDocument();
        expect(within(menu).getByText('В планах')).toBeInTheDocument();

        const makeDefaultButton = screen.getByRole('menuitem', { name: 'Сделать вкладкой по умолчанию' });
        expect(makeDefaultButton).toBeEnabled();

        fireEvent.click(makeDefaultButton);
        expect(setSettings).toHaveBeenCalledOnce();

        const updater = setSettings.mock.calls[0][0];
        const updated = updater(defaultAppSettings);
        expect(updated.content.defaultTabOnFavorites).toBe('planned');
        // defaultTabOnHome MUST remain untouched
        expect(updated.content.defaultTabOnHome).toBe(defaultAppSettings.content.defaultTabOnHome);
    });

    it('shows disabled "Вкладка по умолчанию" when the tab is already default in Favorites', () => {
        render(
            <Providers>
                <FavoritesScreen />
            </Providers>
        );

        // Default tab on favorites is 'favorites' ('Избранное')
        const favoritesTab = screen.getByRole('tab', { name: 'Избранное' });
        fireEvent.contextMenu(favoritesTab, { clientX: 100, clientY: 150 });

        const isDefaultButton = screen.getByRole('menuitem', { name: 'Вкладка по умолчанию' });
        expect(isDefaultButton).toBeDisabled();
    });

    it('does not open context menu when right clicking tabs on an external profile', async () => {
        render(
            <MemoryRouter initialEntries={['/profile/123/favorites']}>
                <SettingsContext.Provider value={{ settings: defaultAppSettings, setSettings: vi.fn() }}>
                    <UserContext.Provider value={{ userToken: '', userId: 0, setUserToken: vi.fn(), setUserId: vi.fn() }}>
                        <SearchContext.Provider value={{ searchScope: { type: 'releases' }, setSearchScope: vi.fn() }}>
                            <Routes>
                                <Route path="/profile/:profileId/favorites" element={<FavoritesScreen />} />
                            </Routes>
                        </SearchContext.Provider>
                    </UserContext.Provider>
                </SettingsContext.Provider>
            </MemoryRouter>
        );
        await act(async () => {});

        const watchingTab = screen.getByRole('tab', { name: 'Смотрю' });
        expect(watchingTab).not.toHaveAttribute('aria-haspopup');
        fireEvent.contextMenu(watchingTab, { clientX: 100, clientY: 150 });
        expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });
});

describe('Tab Menu Localization', () => {
    it('has non-empty translations for all tab menu keys in Russian and English', () => {
        const requiredKeys = [
            'tabMenu.title',
            'tabMenu.makeDefault',
            'tabMenu.isDefault',
            'tabMenu.changeFilters',
        ] as const;

        for (const key of requiredKeys) {
            expect(dictionaries.russian[key]).toBeDefined();
            expect(dictionaries.russian[key].length).toBeGreaterThan(0);
            expect(dictionaries.english[key]).toBeDefined();
            expect(dictionaries.english[key].length).toBeGreaterThan(0);
        }

        // Verify distinct values for English
        expect(dictionaries.english['tabMenu.makeDefault']).toBe('Make this tab default');
        expect(dictionaries.english['tabMenu.isDefault']).toBe('Default tab');
        expect(dictionaries.english['tabMenu.changeFilters']).toBe('Change filters');
    });
});
