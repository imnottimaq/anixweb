import { useCallback, useContext } from 'react';
import { SettingsContext } from '../contexts/settingsContext';
import { defaultAppSettings } from '../types/settings';

/** Apply the saved player volume both when audio mounts and when settings change. */
export function useVoicePlaybackVolume() {
    const context = useContext(SettingsContext);
    const savedVolume = context?.settings.player.volume ?? defaultAppSettings.player.volume;
    const volume = Math.min(1, Math.max(0, savedVolume / 100));
    return useCallback((audio: HTMLAudioElement | null) => {
        if (audio) audio.volume = volume;
    }, [volume]);
}
