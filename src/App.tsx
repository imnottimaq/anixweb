import { useCallback, useEffect, useRef, useState,} from 'react'
import {  RouterProvider } from 'react-router-dom'
import { router } from './app/router';
import { type AppSettings, defaultAppSettings, defaultPlayerKeybindings } from './shared/types/settings';
import { UserContext } from './shared/contexts/userContext';
import { SettingsContext } from './shared/contexts/settingsContext';
import { SearchContext, type SearchScope } from './shared/contexts/searchContext';
import { getStoredUserToken, setStoredUserToken } from './shared/authToken';
import { getRoomParticipant, saveRoomIdentity } from './shared/roomParticipant';
import { RoomContext } from './shared/contexts/roomContext';
import { WatchRoomSocket } from './shared/watchRoom';
import { htmlLanguageByLanguage, isLanguage } from './shared/locale';

function App() {
  const [userToken, setUserTokenState] = useState<string>(getStoredUserToken);
  const [userId, setUserIdState] = useState<number>(() => +(localStorage.getItem('user_id') || ""))
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
  const [activeRoomId, setActiveRoomIdState] = useState<string | null>(() => localStorage.getItem('active_watch_room'));
  const roomSocketRef = useRef(new WatchRoomSocket());

  const setActiveRoomId = useCallback((roomId: string | null) => {
    setActiveRoomIdState(roomId);
    if (roomId) localStorage.setItem('active_watch_room', roomId);
    else localStorage.removeItem('active_watch_room');
  }, []);

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
        console.error('Не удалось определить ID текущего профиля:', error);
      }
    };

    void loadCurrentProfileId();

    return () => {
      isCancelled = true;
    };
  }, [userToken]);

  useEffect(() => {
    const room = roomSocketRef.current
    if (!activeRoomId || userId <= 0) return;
    room.connect(activeRoomId, getRoomParticipant(userId), () => {}, error => {
      console.error('Ошибка фонового подключения к комнате:', error);
      setActiveRoomId(null);
    }, () => setActiveRoomId(null));
    return () => room.disconnect();
  }, [activeRoomId, setActiveRoomId, userId]);

  useEffect(() => {
    const clearRoomPresence = () => localStorage.removeItem('active_watch_room');
    window.addEventListener('pagehide', clearRoomPresence);
    return () => window.removeEventListener('pagehide', clearRoomPresence);
  }, []);

  const setUserToken = (token: string) => {
    setUserTokenState(token);
    setStoredUserToken(token);
  };

  const setUserId = (id: string | number) => {
    setUserIdState(+id)
    if (id) {
      localStorage.setItem('user_id', id.toString())
    } else {
      localStorage.removeItem('user_id')
    }
  }
  
  return (
    <SettingsContext.Provider value={{settings, setSettings}}>
      <UserContext.Provider value={{userToken, setUserToken, userId, setUserId}}>
        <RoomContext.Provider value={{activeRoomId, setActiveRoomId}}>
          <SearchContext.Provider value={{searchScope, setSearchScope}}>
            <RouterProvider router={router} />
          </SearchContext.Provider>
        </RoomContext.Provider>
      </UserContext.Provider>
    </SettingsContext.Provider>
  )
}

export default App
