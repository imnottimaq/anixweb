import { useCallback, useEffect, useMemo, useState } from 'react';
import { RouterProvider } from 'react-router-dom';
import { router } from './app/router';
import { type AppSettings, defaultAppSettings, defaultPlayerKeybindings } from './shared/types/settings';
import { UserContext } from './shared/contexts/userContext';
import { SettingsContext } from './shared/contexts/settingsContext';
import { SearchContext, type SearchScope } from './shared/contexts/searchContext';
import { getStoredUserToken, setStoredUserToken } from './shared/authToken';
import { saveRoomIdentity } from './shared/roomParticipant';
import RoomProvider from './shared/contexts/RoomProvider';

import { htmlLanguageByLanguage, isLanguage } from './shared/locale';

function App() {
  const [userToken, setUserTokenState] = useState<string>(getStoredUserToken);
  const [userId, setUserIdState] = useState<number>(() => +(localStorage.getItem('user_id') || ""));
  const [settings, setSettings] = useState<AppSettings>(() => {
    const saved = localStorage.getItem('app_settings');

    if (!saved) return defaultAppSettings;

    try {
      const parsed = JSON.parse(saved);

      const appearance = { ...defaultAppSettings.appearance, ...parsed.appearance };
      if (!isLanguage(appearance.language)) appearance.language = defaultAppSettings.appearance.language;

      return {
        ...defaultAppSettings,
        ...parsed,
        player: {
          ...defaultAppSettings.player,
          ...parsed.player,
          keybindings: { ...defaultPlayerKeybindings, ...parsed.player?.keybindings },
        },
        content: { ...defaultAppSettings.content, ...parsed.content },
        appearance,
        notifications: { ...defaultAppSettings.notifications, ...parsed.notifications },
      };
    } catch {
      return defaultAppSettings;
    }
  });
  const [searchScope, setSearchScope] = useState<SearchScope>({ type: 'releases' });
  useEffect(() => {
    localStorage.setItem('app_settings', JSON.stringify(settings));
    document.documentElement.lang = htmlLanguageByLanguage[settings.appearance.language];
  }, [settings]);

  useEffect(() => {
    if (!userToken) return;

    let isCancelled = false;

    const loadCurrentProfileId = async () => {
      try {
        const response = await fetch(`https://api-s.anixsekai.com/profile/info?token=${userToken}`);
        if (!response.ok) return;

        const data: { id?: number | string; profile?: { id?: number | string; login?: string; avatar?: string | null } } = await response.json();
        const profileId = Number(data.profile?.id ?? data.id);
        if (!isCancelled && Number.isFinite(profileId) && profileId > 0) {
          setUserIdState(profileId);
          localStorage.setItem('user_id', String(profileId));
          if (data.profile?.login) {
            saveRoomIdentity({ id: profileId, login: data.profile.login, avatar: data.profile.avatar });
          }
        }
      } catch (error) {
        console.error('Failed to load current profile:', error);
      }
    };

    void loadCurrentProfileId();

    return () => {
      isCancelled = true;
    };
  }, [userToken]);

  const setUserToken = useCallback((token: string) => {
    setUserTokenState(token);
    setStoredUserToken(token);
  }, []);

  const setUserId = useCallback((id: string | number) => {
    setUserIdState(+id);
    if (id) {
      localStorage.setItem('user_id', id.toString());
    } else {
      localStorage.removeItem('user_id');
    }
  }, []);

  const settingsValue = useMemo(() => ({ settings, setSettings }), [settings]);
  const userValue = useMemo(() => ({ userToken, setUserToken, userId, setUserId }), [userToken, setUserToken, userId, setUserId]);
  const searchValue = useMemo(() => ({ searchScope, setSearchScope }), [searchScope]);

  return (
    <SettingsContext.Provider value={settingsValue}>
      <UserContext.Provider value={userValue}>
        <RoomProvider>
          <SearchContext.Provider value={searchValue}>
            <RouterProvider router={router} />
          </SearchContext.Provider>
        </RoomProvider>
      </UserContext.Provider>
    </SettingsContext.Provider>
  );
}

export default App;
