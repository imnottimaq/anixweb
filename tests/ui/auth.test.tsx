import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { Routes, Route, MemoryRouter } from 'react-router-dom';
import LoginScreen from '../../src/pages/LoginScreen';
import { UserContext } from '../../src/shared/contexts/userContext';
import { SettingsContext } from '../../src/shared/contexts/settingsContext';
import { defaultAppSettings } from '../../src/shared/types/settings';
import { mockLoginResponses, mockProfileSearchResponse } from './fixtures/authFixtures';
import { createDeferred } from './helpers/deferred';

function renderLoginWithContext({
    initialToken = '',
    initialId = 0,
    initialRoute = '/login',
    onTokenChange,
    onIdChange,
}: {
    initialToken?: string;
    initialId?: number;
    initialRoute?: string;
    onTokenChange?: (token: string) => void;
    onIdChange?: (id: number) => void;
} = {}) {
    function TestApp() {
        const [token, setToken] = useState(initialToken);
        const [userId, setUserId] = useState(initialId);

        const handleSetToken = (t: string) => {
            setToken(t);
            onTokenChange?.(t);
        };

        const handleSetUserId = (id: string | number) => {
            const num = Number(id);
            setUserId(num);
            onIdChange?.(num);
        };

        return (
            <MemoryRouter initialEntries={[initialRoute]}>
                <SettingsContext.Provider value={{ settings: defaultAppSettings, setSettings: vi.fn() }}>
                    <UserContext.Provider
                        value={{
                            userToken: token,
                            userId,
                            setUserToken: handleSetToken,
                            setUserId: handleSetUserId,
                        }}
                    >
                        <Routes>
                            <Route path="/login" element={<LoginScreen />} />
                            <Route path="/account" element={<div data-testid="account-page">Личный кабинет</div>} />
                            <Route path="/account/recover" element={<div data-testid="recover-page">Восстановление</div>} />
                            <Route path="/account/create" element={<div data-testid="register-page">Регистрация</div>} />
                        </Routes>
                    </UserContext.Provider>
                </SettingsContext.Provider>
            </MemoryRouter>
        );
    }

    return render(<TestApp />);
}

