import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import AuthVerificationForm from '../../src/components/AuthVerificationForm';
import { SettingsContext } from '../../src/shared/contexts/settingsContext';
import { UserContext } from '../../src/shared/contexts/userContext';
import { defaultAppSettings } from '../../src/shared/types/settings';
import { createDeferred } from './helpers/deferred';

const { identity } = vi.hoisted(() => ({ identity: vi.fn() }));
vi.mock('../../src/shared/profileIdentity', () => ({ resolveAndStoreProfileIdentity: identity }));
const request = vi.fn();
const setUserToken = vi.fn();
const setUserId = vi.fn();
const response = (data: object) => ({ ok: true, json: async () => data } as Response);

function setup(mode: 'register' | 'recover' = 'register') {
    return render(<MemoryRouter><SettingsContext.Provider value={{
        settings: { ...defaultAppSettings, appearance: { ...defaultAppSettings.appearance, language: 'english' } },
        setSettings: vi.fn(),
    }}><UserContext.Provider value={{ userToken: '', userId: 0, setUserToken, setUserId }}>
        <Routes><Route path="/" element={<AuthVerificationForm mode={mode} />} />
            <Route path="/account" element={<p>Account destination</p>} /></Routes>
    </UserContext.Provider></SettingsContext.Provider></MemoryRouter>);
}

async function registrationDetails(user: ReturnType<typeof userEvent.setup>, confirmation = 'password123') {
    await user.type(screen.getByLabelText('Username'), 'viewer');
    await user.type(screen.getByLabelText('Email'), 'viewer@example.com');
    await user.type(screen.getByLabelText('Password', { exact: true }), 'password123');
    await user.type(screen.getByLabelText('Confirm password'), confirmation);
}

function postedBody(index: number) {
    return Object.fromEntries(request.mock.calls[index][1].body as URLSearchParams);
}

beforeEach(() => {
    vi.resetAllMocks(); vi.stubGlobal('fetch', request);
    identity.mockResolvedValue(42);
    request.mockResolvedValue(response({ code: 0, hash: 'request-hash' }));
});
afterEach(() => vi.unstubAllGlobals());

