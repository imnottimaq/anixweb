import { useState, type ReactElement, type ReactNode, type Dispatch, type SetStateAction } from 'react';
import { render, type RenderOptions } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { UserContext } from '../../../src/shared/contexts/userContext';
import { SettingsContext } from '../../../src/shared/contexts/settingsContext';
import { defaultAppSettings, type AppSettings } from '../../../src/shared/types/settings';
import { vi } from 'vitest';

export interface ProviderOptions {
    initialRoute?: string;
    userToken?: string;
    userId?: number;
    setUserToken?: (token: string) => void;
    setUserId?: (id: string | number) => void;
    settings?: AppSettings;
    setSettings?: Dispatch<SetStateAction<AppSettings>>;
}

export function createMockUserContext(options: ProviderOptions = {}) {
    return {
        userToken: options.userToken ?? '',
        userId: options.userId ?? 0,
        setUserToken: options.setUserToken ?? vi.fn(),
        setUserId: options.setUserId ?? vi.fn(),
    };
}

export function createMockSettingsContext(options: ProviderOptions = {}) {
    return {
        settings: options.settings ?? defaultAppSettings,
        setSettings: options.setSettings ?? vi.fn(),
    };
}

export function AllProvidersWrapper({
    children,
    options = {},
}: {
    children: ReactNode;
    options?: ProviderOptions;
}) {
    const [token, setToken] = useState(options.userToken ?? '');
    const [id, setId] = useState<number>(options.userId ?? 0);
    const [settingsState, setSettingsState] = useState<AppSettings>(options.settings ?? defaultAppSettings);

    const userValue = {
        userToken: options.setUserToken ? (options.userToken ?? '') : token,
        userId: options.setUserId ? (options.userId ?? 0) : id,
        setUserToken: options.setUserToken ?? setToken,
        setUserId: options.setUserId ?? ((newId: string | number) => setId(Number(newId))),
    };

    const settingsValue = {
        settings: options.setSettings ? (options.settings ?? defaultAppSettings) : settingsState,
        setSettings: options.setSettings ?? setSettingsState,
    };

    return (
        <MemoryRouter initialEntries={[options.initialRoute ?? '/']}>
            <SettingsContext.Provider value={settingsValue}>
                <UserContext.Provider value={userValue}>
                    {children}
                </UserContext.Provider>
            </SettingsContext.Provider>
        </MemoryRouter>
    );
}

export function renderWithProviders(
    ui: ReactElement,
    providerOptions: ProviderOptions = {},
    renderOptions?: Omit<RenderOptions, 'wrapper'>,
) {
    return render(ui, {
        wrapper: ({ children }) => (
            <AllProvidersWrapper options={providerOptions}>
                {children}
            </AllProvidersWrapper>
        ),
        ...renderOptions,
    });
}
