import { useId, useState } from 'react';
import { useSettings } from '../shared/contexts/settingsContext';
import { useTranslation } from '../shared/useTranslation';
import { defaultPlayerKeybindings, playerKeybindingActions, type PlayerKeybindingAction } from '../shared/types/settings';
import { Modal } from './ModalTemplate';
import styles from './KeybindingsModal.module.css';
import ActionIcon from '../components/ActionIcon';

export default function KeybindingsModal({onClose}: {onClose: () => void}) {
    const {settings, setSettings} = useSettings();
    const {t} = useTranslation();
    const id = useId();
    const [capturingBinding, setCapturingBinding] = useState<PlayerKeybindingAction | null>(null);
    const keybindings = settings.player.keybindings ?? defaultPlayerKeybindings;

    const keybindingLabels: Record<PlayerKeybindingAction, string> = {
        togglePlayback: t('settings.keybinding.togglePlayback'),
        seekBackward: t('settings.keybinding.seekBackward'),
        seekForward: t('settings.keybinding.seekForward'),
        volumeDown: t('settings.keybinding.volumeDown'),
        volumeUp: t('settings.keybinding.volumeUp'),
        toggleMute: t('settings.keybinding.toggleMute'),
        toggleFullscreen: t('settings.keybinding.toggleFullscreen'),
        previousEpisode: t('settings.keybinding.previousEpisode'),
        nextEpisode: t('settings.keybinding.nextEpisode'),
        skipOpening: t('settings.keybinding.skipOpening'),
    };

    const formatKey = (code: string) => ({ Space: t('settings.key.space'), ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓' }[code] ?? code.replace(/^Key/, ''));

    const groups: {title: 'roadmap.settings.playbackKeys' | 'roadmap.settings.volumeKeys' | 'roadmap.settings.episodeKeys'; actions: PlayerKeybindingAction[]}[] = [
        {title:'roadmap.settings.playbackKeys',actions:['togglePlayback','seekBackward','seekForward','skipOpening','toggleFullscreen']},
        {title:'roadmap.settings.volumeKeys',actions:['volumeDown','volumeUp','toggleMute']},
        {title:'roadmap.settings.episodeKeys',actions:['previousEpisode','nextEpisode']},
    ];
    const assign = (action: PlayerKeybindingAction, code: string) => {
        setSettings(previous => {
            const keybindings = {...defaultPlayerKeybindings, ...previous.player.keybindings};
            if (code) for (const other of playerKeybindingActions) if (other !== action && keybindings[other] === code) keybindings[other] = '';
            keybindings[action] = code;
            return {...previous, player:{...previous.player, keybindings}};
        });
        setCapturingBinding(null);
    };

    return (
        <Modal isOpen onClose={onClose} title={t('settings.keybindings')} size="medium" stickyHeader>
            <div className={styles.toolbar}>
                <p>{t('settings.keybindings.desc')}</p>
                <button type="button" className={styles.reset} onClick={() => {
                    setCapturingBinding(null);
                    setSettings(previous => ({...previous, player: {...previous.player, keybindings: {...defaultPlayerKeybindings}}}));
                }}>{t('misc.reset')}</button>
            </div>
            <div className={styles.list}>
                {groups.map(group => <section key={group.title} className={styles.group}>
                    <h3>{t(group.title)}</h3>
                    {group.actions.map(action => <div className={styles.row} key={action}>
                    <span id={`${id}-${action}`}>{keybindingLabels[action]}</span>
                    <div className={styles.actions}>
                    <button
                        type="button"
                        aria-labelledby={`${id}-${action} ${id}-${action}-value`}
                        className={`${styles.binding} ${capturingBinding === action ? styles.capturing : ''}`}
                        onClick={() => setCapturingBinding(action)}
                        onKeyDown={event => {
                            if (capturingBinding !== action || event.nativeEvent.isComposing || !event.code) return;
                            event.preventDefault();
                            event.stopPropagation();
                            if (event.code === 'Escape') {
                                setCapturingBinding(null);
                                return;
                            }
                            assign(action, event.code);
                        }}
                    ><kbd id={`${id}-${action}-value`}>{capturingBinding === action ? t('settings.keybindings.capture') : formatKey(keybindings[action]) || t('settings.keybindings.unassigned')}</kbd></button>
                    <button type="button" className={styles.iconButton} aria-label={`${t('roadmap.settings.clearKey')}: ${keybindingLabels[action]}`} disabled={!keybindings[action]} onClick={() => assign(action, '')}><ActionIcon name="close" /></button>
                    <button type="button" className={styles.iconButton} aria-label={`${t('roadmap.settings.resetKey')}: ${keybindingLabels[action]}`} onClick={() => assign(action, defaultPlayerKeybindings[action])}><ActionIcon name="reset" /></button>
                    </div>
                </div>)}
                </section>)}
            </div>
        </Modal>
    );
}
