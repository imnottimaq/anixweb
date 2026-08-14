import ToggleSettingsItem from '../components/ToggleSettingsItem'
import { PageHeader, PageLayout } from '../components/PageLayout'
import { useSettings } from '../shared/contexts/settingsContext'
import { useEffect, useState } from 'react'
import { canUseAnime4KVideo, checkAnime4KVideoSupport, isSafariBrowser } from '../shared/anime4kSupport'
import { useTranslation } from '../shared/useTranslation'
import { defaultPlayerKeybindings, playerKeybindingActions, type PlayerKeybindingAction } from '../shared/types/settings'
import styles from './SettingsScreen.module.css'

export default function SettingsScreen(){
    const {settings, setSettings} = useSettings()
    const { t } = useTranslation()
    const [webGpuStatus, setWebGpuStatus] = useState<'checking' | 'supported' | 'unsupported'>(() => (
        canUseAnime4KVideo() ? 'checking' : 'unsupported'
    ));
    const [capturingBinding, setCapturingBinding] = useState<PlayerKeybindingAction | null>(null);
    const keybindings = settings.player.keybindings ?? defaultPlayerKeybindings;
    const updateAppearance = (appearance: Partial<typeof settings.appearance>) => setSettings(previous => ({
        ...previous,
        appearance: { ...previous.appearance, ...appearance },
    }));
    const updateContent = (content: Partial<typeof settings.content>) => setSettings(previous => ({
        ...previous,
        content: { ...previous.content, ...content },
    }));
    const updatePlayer = (player: Partial<typeof settings.player>) => setSettings(previous => ({
        ...previous,
        player: { ...previous.player, ...player },
    }));
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

    useEffect(() => {
        let isCancelled = false;
        if (!canUseAnime4KVideo()) return;

        void checkAnime4KVideoSupport()
            .then(isSupported => {
                if (!isCancelled) setWebGpuStatus(isSupported ? 'supported' : 'unsupported');
            })
            .catch(() => {
                if (!isCancelled) setWebGpuStatus('unsupported');
            });

        return () => { isCancelled = true; };
    }, []);

    return (
        <PageLayout>
            <PageHeader title={t('nav.settings')} description={t('settings.description')} />
            <div className={styles['content']}>
                <h2 className={styles.sectionTitle}>{t('settings.appearance')}</h2>
                <div className={styles['settings-item']}>
                    <div className={styles['setting-copy']}>
                        <h2>{t('settings.language')}</h2>
                        <p>{t('settings.language.desc')}</p>
                    </div>
                    <div className={styles['select']}>
                        <button type="button" className={settings.appearance.language === 'russian' ? styles.active : ''} onClick={() => updateAppearance({ language: 'russian' })}>{t('settings.language.russian')}</button>
                        <button type="button" className={settings.appearance.language === 'english' ? styles.active : ''} onClick={() => updateAppearance({ language: 'english' })}>{t('settings.language.english')}</button>
                    </div>
                   
                </div>
                <ToggleSettingsItem title={t('settings.darkTheme')} 
                desc={t('settings.darkTheme.desc')}
                checked={settings.appearance.theme === 'dark'}
                onChange={checked => updateAppearance({ theme: checked ? 'dark' : 'light' })}/>
                <section className={styles['card-type-section']}>
                    <h2>{t('settings.cardType')}</h2>
                    <div className={styles['card-type-select']}>
                        <button
                            type="button"
                            className={settings.appearance.defaultCardType === 'horizontal' ? styles.active : ''}
                            onClick={() => updateAppearance({ defaultCardType: 'horizontal' })}
                        >
                            <span className={styles['list-preview']} aria-hidden="true">
                                <i /><i /><i /><i />
                            </span>
                            <span>{t('settings.cardType.horizontal')}</span>
                        </button>

                        <button
                            type="button"
                            className={settings.appearance.defaultCardType === 'vertical' ? styles.active : ''}
                            onClick={() => updateAppearance({ defaultCardType: 'vertical' })}
                        >
                            <span className={styles['grid-preview']} aria-hidden="true">
                                <i /><i /><i /><i />
                            </span>
                            <span>{t('settings.cardType.vertical')}</span>
                        </button>
                    </div>
                </section>

                <section className={styles['settings-section']}>
                    <h1>{t('settings.content')}</h1>
                    <label className={styles['select-setting']}>
                        <span><strong>{t('settings.startPage')}</strong><small>{t('settings.startPage.desc')}</small></span>
                        <select value={settings.content.defaultTabOnHome} onChange={event => updateContent({ defaultTabOnHome: event.target.value as typeof settings.content.defaultTabOnHome })}>
                            <option value="latest">{t('home.latest')}</option><option value="my">{t('home.my')}</option><option value="ongoing">{t('home.ongoing')}</option><option value="announced">{t('home.announced')}</option><option value="finished">{t('home.completed')}</option><option value="films">{t('home.films')}</option>
                        </select>
                    </label>
                    <ToggleSettingsItem title={t('settings.rememberDub')} desc={t('settings.rememberDub.desc')} checked={settings.content.rememberDub} onChange={rememberDub => updateContent({ rememberDub })}/>
                    <ToggleSettingsItem title={t('settings.rememberSource')} desc={t('settings.rememberSource.desc')} checked={settings.content.rememberSource} onChange={rememberSource => updateContent({ rememberSource })}/>
                    <ToggleSettingsItem title={t('settings.rememberTime')} desc={t('settings.rememberTime.desc')} checked={settings.content.rememberEpisodeTime} onChange={rememberEpisodeTime => updateContent({ rememberEpisodeTime })}/>
                    <ToggleSettingsItem
                        title={t('settings.proxySearch')}
                        desc={t('settings.proxySearch.desc')}
                        checked={settings.content.proxySearchThroughShikimori}
                        onChange={proxySearchThroughShikimori => updateContent({ proxySearchThroughShikimori })}
                    />
                    <ToggleSettingsItem
                        title={t('settings.proxyImages')}
                        desc={t('settings.proxyImages.desc')}
                        checked={settings.content.proxyImages}
                        onChange={proxyImages => updateContent({ proxyImages })}
                    />
                </section>

                <section className={styles['settings-section']}>
                    <h1>{t('settings.player')}</h1>
                    <label className={styles['select-setting']}>
                        <span><strong>{t('settings.defaultQuality')}</strong><small>{t('settings.defaultQuality.desc')}</small></span>
                        <select value={settings.player.defaultQuality} onChange={event => updatePlayer({ defaultQuality: event.target.value as typeof settings.player.defaultQuality })}>
                            <option value="auto">{t('player.autoQuality')}</option><option value="1080">1080p</option><option value="720">720p</option><option value="480">480p</option><option value="360">360p</option>
                        </select>
                    </label>
                    <label className={styles['range-setting']}>
                        <span><strong>{t('settings.volume')}</strong><small>{t('settings.volume.desc')}</small></span>
                        <div className={styles['range-control']}>
                            <input type="range" min="0" max="100" value={settings.player.volume} onChange={event => updatePlayer({ volume: Number(event.target.value) })}/>
                            <input className={styles['number-input']} type="number" min="0" max="100" value={settings.player.volume} onChange={event => updatePlayer({ volume: Math.min(100, Math.max(0, Number(event.target.value) || 0)) })}/>
                        </div>
                    </label>
                    <ToggleSettingsItem title={t('settings.autoplay')} desc={t('settings.autoplay.desc')} checked={settings.player.autoplay} onChange={autoplay => updatePlayer({ autoplay })}/>
                    <ToggleSettingsItem
                        title={t('settings.qualityUpscale')}
                        desc={t('settings.qualityUpscale.desc')}
                        checked={settings.player.qualityUpgrade}
                        disabled={webGpuStatus !== 'supported'}
                        onChange={qualityUpgrade => updatePlayer({ qualityUpgrade })}
                    />
                    <p className={`${styles['webgpu-status']} ${styles[`webgpu-${webGpuStatus}`]}`}>
                        {webGpuStatus === 'checking' && t('settings.qualityUpscale.webgpuChecking')}
                        {webGpuStatus === 'supported' && t('settings.qualityUpscale.webgpuSupported')}
                        {webGpuStatus === 'unsupported' && t(isSafariBrowser()
                            ? 'settings.qualityUpscale.webgpuSafariNotSupported'
                            : 'settings.qualityUpscale.webgpuNotSupported')}
                    </p>
                    <label className={styles['select-setting']}>
                        <span><strong>{t('settings.upscalerMode')}</strong><small>{t('settings.upscalerMode.desc')}</small></span>
                        <select disabled={webGpuStatus !== 'supported'} value={settings.player.qualityUpgradeMode} onChange={event => updatePlayer({ qualityUpgradeMode: event.target.value as typeof settings.player.qualityUpgradeMode })}>
                            <option value="weak">{t('settings.upscalerMode.modeLow')}</option>
                            <option value="medium">{t('settings.upscalerMode.modeMedium')}</option>
                            <option value="strong">{t('settings.upscalerMode.modeHigh')}</option>
                        </select>
                    </label>
                    <ToggleSettingsItem title={t('settings.skipOpeningButton')} desc={t('settings.skipOpeningButton.desc')} checked={settings.player.showSkipOpeningButton} onChange={showSkipOpeningButton => updatePlayer({ showSkipOpeningButton })}/>
                    <label className={styles['range-setting']}>
                        <span><strong>{t('settings.skipTime')}</strong><small>{t('settings.skipTime.desc')}</small></span>
                        <div className={styles['range-control']}>
                            <input type="range" min="5" max="180" step="1" disabled={!settings.player.showSkipOpeningButton} value={settings.player.skipOpeningValue} onChange={event => updatePlayer({ skipOpeningValue: Number(event.target.value) })}/>
                            <input className={styles['number-input']} type="number" min="5" max="180" disabled={!settings.player.showSkipOpeningButton} value={settings.player.skipOpeningValue} onChange={event => updatePlayer({ skipOpeningValue: Math.min(180, Math.max(5, Number(event.target.value) || 5)) })}/>
                        </div>
                    </label>
                    <div className={styles['keybindings-setting']}>
                        <div className={styles['keybindings-heading']}>
                            <span><strong>{t('settings.keybindings')}</strong><small>{t('settings.keybindings.desc')}</small></span>
                            <button type="button" onClick={() => updatePlayer({ keybindings: { ...defaultPlayerKeybindings } })}>{t('misc.reset')}</button>
                        </div>
                        <div className={styles['keybindings-list']}>
                            {playerKeybindingActions.map(action => <div className={styles['keybinding-row']} key={action}>
                                <span>{keybindingLabels[action]}</span>
                                <button
                                    type="button"
                                    className={capturingBinding === action ? styles['keybinding-capturing'] : ''}
                                    onClick={() => setCapturingBinding(action)}
                                    onKeyDown={event => {
                                        if (capturingBinding !== action) return;
                                        event.preventDefault();
                                        if (event.code === 'Escape') {
                                            setCapturingBinding(null);
                                            return;
                                        }
                                        setSettings(previous => {
                                            const keybindings = { ...defaultPlayerKeybindings, ...previous.player.keybindings };
                                            playerKeybindingActions.forEach(otherAction => {
                                                if (otherAction !== action && keybindings[otherAction] === event.code) keybindings[otherAction] = '';
                                            });
                                            keybindings[action] = event.code;
                                            return { ...previous, player: { ...previous.player, keybindings } };
                                        });
                                        setCapturingBinding(null);
                                    }}
                                >{capturingBinding === action ? t('settings.keybindings.capture') : formatKey(keybindings[action]) || t('settings.keybindings.unassigned')}</button>
                            </div>)}
                        </div>
                    </div>
                </section>
            </div>
        </PageLayout>
    )
}