describe('LoginScreen (src/pages/LoginScreen.tsx)', () => {
    const originalFetch = globalThis.fetch;

    beforeEach(() => {
        vi.restoreAllMocks();
        localStorage.clear();
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
        localStorage.clear();
    });

    it('renders login form with username, password fields, submit button, and action links', () => {
        renderLoginWithContext();

        expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Войдите в свой аккаунт Anixart');
        expect(screen.getByLabelText(/Логин|Имя пользователя/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/Пароль/i)).toBeInTheDocument();

        const submitButton = screen.getByRole('button', { name: 'Вход' });
        expect(submitButton).toBeInTheDocument();
        expect(submitButton).not.toBeDisabled();

        expect(screen.getByRole('link', { name: 'Забыли пароль?' })).toHaveAttribute('href', '/account/recover');
        expect(screen.getByRole('link', { name: 'Регистрация' })).toHaveAttribute('href', '/account/create');
    });

    it('immediately redirects to /account when user is already signed in', () => {
        renderLoginWithContext({ initialToken: 'already-authenticated-token' });

        expect(screen.getByTestId('account-page')).toBeInTheDocument();
        expect(screen.queryByLabelText(/Логин/i)).not.toBeInTheDocument();
    });

    it('successfully logs in, updates user context, saves room identity, and navigates to /account', async () => {
        const user = userEvent.setup();
        const fetchMock = vi.fn().mockImplementation(async (url: string) => {
            if (url.includes('/auth/signIn')) {
                return {
                    ok: true,
                    status: 200,
                    json: async () => mockLoginResponses.successWithProfile,
                } as Response;
            }
            return { ok: false, status: 404 } as Response;
        });
        globalThis.fetch = fetchMock;

        const onTokenChange = vi.fn();
        const onIdChange = vi.fn();

        renderLoginWithContext({ onTokenChange, onIdChange });

        const usernameInput = screen.getByLabelText(/Логин|Имя пользователя/i);
        const passwordInput = screen.getByLabelText(/Пароль/i);
        const submitButton = screen.getByRole('button', { name: 'Вход' });

        await user.type(usernameInput, 'naruto_fan');
        await user.type(passwordInput, 'secret_pass_123');
        await user.click(submitButton);

        await waitFor(() => {
            expect(fetchMock).toHaveBeenCalledTimes(1);
        });

        const calledUrl = fetchMock.mock.calls[0][0] as string;
        expect(calledUrl).toContain('/auth/signIn?login=naruto_fan&password=secret_pass_123');

        await waitFor(() => {
            expect(onTokenChange).toHaveBeenCalledWith('valid-test-token-12345');
            expect(onIdChange).toHaveBeenCalledWith(1042);
        });

        // Identity saved to localStorage
        const savedIdentity = JSON.parse(localStorage.getItem('user_room_identity') || '{}');
        expect(savedIdentity).toEqual({
            id: 1042,
            login: 'naruto_fan',
            avatar: 'https://s.anixmirai.com/avatars/1042.jpg',
        });

        // Redirected to /account
        expect(await screen.findByTestId('account-page')).toBeInTheDocument();
    });

    it('resolves profile identity via /search/profiles/0 when profile is not returned inline', async () => {
        const user = userEvent.setup();
        const fetchMock = vi.fn().mockImplementation(async (url: string) => {
            if (url.includes('/auth/signIn')) {
                return {
                    ok: true,
                    status: 200,
                    json: async () => mockLoginResponses.successWithoutProfile,
                } as Response;
            }
            if (url.includes('/search/profiles/0')) {
                return {
                    ok: true,
                    status: 200,
                    json: async () => mockProfileSearchResponse,
                } as Response;
            }
            return { ok: false, status: 404 } as Response;
        });
        globalThis.fetch = fetchMock;

        const onTokenChange = vi.fn();
        const onIdChange = vi.fn();

        renderLoginWithContext({ onTokenChange, onIdChange });

        await user.type(screen.getByLabelText(/Логин|Имя пользователя/i), 'naruto_fan');
        await user.type(screen.getByLabelText(/Пароль/i), 'password');
        await user.click(screen.getByRole('button', { name: 'Вход' }));

        await waitFor(() => {
            expect(onTokenChange).toHaveBeenCalledWith('token-without-inline-profile-67890');
            expect(onIdChange).toHaveBeenCalledWith(5555);
        });

        const savedIdentity = JSON.parse(localStorage.getItem('user_room_identity') || '{}');
        expect(savedIdentity.id).toBe(5555);
        expect(savedIdentity.login).toBe('naruto_fan');
    });

    it('displays error alert on invalid credentials and keeps user on login page', async () => {
        const user = userEvent.setup();
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => mockLoginResponses.invalidCredentials,
        } as Response);

        const onTokenChange = vi.fn();
        renderLoginWithContext({ onTokenChange });

        await user.type(screen.getByLabelText(/Логин|Имя пользователя/i), 'wrong_user');
        await user.type(screen.getByLabelText(/Пароль/i), 'wrong_pass');
        await user.click(screen.getByRole('button', { name: 'Вход' }));

        const errorAlert = await screen.findByRole('alert');
        expect(errorAlert).toBeInTheDocument();
        expect(errorAlert).toHaveTextContent('Не удалось войти. Проверьте логин и пароль.');

        expect(onTokenChange).not.toHaveBeenCalled();
        expect(screen.queryByTestId('account-page')).not.toBeInTheDocument();

        // Submit button is re-enabled
        const submitButton = screen.getByRole('button', { name: 'Вход' });
        expect(submitButton).toBeEnabled();
    });

    it('displays error alert on network failure (HTTP 500 or fetch error)', async () => {
        const user = userEvent.setup();
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: false,
            status: 500,
            json: async () => ({ error: 'Server crashed' }),
        } as Response);

        renderLoginWithContext();

        await user.type(screen.getByLabelText(/Логин|Имя пользователя/i), 'network_test');
        await user.type(screen.getByLabelText(/Пароль/i), 'pass');
        await user.click(screen.getByRole('button', { name: 'Вход' }));

        const errorAlert = await screen.findByRole('alert');
        expect(errorAlert).toBeInTheDocument();
        expect(errorAlert).toHaveTextContent('Не удалось войти. Проверьте логин и пароль.');

        const submitButton = screen.getByRole('button', { name: 'Вход' });
        expect(submitButton).toBeEnabled();
    });

    it('protects against duplicate submission while login request is in-flight', async () => {
        const deferred = createDeferred<Response>();
        const fetchMock = vi.fn().mockImplementation(() => deferred.promise);
        globalThis.fetch = fetchMock;

        renderLoginWithContext();

        const usernameInput = screen.getByLabelText(/Логин|Имя пользователя/i);
        const passwordInput = screen.getByLabelText(/Пароль/i);
        const submitButton = screen.getByRole('button', { name: 'Вход' });
        const form = submitButton.closest('form')!;

        fireEvent.change(usernameInput, { target: { value: 'rapid_user' } });
        fireEvent.change(passwordInput, { target: { value: 'secret' } });

        // Trigger first submit
        fireEvent.submit(form);

        // While in-flight: button becomes disabled and shows loading text
        expect(submitButton).toBeDisabled();
        expect(submitButton).toHaveTextContent(/Входим/);
        expect(fetchMock).toHaveBeenCalledTimes(1);

        // Attempt second and third rapid submissions while in-flight
        fireEvent.submit(form);
        fireEvent.submit(form);

        // Should still only have called fetch ONCE!
        expect(fetchMock).toHaveBeenCalledTimes(1);

        // Now resolve the in-flight request
        deferred.resolve({
            ok: true,
            status: 200,
            json: async () => mockLoginResponses.successWithProfile,
        } as Response);

        // Component should finish login and navigate to /account
        expect(await screen.findByTestId('account-page')).toBeInTheDocument();
    });
});
