import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { MemoryRouter } from 'react-router-dom';
import NotificationSettingsScreen from '../../src/pages/NotificationSettingsScreen';
import { SettingsContext } from '../../src/shared/contexts/settingsContext';
import { defaultAppSettings, type AppSettings } from '../../src/shared/types/settings';
import { createDeferred } from './helpers/deferred';

const { get, post, api } = vi.hoisted(() => {
    const get = vi.fn(); const post = vi.fn();
    return { get, post, api: { get, post } };
});
vi.mock('../../src/shared/apiClient', () => ({ useApi: () => api }));

const preferences = {
    code: 0,
    profileStatusNotificationPreferences: [],
    profileTypeNotificationPreferences: [],
    is_release_type_notifications_enabled: false,
    is_episode_notifications_enabled: true,
    is_first_episode_notification_enabled: false,
    is_related_release_notifications_enabled: false,
    is_comment_notifications_enabled: false,
    is_my_collection_comment_notifications_enabled: false,
};

function setup() {
    function Harness() {
        const [settings, setSettings] = useState<AppSettings>({
            ...defaultAppSettings,
            appearance: { ...defaultAppSettings.appearance, language: 'english' as const },
            notifications: { ...defaultAppSettings.notifications, recieveNotifications: true },
        });
        return <MemoryRouter><SettingsContext.Provider value={{ settings, setSettings }}>
            <NotificationSettingsScreen />
        </SettingsContext.Provider></MemoryRouter>;
    }
    return render(<Harness />);
}

beforeEach(() => { vi.resetAllMocks(); post.mockResolvedValue({ code: 0 }); });

describe('notification preference recovery', () => {
    it('disables cached controls through load failure and enables them only after explicit successful retry', async () => {
        const pending = createDeferred<typeof preferences>();
        get.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(preferences);
        const user = userEvent.setup(); setup();
        expect(screen.getAllByRole('checkbox').every(control => control.hasAttribute('disabled'))).toBe(true);
        pending.reject(new Error('Offline'));
        expect(await screen.findByRole('alert')).toHaveTextContent('Notification preferences could not be loaded.');
        expect(screen.getByText('Showing preferences cached on this device.')).toBeVisible();
        expect(screen.getAllByRole('checkbox').every(control => control.hasAttribute('disabled'))).toBe(true);
        await user.click(screen.getByRole('button', { name: 'Try again' }));
        await waitFor(() => expect(screen.getAllByRole('checkbox').every(control => !control.hasAttribute('disabled'))).toBe(true));
        expect(get).toHaveBeenCalledTimes(2);
    });

    it('distinguishes dub loading, failure, retry and an empty successful response without automatic retries', async () => {
        const pending = createDeferred<{ code: number; types: never[] }>();
        get.mockResolvedValueOnce(preferences).mockReturnValueOnce(pending.promise).mockResolvedValueOnce({ code: 0, types: [] });
        const user = userEvent.setup(); setup();
        const open = screen.getByRole('button', { name: /Notifications from dubbing teams/ });
        await waitFor(() => expect(open).toBeEnabled()); await user.click(open);
        const dialog = screen.getByRole('dialog');
        expect(within(dialog).getByRole('status')).toHaveTextContent('Loading');
        pending.reject(new Error('Offline'));
        expect(await within(dialog).findByRole('alert')).toHaveTextContent('Could not load dubbing teams.');
        expect(get).toHaveBeenCalledTimes(2);
        expect(within(dialog).getByRole('button', { name: 'Select' })).toBeDisabled();
        await user.click(within(dialog).getByRole('button', { name: 'Try again' }));
        expect(await within(dialog).findByRole('status')).toHaveTextContent('Nothing here yet.');
        expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument();
        expect(get).toHaveBeenCalledTimes(3);
    });

    it('preserves dub drafts on save failure, prevents duplicate saves, and closes after a successful retry', async () => {
        get.mockResolvedValueOnce(preferences).mockResolvedValueOnce({ code: 0, types: [{ id: 9, name: 'Test dub' }] });
        const save = createDeferred<{ code: number }>();
        post.mockReturnValueOnce(save.promise).mockResolvedValueOnce({ code: 0 });
        const user = userEvent.setup(); setup();
        const open = screen.getByRole('button', { name: /Notifications from dubbing teams/ });
        await waitFor(() => expect(open).toBeEnabled()); await user.click(open);
        const dialog = screen.getByRole('dialog');
        await user.click(await within(dialog).findByRole('checkbox', { name: 'Test dub' }));
        const select = within(dialog).getByRole('button', { name: 'Select' });
        await user.dblClick(select);
        expect(post).toHaveBeenCalledTimes(1);
        save.reject(new Error('Offline'));
        expect(await within(dialog).findByRole('alert')).toHaveTextContent('Could not save notification settings.');
        expect(within(dialog).getByRole('checkbox', { name: 'Test dub' })).toBeChecked();
        await user.click(select);
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(open).toHaveTextContent('Test dub');
        expect(post).toHaveBeenLastCalledWith('/profile/preference/notification/type/edit', { profileTypeNotificationPreferences: [9] });
    });
});

