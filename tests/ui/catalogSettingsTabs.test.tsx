import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import HomepageScreen from '../../src/pages/HomepageScreen';
import SettingsScreen from '../../src/pages/SettingsScreen';
import { defaultAppSettings } from '../../src/shared/types/settings';
import { renderWithProviders } from './helpers/testUtils';

const { saveAccountSettings } = vi.hoisted(() => ({ saveAccountSettings: vi.fn() }));
vi.mock('../../src/shared/cloudSettings', async importOriginal => ({
    ...await importOriginal<typeof import('../../src/shared/cloudSettings')>(),
    saveAccountSettings,
}));
const settings = { ...defaultAppSettings, appearance: { ...defaultAppSettings.appearance, language: 'english' as const } };

beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => JSON.stringify({ code: 0, content: [] }) }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('catalog and settings tab accessibility', () => {
    it('uses vertical arrows on the desktop catalog and retains Alt+Arrow reordering', async () => {
        const user = userEvent.setup();
        renderWithProviders(<HomepageScreen />, { settings });
        const list = screen.getByRole('tablist');
        expect(list).toHaveAttribute('aria-orientation', 'vertical');
        const tabs = within(list).getAllByRole('tab');
        const active = tabs.find(tab => tab.getAttribute('aria-selected') === 'true')!;
        expect(tabs.filter(tab => tab.tabIndex === 0)).toEqual([active]);
        active.focus();
        await user.keyboard('{End}');
        expect(tabs.at(-1)).toHaveFocus();
        await user.keyboard('{Home}{ArrowDown}');
        expect(tabs[1]).toHaveFocus();
        const panel = screen.getByRole('tabpanel');
        expect(panel).toHaveAttribute('aria-labelledby', tabs[1].id);
        expect(tabs[1]).toHaveAttribute('aria-controls', panel.id);
        await user.keyboard('{Alt>}{ArrowUp}{/Alt}');
        expect(within(list).getAllByRole('tab')[0]).toBe(tabs[1]);
        expect(tabs[1]).toHaveAttribute('aria-selected', 'true');
    });

    it('uses horizontal arrows on the mobile catalog', async () => {
        vi.spyOn(window, 'matchMedia').mockImplementation(query => ({ matches: query === '(max-width: 900px)', media: query, onchange: null,
            addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn() }));
        const user = userEvent.setup();
        renderWithProviders(<HomepageScreen />, { settings });
        expect(screen.getByRole('tablist')).toHaveAttribute('aria-orientation', 'horizontal');
        const tabs = screen.getAllByRole('tab');
        tabs[0].focus();
        await user.keyboard('{ArrowRight}');
        expect(tabs[1]).toHaveFocus();
        await user.keyboard('{ArrowDown}');
        expect(tabs[1]).toHaveFocus();
    });

    it('selects settings tabs with arrows/Home/End and links the visible panel', async () => {
        const user = userEvent.setup();
        renderWithProviders(<SettingsScreen />, { settings });
        const tabs = screen.getAllByRole('tab');
        tabs[0].focus();
        await user.keyboard('{ArrowRight}');
        expect(tabs[1]).toHaveFocus();
        expect(tabs[1]).toHaveAttribute('aria-selected', 'true');
        expect(tabs[0]).toHaveAttribute('tabindex', '-1');
        expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', tabs[1].id);
        await user.keyboard('{End}');
        expect(tabs[3]).toHaveFocus();
        expect(tabs[3]).toHaveAttribute('aria-controls', screen.getByRole('tabpanel').id);
        await user.keyboard('{Home}');
        expect(tabs[0]).toHaveFocus();
    });

    it('announces settings save success politely and failures as alerts', async () => {
        const user = userEvent.setup();
        saveAccountSettings.mockResolvedValueOnce({ serverSaved: false }).mockRejectedValueOnce(new Error('offline'));
        renderWithProviders(<SettingsScreen />, { settings, userToken: 'test', userId: 1 });
        await user.click(screen.getAllByRole('tab')[3]);
        const saveButton = screen.getByRole('button', { name: /save.*account/i });
        await user.click(saveButton);
        expect(await screen.findByRole('status')).not.toBeEmptyDOMElement();
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        await user.click(saveButton);
        expect(await screen.findByRole('alert')).not.toBeEmptyDOMElement();
        expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });
});