describe('account verification forms', () => {
    it('registers through labeled fields and Enter, then verifies the returned hash and signs in', async () => {
        request.mockResolvedValueOnce(response({ code: 0, hash: 'registration-hash' }))
            .mockResolvedValueOnce(response({ code: 0, profileToken: { token: 'session-token', id: 7 } }));
        const user = userEvent.setup(); setup();
        expect(screen.queryByLabelText('Code from email')).not.toBeInTheDocument();
        await registrationDetails(user); await user.keyboard('{Enter}');
        const code = await screen.findByLabelText('Code from email');
        expect(code).toHaveFocus();
        expect(request.mock.calls[0][0]).toBe('https://api-s.anixsekai.com/auth/signUp');
        expect(postedBody(0)).toEqual({ login: 'viewer', email: 'viewer@example.com', password: 'password123' });
        expect(request.mock.calls[0][1]).toMatchObject({ method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
        await user.type(code, '123456{Enter}');
        expect(await screen.findByText('Account destination')).toBeVisible();
        expect(request.mock.calls[1][0]).toBe('https://api-s.anixsekai.com/auth/verify');
        expect(postedBody(1)).toEqual({ login: 'viewer', email: 'viewer@example.com', password: 'password123', hash: 'registration-hash', code: '123456' });
        expect(setUserId).toHaveBeenCalledWith(42); expect(setUserToken).toHaveBeenCalledWith('session-token');
    });

    it('requires only the identifier for recovery, then collects code and matching passwords', async () => {
        request.mockResolvedValueOnce(response({ code: 0, hash: 'restore-hash' }))
            .mockResolvedValueOnce(response({ code: 0, profileToken: { token: 'restored-token', id: 7 } }));
        const user = userEvent.setup(); setup('recover');
        expect(screen.queryByLabelText('Email')).not.toBeInTheDocument();
        expect(screen.queryByLabelText('Password', { exact: true })).not.toBeInTheDocument();
        await user.type(screen.getByLabelText('Username'), 'viewer{Enter}');
        const code = await screen.findByLabelText('Code from email');
        expect(postedBody(0)).toEqual({ data: 'viewer' });
        expect(request.mock.calls[0][0]).toBe('https://api-s.anixsekai.com/auth/restore');
        await user.type(code, '654321');
        await user.type(screen.getByLabelText('Password', { exact: true }), 'newpassword');
        await user.type(screen.getByLabelText('Confirm password'), 'newpassword{Enter}');
        expect(await screen.findByText('Account destination')).toBeVisible();
        expect(request.mock.calls[1][0]).toBe('https://api-s.anixsekai.com/auth/restore/verify');
        expect(postedBody(1)).toEqual({ data: 'viewer', password: 'newpassword', hash: 'restore-hash', code: '654321' });
    });

    it('uses native required/email constraints and blocks mismatching passwords before requesting a code', async () => {
        const user = userEvent.setup(); setup();
        await user.click(screen.getByRole('button', { name: 'Send verification code' }));
        expect(screen.getByLabelText('Username')).toBeInvalid(); expect(request).not.toHaveBeenCalled();
        await registrationDetails(user, 'differentpassword');
        const email = screen.getByLabelText('Email');
        await user.clear(email); await user.type(email, 'invalid-email');
        await user.click(screen.getByRole('button', { name: 'Send verification code' }));
        expect(email).toBeInvalid(); expect(request).not.toHaveBeenCalled();
        await user.clear(email); await user.type(email, 'viewer@example.com');
        await user.click(screen.getByRole('button', { name: 'Send verification code' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('Passwords do not match.');
        expect(request).not.toHaveBeenCalled();
    });

    it('prevents duplicate sends and keeps credential drafts on a failed request', async () => {
        const pending = createDeferred<Response>(); request.mockReturnValueOnce(pending.promise);
        const user = userEvent.setup(); setup(); await registrationDetails(user);
        await user.dblClick(screen.getByRole('button', { name: 'Send verification code' }));
        expect(request).toHaveBeenCalledTimes(1);
        expect(screen.getByRole('button', { name: 'Sending code…' })).toBeDisabled();
        expect(screen.getByLabelText('Username')).toBeDisabled();
        pending.reject(new Error('Offline'));
        expect(await screen.findByRole('alert')).toHaveTextContent('Unable to send the code. Try again.');
        expect(screen.getByLabelText('Username')).toHaveValue('viewer');
        expect(screen.getByLabelText('Email')).toHaveValue('viewer@example.com');
        expect(screen.getByLabelText('Password', { exact: true })).toHaveValue('password123');
        await user.click(screen.getByRole('button', { name: 'Send verification code' }));
        expect(await screen.findByLabelText('Code from email')).toBeVisible();
        expect(request).toHaveBeenCalledTimes(2);
    });

    it('blocks recovery verification with a mismatch and prevents duplicate verification while pending', async () => {
        const pending = createDeferred<Response>();
        request.mockResolvedValueOnce(response({ code: 0, hash: 'restore-hash' })).mockReturnValueOnce(pending.promise);
        const user = userEvent.setup(); setup('recover');
        await user.type(screen.getByLabelText('Username'), 'viewer{Enter}');
        await user.type(await screen.findByLabelText('Code from email'), '111111');
        await user.type(screen.getByLabelText('Password', { exact: true }), 'newpassword');
        await user.type(screen.getByLabelText('Confirm password'), 'differentpassword');
        await user.click(screen.getByRole('button', { name: 'Reset password' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('Passwords do not match.');
        expect(request).toHaveBeenCalledTimes(1);
        await user.clear(screen.getByLabelText('Confirm password'));
        await user.type(screen.getByLabelText('Confirm password'), 'newpassword');
        await user.dblClick(screen.getByRole('button', { name: 'Reset password' }));
        expect(request).toHaveBeenCalledTimes(2);
        expect(screen.getByRole('button', { name: 'Verifying…' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Resend code' })).toBeDisabled();
        pending.resolve(response({ code: 2 }));
        expect(await screen.findByRole('alert')).toHaveTextContent('Unable to restore the account.');
    });

    it('retains the code and recovery password draft across rejected verification and failed resend', async () => {
        request.mockResolvedValueOnce(response({ code: 0, hash: 'restore-hash' }))
            .mockResolvedValueOnce(response({ code: 2 }))
            .mockRejectedValueOnce(new Error('Offline'));
        const user = userEvent.setup(); setup('recover');
        await user.type(screen.getByLabelText('Username'), 'viewer{Enter}');
        await user.type(await screen.findByLabelText('Code from email'), '111111');
        await user.type(screen.getByLabelText('Password', { exact: true }), 'newpassword');
        await user.type(screen.getByLabelText('Confirm password'), 'newpassword');
        await user.click(screen.getByRole('button', { name: 'Reset password' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('Unable to restore the account.');
        expect(screen.getByLabelText('Code from email')).toHaveValue('111111');
        await user.click(screen.getByRole('button', { name: 'Resend code' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('Unable to send the code.');
        expect(screen.getByLabelText('Code from email')).toHaveValue('111111');
        expect(screen.getByLabelText('Password', { exact: true })).toHaveValue('newpassword');
        expect(screen.getByLabelText('Confirm password')).toHaveValue('newpassword');
        expect(postedBody(2)).toEqual({ data: 'viewer' });
        expect(setUserToken).not.toHaveBeenCalled();
    });

    it('invalidates the old code/hash when details are edited and uses the newly requested hash', async () => {
        request.mockResolvedValueOnce(response({ code: 0, hash: 'old-hash' }))
            .mockResolvedValueOnce(response({ code: 0, hash: 'new-hash' }))
            .mockResolvedValueOnce(response({ code: 1 }));
        const user = userEvent.setup(); setup('recover');
        await user.type(screen.getByLabelText('Username'), 'viewer{Enter}');
        await user.type(await screen.findByLabelText('Code from email'), '111111');
        await user.click(screen.getByRole('button', { name: 'Edit details' }));
        expect(screen.queryByLabelText('Code from email')).not.toBeInTheDocument();
        const username = screen.getByLabelText('Username');
        await user.clear(username); await user.type(username, 'other-user{Enter}');
        const code = await screen.findByLabelText('Code from email');
        expect(code).toHaveValue(''); await user.type(code, '222222');
        await user.type(screen.getByLabelText('Password', { exact: true }), 'password');
        await user.type(screen.getByLabelText('Confirm password'), 'password{Enter}');
        await waitFor(() => expect(request).toHaveBeenCalledTimes(3));
        expect(postedBody(2)).toMatchObject({ data: 'other-user', hash: 'new-hash', code: '222222' });
    });
});
