import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FilterModal from '../../src/modals/FilterModal';
import { defaultAppSettings } from '../../src/shared/types/settings';
import type { Filter } from '../../src/shared/types/api';
import { renderWithProviders } from './helpers/testUtils';

const settings = { ...defaultAppSettings, appearance: { ...defaultAppSettings.appearance, language: 'english' as const } };

function renderFilter(filter: Filter = {}) {
    const setFilter = vi.fn();
    const onClose = vi.fn();
    const result = renderWithProviders(<FilterModal isOpen filter={filter} setFilter={setFilter} onClose={onClose} />, { settings });
    return { ...result, setFilter, onClose };
}

describe('filter draft editing and application', () => {
    it('retains sequential comma-separated genre typing, paste, edits and deletes until Apply', async () => {
        const user = userEvent.setup();
        const { setFilter, onClose } = renderFilter();
        const genres = screen.getByRole('textbox', { name: /^Genres/ });
        await user.type(genres, 'action, fantasy');
        expect(genres).toHaveValue('action, fantasy');
        expect(setFilter).not.toHaveBeenCalled();
        await user.keyboard('{End}{Backspace}');
        expect(genres).toHaveValue('action, fantas');
        await user.type(genres, 'y');
        await user.paste(', action, ,  Mystery ');
        expect(genres).toHaveValue('action, fantasy, action, ,  Mystery ');
        await user.click(screen.getByRole('button', { name: 'Apply' }));
        expect(setFilter).toHaveBeenCalledExactlyOnceWith({ genres: ['action', 'fantasy', 'Mystery'] });
        expect(onClose).toHaveBeenCalledOnce();
    });

    it('keeps advanced fields collapsed initially and parses dub types only on Apply', async () => {
        const user = userEvent.setup();
        const { setFilter } = renderFilter();
        const more = screen.getByText('More filters', { selector: 'summary' });
        expect(more.closest('details')).not.toHaveAttribute('open');
        expect(screen.getByLabelText('Studio')).not.toBeVisible();
        await user.click(more);
        expect(screen.getByLabelText('Studio')).toBeVisible();
        const dubs = screen.getByRole('textbox', { name: /^Dub types/ });
        await user.type(dubs, 'Anilibria, AniDUB, Anilibria, ');
        expect(dubs).toHaveValue('Anilibria, AniDUB, Anilibria, ');
        expect(setFilter).not.toHaveBeenCalled();
        await user.click(screen.getByRole('button', { name: 'Apply' }));
        expect(setFilter).toHaveBeenCalledExactlyOnceWith({ types: ['Anilibria', 'AniDUB'] });
    });

    it.each([
        ['Year: from', 'Year: to', '2025', '2020', false],
        ['Episodes: from', 'Episodes: to', '24', '12', true],
        ['Duration: from (min.)', 'Duration: to (min.)', '30', '20', true],
    ] as const)('blocks an inverted %s range with associated inline feedback and focus', async (fromLabel, toLabel, fromValue, toValue, advanced) => {
        const user = userEvent.setup();
        const { setFilter, onClose } = renderFilter();
        if (advanced) await user.click(screen.getByText('More filters', { selector: 'summary' }));
        const from = screen.getByRole('spinbutton', { name: fromLabel });
        const to = screen.getByRole('spinbutton', { name: toLabel });
        await user.type(from, fromValue);
        await user.type(to, toValue);
        await user.click(screen.getByRole('button', { name: 'Apply' }));
        const error = screen.getByRole('alert');
        expect(error).toHaveTextContent('The minimum must not exceed the maximum.');
        expect(from).toHaveAttribute('aria-invalid', 'true');
        expect(to).toHaveAttribute('aria-invalid', 'true');
        expect(from).toHaveAttribute('aria-describedby', error.id);
        await waitFor(() => expect(from).toHaveFocus());
        expect(setFilter).not.toHaveBeenCalled();
        expect(onClose).not.toHaveBeenCalled();
        await user.clear(to);
        await user.type(to, fromValue);
        await user.click(screen.getByRole('button', { name: 'Apply' }));
        expect(setFilter).toHaveBeenCalledOnce();
        expect(onClose).toHaveBeenCalledOnce();
    });

    it('closes without applying a draft and reopens with the last applied values', async () => {
        const user = userEvent.setup();
        const filter = { genres: ['action'], types: ['Original'], studio: 'Existing studio' };
        const { setFilter, onClose, rerender } = renderFilter(filter);
        expect(screen.getByText('More filters', { selector: 'summary' }).closest('details')).toHaveAttribute('open');
        await user.type(screen.getByRole('textbox', { name: /^Genres/ }), ', fantasy');
        await user.clear(screen.getByLabelText('Studio'));
        await user.click(screen.getByRole('button', { name: 'Close' }));
        await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
        expect(setFilter).not.toHaveBeenCalled();
        rerender(<FilterModal isOpen={false} filter={filter} setFilter={setFilter} onClose={onClose} />);
        rerender(<FilterModal isOpen filter={filter} setFilter={setFilter} onClose={onClose} />);
        expect(screen.getByRole('textbox', { name: /^Genres/ })).toHaveValue('action');
        expect(screen.getByLabelText('Studio')).toHaveValue('Existing studio');
    });

    it('reopens advanced filters before focusing an invalid field hidden by a collapsed section', async () => {
        const user = userEvent.setup();
        const { setFilter, onClose } = renderFilter();
        const more = screen.getByText('More filters', { selector: 'summary' });
        await user.click(more);
        const from = screen.getByRole('spinbutton', { name: 'Episodes: from' });
        await user.type(from, '24');
        await user.type(screen.getByRole('spinbutton', { name: 'Episodes: to' }), '12');
        await user.click(more);
        expect(more.closest('details')).not.toHaveAttribute('open');
        expect(from).not.toBeVisible();
        await user.click(screen.getByRole('button', { name: 'Apply' }));
        await waitFor(() => expect(from).toHaveFocus());
        expect(more.closest('details')).toHaveAttribute('open');
        expect(from).toBeVisible();
        expect(from).toHaveAttribute('aria-invalid', 'true');
        expect(screen.getByRole('alert')).toHaveTextContent('The minimum must not exceed the maximum.');
        expect(setFilter).not.toHaveBeenCalled();
        expect(onClose).not.toHaveBeenCalled();
    });

    it('Reset clears only the draft until Apply submits the cleared filter', async () => {
        const user = userEvent.setup();
        const { setFilter, onClose } = renderFilter({ genres: ['action'], types: ['Original'], start_year: 2020, studio: 'Studio', status_id: 2 });
        await user.click(screen.getByRole('button', { name: 'Reset' }));
        expect(screen.getByRole('textbox', { name: /^Genres/ })).toHaveValue('');
        expect(screen.getByRole('textbox', { name: /^Dub types/ })).toHaveValue('');
        expect(screen.getByRole('spinbutton', { name: 'Year: from' })).toHaveValue(null);
        expect(screen.getByLabelText('Studio')).toHaveValue('');
        expect(screen.getByRole('combobox', { name: 'Status' })).toHaveValue('');
        expect(setFilter).not.toHaveBeenCalled();
        expect(onClose).not.toHaveBeenCalled();
        await user.click(screen.getByRole('button', { name: 'Apply' }));
        expect(setFilter).toHaveBeenCalledExactlyOnceWith({});
        expect(onClose).toHaveBeenCalledOnce();
    });
});
