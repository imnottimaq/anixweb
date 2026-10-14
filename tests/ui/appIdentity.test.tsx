import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import App from '../../src/App';
import { roomErrorKey } from '../../src/shared/roomError';

vi.mock('../../src/app/router', () => ({ router: {} }));
vi.mock('react-router-dom', () => ({ RouterProvider: () => null }));
vi.mock('../../src/shared/contexts/RoomProvider', () => ({ default: ({ children }: { children: ReactNode }) => children }));

beforeEach(() => {
    localStorage.clear();
    document.cookie = 'anixart_token=fixture-token; path=/';
    localStorage.setItem('user_id', '42');
    localStorage.setItem('user_room_identity', JSON.stringify({ id: 42, login: 'StoredUser' }));
});
afterEach(() => {
    vi.unstubAllGlobals();
    document.cookie = 'anixart_token=; max-age=0; path=/';
    localStorage.clear();
});

it.each([
    { code: 0, profile: { id: 42, login: 'UnverifiedUser' } },
    { code: 0, is_my_profile: false, profile: { id: 42, login: 'OtherUser' } },
    { code: 0, is_my_profile: true, profile: { id: 99, login: 'WrongId' } },
])('does not replace the stored account with an unverified profile: %j', async response => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json(response));
    vi.stubGlobal('fetch', fetchMock);
    await act(async () => { render(<App />); });
    expect(fetchMock).toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem('user_room_identity')!)).toEqual({ id: 42, login: 'StoredUser' });
    expect(localStorage.getItem('user_id')).toBe('42');
});

it('refreshes identity only from the matching owned profile', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ code: 0, is_my_profile: true, profile: { id: 42, login: 'VerifiedUser', avatar: null } }));
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);
    await waitFor(() => expect(JSON.parse(localStorage.getItem('user_room_identity')!).login).toBe('VerifiedUser'));
    expect(String(fetchMock.mock.calls[0][0])).toContain('/profile/42?');
});

it('distinguishes a required sign-in from an unavailable auth API', () => {
    for (const code of ['ROOM_SIGN_IN', 'ROOM_IDENTITY_REQUIRED', 'AUTH_REJECTED', 'INVALID_PROFILE_ID']) {
        expect(roomErrorKey(code)).toBe('roomUX.errorSignIn');
    }
    expect(roomErrorKey('AUTH_UNAVAILABLE')).toBe('roomUX.errorAuth');
});
