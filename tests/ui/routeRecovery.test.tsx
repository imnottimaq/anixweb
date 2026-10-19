import { lazy, Suspense } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import RouteErrorPage from '../../src/components/RouteErrorPage';
import { SettingsContext } from '../../src/shared/contexts/settingsContext';
import { defaultAppSettings } from '../../src/shared/types/settings';

afterEach(() => vi.restoreAllMocks());

it.each(['render', 'lazy'] as const)('provides recovery after a %s failure without exposing exception details', async failure => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    function Broken(): never { throw new Error('PRIVATE_EXCEPTION_DETAILS'); }
    const MissingChunk = lazy(() => Promise.reject(new Error('PRIVATE_EXCEPTION_DETAILS')));
    const router = createMemoryRouter([
        { path: '/', element: <p>Home recovered</p> },
        { path: '/broken', element: failure === 'render' ? <Broken /> : <Suspense><MissingChunk /></Suspense>, errorElement: <RouteErrorPage /> },
    ], { initialEntries: ['/broken'] });
    render(<SettingsContext.Provider value={{ settings: { ...defaultAppSettings, appearance: { ...defaultAppSettings.appearance, language: 'english' } }, setSettings: vi.fn() }}><RouterProvider router={router} /></SettingsContext.Provider>);
    expect(await screen.findByRole('heading', { name: 'Could not open this page' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.queryByText(/PRIVATE_EXCEPTION_DETAILS/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('link', { name: 'Home' }));
    expect(await screen.findByText('Home recovered')).toBeInTheDocument();
    router.dispose();
});
