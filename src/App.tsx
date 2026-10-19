import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RouterProvider } from 'react-router-dom';
import { router } from './app/router';
import { type AppSettings, defaultAppSettings } from './shared/types/settings';
import { UserContext } from './shared/contexts/userContext';
import { SettingsContext } from './shared/contexts/settingsContext';
import { SearchContext, type SearchScope } from './shared/contexts/searchContext';
import { getStoredUserToken, setStoredUserToken } from './shared/authToken';
import { getCandidateProfileId, saveRoomIdentity } from './shared/roomParticipant';
import { isAutoSyncAccountEnabled, loadAccountSettings } from './shared/cloudSettings';
import RoomProvider from './shared/contexts/RoomProvider';
import { normalizeLegacySettings } from './shared/settingsNormalizer';

import { htmlLanguageByLanguage } from './shared/locale';

function App() {
  const [userToken, setUserTokenState] = useState<string>(getStoredUserToken);
  const [userId, setUserIdState] = useState<number>(() => +(localStorage.getItem('user_id') || ""));
  const [settings, setSettingsState] = useState<AppSettings>(() => {
    const saved = localStorage.getItem('app_settings');
    if (!saved) return defaultAppSettings;

    try {
      const parsed = JSON.parse(saved);
      return normalizeLegacySettings(parsed);
    } catch {
      return defaultAppSettings;
    }
  });

  const localEditCountRef = useRef(0);
  const setSettings: React.Dispatch<React.SetStateAction<AppSettings>> = useCallback((action) => {
    localEditCountRef.current += 1;
    setSettingsState(action);
  }, []);

  const [searchScope, setSearchScope] = useState<SearchScope>({ type: 'releases' });
  useEffect(() => {
    localStorage.setItem('app_settings', JSON.stringify(settings));
    const lang = settings.appearance.language;
    document.documentElement.lang = htmlLanguageByLanguage[lang] || ((lang as string) === 'ukrainian' ? 'uk' : 'en');
  }, [settings]);

  useEffect(() => {
    if (!userToken) return;

    let isCancelled = false;
    const currentSessionToken = userToken;
    // Include edits made while the initial profile validation is pending.
    const editCountAtStart = localEditCountRef.current;

    const loadCurrentProfileId = async () => {
      try {
        const candidateId = getCandidateProfileId();
        if (!candidateId) return;
        const response = await fetch(`https://api-s.anixsekai.com/profile/${candidateId}?token=${userToken}`);
        if (!response.ok) return;

        const data: { code?: number; is_my_profile?: boolean; profile?: { id?: number | string; login?: string; avatar?: string | null } } = await response.json();
        if (data.code === 0 && data.is_my_profile === true && data.profile) {
          const profileId = Number(data.profile.id);
          if (!isCancelled && Number.isSafeInteger(profileId) && profileId === candidateId) {
            setUserIdState(profileId);
            localStorage.setItem('user_id', String(profileId));
            if (data.profile.login) {
              saveRoomIdentity({ id: profileId, login: data.profile.login, avatar: data.profile.avatar ?? null });
            }

            if (isAutoSyncAccountEnabled()) {
              const tokenAtStart = currentSessionToken;
              const profileIdAtStart = profileId;

              loadAccountSettings(userToken, profileId)
                .then(({ payload }) => {
                  if (isCancelled) return;
                  // If local settings were edited or user session changed while in-flight, ignore
                  if (
                    localEditCountRef.current !== editCountAtStart ||
                    userToken !== tokenAtStart ||
                    profileId !== profileIdAtStart
                  ) {
                    return;
                  }
                  setSettingsState(previous => normalizeLegacySettings(payload.settings, previous));
                  if (payload.my_filters && typeof payload.my_filters === 'object') {
                    localStorage.setItem('my_filters', JSON.stringify(payload.my_filters));
                  }
                })
                .catch(() => {
                  // Ignore if no saved settings exist yet
                });
            }
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

  const settingsValue = useMemo(() => ({ settings, setSettings }), [settings, setSettings]);
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
