import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import AudioAttachment from '../../src/components/AudioAttachment';
import { SettingsContext } from '../../src/shared/contexts/settingsContext';
import { defaultAppSettings } from '../../src/shared/types/settings';

vi.mock('../../src/shared/hooks/useAttachmentBlob', () => ({
    useAttachmentBlob: () => ({ url: 'blob:voice-message', loading: false, error: null, retry: vi.fn() }),
}));

it('uses saved anime volume when a voice message loads and follows changes including mute', () => {
    const view = (volume: number, visible = true) => <SettingsContext.Provider value={{
        settings: { ...defaultAppSettings, player: { ...defaultAppSettings.player, volume } },
        setSettings: vi.fn(),
    }}>
        {visible && <AudioAttachment roomId="room" attachment={{ id: 'voice', kind: 'voice', mimeType: 'audio/webm', name: 'voice.webm', size: 100 }} />}
    </SettingsContext.Provider>;
    const { container, rerender } = render(view(35, false));
    rerender(view(35));
    const audio = container.querySelector('audio')!;
    expect(audio.volume).toBe(0.35);
    rerender(view(80));
    expect(audio.volume).toBe(0.8);
    rerender(view(0));
    expect(audio.volume).toBe(0);
    rerender(view(100));
    expect(audio.volume).toBe(1);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
