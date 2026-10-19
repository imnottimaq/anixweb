import ToggleSettingsItem from '../components/ToggleSettingsItem'
import { PageHeader, PageLayout } from '../components/PageLayout'
import { useSettings } from '../shared/contexts/settingsContext'
import { useUser } from '../shared/contexts/userContext'
import { useEffect, useId, useState } from 'react'
import { Link } from 'react-router-dom'
import { canUseAnime4KVideo, checkAnime4KVideoSupport, isSafariBrowser } from '../shared/anime4kSupport'
import { useTranslation } from '../shared/useTranslation'
import { defaultCustomColors } from '../shared/types/settings'
import { ACCENT_COLOR_PRESETS, BACKGROUND_COLOR_PRESETS } from '../shared/theme'
import {
    saveAccountSettings,
    loadAccountSettings,
    isAutoSyncAccountEnabled,
    setAutoSyncAccountEnabled,
} from '../shared/cloudSettings'
import { parseImportedSettings, normalizeLegacySettings } from '../shared/settingsNormalizer'
import { getRoomParticipant } from '../shared/roomParticipant'
import FilterModal from '../modals/FilterModal'
import { AnimeListTransfer } from '../components/AnimeListTransfer'
import KeybindingsModal from '../modals/KeybindingsModal'
import type { Filter } from '../shared/types/api'
import styles from './SettingsScreen.module.css'
import { moveTab } from '../shared/discover/tabs'

type SettingsTab = 'appearance' | 'content' | 'player' | 'data';
const SETTINGS_TABS: readonly SettingsTab[] = ['appearance', 'content', 'player', 'data'];

export default function SettingsScreen(){
    const tabGroupId = useId()
    const {settings, setSettings} = useSettings()
    const { userToken, userId } = useUser()
    const { t } = useTranslation()
    const [activeTab, setActiveTab] = useState<SettingsTab>('appearance')
    const [webGpuStatus, setWebGpuStatus] = useState<'checking' | 'supported' | 'unsupported'>(() => (
        canUseAnime4KVideo() ? 'checking' : 'unsupported'
    ));
    const [isKeybindingsModalOpen, setIsKeybindingsModalOpen] = useState(false);
    const [isFilterModalOpen, setIsFilterModalOpen] = useState(false);
    const [myFilters, setMyFilters] = useState<Filter>(() => {
        try {
            const saved = localStorage.getItem('my_filters');
            return saved ? (JSON.parse(saved) as Filter) : {};
        } catch {
            return {};
        }
    });

    const isUserLoggedIn = Boolean(userToken && userId && userId > 0);
    const userProfile = isUserLoggedIn ? getRoomParticipant(userId) : null;

    // Account cloud & server sync state
    const [isAccountSaving, setIsAccountSaving] = useState(false);
    const [isAccountLoading, setIsAccountLoading] = useState(false);
    const [accountSyncStatus, setAccountSyncStatus] = useState<{ message: string; isError: boolean } | null>(null);
    const [autoSyncEnabled, setAutoSyncEnabled] = useState(() => isAutoSyncAccountEnabled());

    // Local backup state
    const [backupStatus, setBackupStatus] = useState<{ message: string; isError: boolean } | null>(null);

    const customColors = settings.appearance.customColors ?? defaultCustomColors;

    const handleSaveAccount = async () => {
        if (!userToken || !userId) return;
        setIsAccountSaving(true);
        setAccountSyncStatus(null);
        try {
            const result = await saveAccountSettings(userToken, userId, settings, myFilters);
            setAccountSyncStatus({
                message: result.serverSaved
                    ? t('settings.accountSync.successSaveServer', { login: userProfile?.login || String(userId) })
                    : t('settings.accountSync.successSave'),
                isError: false,
            });
            setTimeout(() => setAccountSyncStatus(null), 6000);
        } catch {
            setAccountSyncStatus({
                message: t('settings.accountSync.errorSave'),
                isError: true,
            });
            setTimeout(() => setAccountSyncStatus(null), 6000);
        } finally {
            setIsAccountSaving(false);
        }
    };

    const handleLoadAccount = async () => {
        if (!userToken || !userId) return;
        setIsAccountLoading(true);
        setAccountSyncStatus(null);
        try {
            const { payload } = await loadAccountSettings(userToken, userId);
            setSettings(previous => normalizeLegacySettings(payload.settings, previous));

            if (payload.my_filters && typeof payload.my_filters === 'object') {
                localStorage.setItem('my_filters', JSON.stringify(payload.my_filters));
                setMyFilters(payload.my_filters);
            }

            setAccountSyncStatus({
                message: t('settings.accountSync.successLoad'),
                isError: false,
            });
            setTimeout(() => setAccountSyncStatus(null), 5000);
        } catch (error) {
            const isNotFound = error instanceof Error && error.message === 'NO_ACCOUNT_SETTINGS';
            setAccountSyncStatus({
                message: isNotFound
                    ? t('settings.accountSync.notFound')
                    : t('settings.accountSync.errorLoad'),
                isError: true,
            });
            setTimeout(() => setAccountSyncStatus(null), 6000);
        } finally {
            setIsAccountLoading(false);
        }
    };

    const handleToggleAutoSync = () => {
        const next = !autoSyncEnabled;
        setAutoSyncAccountEnabled(next);
        setAutoSyncEnabled(next);
    };

    const handleExportSettings = () => {
        let filters: unknown = null;
        try {
            const savedFilters = localStorage.getItem('my_filters');
            if (savedFilters) filters = JSON.parse(savedFilters);
        } catch {
            filters = null;
        }

        const data = {
            version: 1,
            exportedAt: new Date().toISOString(),
            settings,
            my_filters: filters,
        };

        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `anixweb-settings-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);
        URL.revokeObjectURL(url);
    };

    const handleImportSettings = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = () => {
            try {
                const text = reader.result as string;
                const parsed = JSON.parse(text);
                const payload = parseImportedSettings(parsed, settings);
                setSettings(previous => normalizeLegacySettings(payload.settings, previous));

                if (payload.my_filters && typeof payload.my_filters === 'object') {
                    localStorage.setItem('my_filters', JSON.stringify(payload.my_filters));
                    setMyFilters(payload.my_filters);
                }

                setBackupStatus({ message: t('settings.import.success'), isError: false });
                setTimeout(() => setBackupStatus(null), 4000);
            } catch {
                setBackupStatus({ message: t('settings.import.error'), isError: true });
                setTimeout(() => setBackupStatus(null), 5000);
            }
            event.target.value = '';
        };
        reader.onerror = () => {
            setBackupStatus({ message: t('settings.import.error'), isError: true });
            setTimeout(() => setBackupStatus(null), 5000);
            event.target.value = '';
        };
        reader.readAsText(file);
    };

    const updateAppearance = (appearance: Partial<typeof settings.appearance>) => setSettings(previous => ({
        ...previous,
        appearance: { ...previous.appearance, ...appearance },
    }));

    const updateCustomColors = (colors: Partial<typeof customColors>) => setSettings(previous => ({
        ...previous,
        appearance: {
            ...previous.appearance,
            customColors: {
                ...(previous.appearance.customColors ?? defaultCustomColors),
                ...colors,
            },
        },
    }));

    const updateContent = (content: Partial<typeof settings.content>) => setSettings(previous => ({
        ...previous,
        content: { ...previous.content, ...content },
    }));

    const updatePlayer = (player: Partial<typeof settings.player>) => setSettings(previous => ({
        ...previous,
        player: { ...previous.player, ...player },
    }));

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

    const upscalerWarning = webGpuStatus === 'checking'
        ? t('settings.qualityUpscale.webgpuChecking')
        : webGpuStatus === 'unsupported'
        ? t(isSafariBrowser()
            ? 'settings.qualityUpscale.webgpuSafariNotSupported'
            : 'settings.qualityUpscale.webgpuNotSupported')
        : undefined;

    return (
        <PageLayout>
            <PageHeader title={t('nav.settings')} description={t('settings.description')} />

            <div className={styles['tabs-container']}>
                <div className={styles['tabs']} role="tablist" aria-label={t('nav.settings')}>
                    <button
                        type="button"
                        role="tab"
                        id={`${tabGroupId}-tab-appearance`}
                        aria-controls={`${tabGroupId}-panel`}
                        aria-selected={activeTab === 'appearance'}
                        tabIndex={activeTab === 'appearance' ? 0 : -1}
                        onKeyDown={event => moveTab(event, SETTINGS_TABS, 'appearance', setActiveTab)}
                        className={`${styles['tab-button']} ${activeTab === 'appearance' ? styles.active : ''}`}
                        onClick={() => setActiveTab('appearance')}
                    >
                        {t('settings.tab.appearance')}
                    </button>
                    <button
                        type="button"
                        role="tab"
                        id={`${tabGroupId}-tab-content`}
                        aria-controls={`${tabGroupId}-panel`}
                        aria-selected={activeTab === 'content'}
                        tabIndex={activeTab === 'content' ? 0 : -1}
                        onKeyDown={event => moveTab(event, SETTINGS_TABS, 'content', setActiveTab)}
                        className={`${styles['tab-button']} ${activeTab === 'content' ? styles.active : ''}`}
                        onClick={() => setActiveTab('content')}
                    >
                        {t('settings.tab.content')}
                    </button>
                    <button
                        type="button"
                        role="tab"
                        id={`${tabGroupId}-tab-player`}
                        aria-controls={`${tabGroupId}-panel`}
                        aria-selected={activeTab === 'player'}
                        tabIndex={activeTab === 'player' ? 0 : -1}
                        onKeyDown={event => moveTab(event, SETTINGS_TABS, 'player', setActiveTab)}
                        className={`${styles['tab-button']} ${activeTab === 'player' ? styles.active : ''}`}
                        onClick={() => setActiveTab('player')}
                    >
                        {t('settings.tab.player')}
                    </button>
                    <button
                        type="button"
                        role="tab"
                        id={`${tabGroupId}-tab-data`}
                        aria-controls={`${tabGroupId}-panel`}
                        aria-selected={activeTab === 'data'}
                        tabIndex={activeTab === 'data' ? 0 : -1}
                        onKeyDown={event => moveTab(event, SETTINGS_TABS, 'data', setActiveTab)}
                        className={`${styles['tab-button']} ${activeTab === 'data' ? styles.active : ''}`}
                        onClick={() => setActiveTab('data')}
                    >
                        {t('settings.tab.data')}
                    </button>
                </div>
            </div>

            <div className={styles['content']} role="tabpanel" id={`${tabGroupId}-panel`} aria-labelledby={`${tabGroupId}-tab-${activeTab}`} tabIndex={0}>
                {activeTab === 'appearance' && (
                    <section className={styles['settings-section-tab']}>
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

                        <div className={styles['settings-item']}>
                            <div className={styles['setting-copy']}>
                                <h2>{t('settings.theme')}</h2>
                                <p>{t('settings.theme.desc')}</p>
                            </div>
                            <div className={styles['select']}>
                                <button
                                    type="button"
                                    className={settings.appearance.theme === 'system' ? styles.active : ''}
                                    onClick={() => updateAppearance({ theme: 'system' })}
                                >
                                    {t('settings.theme.system')}
                                </button>
                                <button
                                    type="button"
                                    className={settings.appearance.theme === 'dark' ? styles.active : ''}
                                    onClick={() => updateAppearance({ theme: 'dark' })}
                                >
                                    {t('settings.theme.dark')}
                                </button>
                                <button
                                    type="button"
                                    className={settings.appearance.theme === 'light' ? styles.active : ''}
                                    onClick={() => updateAppearance({ theme: 'light' })}
                                >
                                    {t('settings.theme.light')}
                                </button>
                            </div>
                        </div>

                        <ToggleSettingsItem
                            title={t('settings.highContrast')}
                            desc={t('settings.highContrast.desc')}
                            checked={Boolean(settings.appearance.highContrast)}
                            onChange={highContrast => updateAppearance({ highContrast })}
                        />

                        <ToggleSettingsItem
                            title={t('settings.compactMode')}
                            desc={t('settings.compactMode.desc')}
                            checked={Boolean(settings.appearance.compactMode)}
                            onChange={compactMode => updateAppearance({ compactMode })}
                        />

                        <ToggleSettingsItem
                            title={t('settings.customColors')}
                            desc={t('settings.customColors.desc')}
                            checked={Boolean(settings.appearance.customColors?.enabled)}
                            onChange={enabled => updateCustomColors({ enabled })}
                        />

                        {settings.appearance.customColors?.enabled && (
                            <div className={styles['custom-colors-container']}>
                                <div className={styles['color-setting-item']}>
                                    <div className={styles['setting-copy']}>
                                        <h2>{t('settings.customColors.accent')}</h2>
                                        <p>{t('settings.customColors.accentDesc')}</p>
                                    </div>
                                    <div className={styles['color-picker-group']}>
                                        <div className={styles['swatches']}>
                                            {ACCENT_COLOR_PRESETS.map(preset => (
                                                <button
                                                    key={preset.color}
                                                    type="button"
                                                    className={`${styles['swatch']} ${customColors.accentColor.toLowerCase() === preset.color.toLowerCase() ? styles['swatch-active'] : ''}`}
                                                    style={{ backgroundColor: preset.color }}
                                                    title={preset.label}
                                                    onClick={() => updateCustomColors({ accentColor: preset.color })}
                                                />
                                            ))}
                                        </div>
                                        <div className={styles['color-input-wrapper']}>
                                            <input
                                                type="color"
                                                className={styles['color-input']}
                                                value={customColors.accentColor}
                                                onChange={e => updateCustomColors({ accentColor: e.target.value })}
                                                aria-label={t('settings.customColors.accent')}
                                            />
                                            <input
                                                type="text"
                                                className={styles['hex-input']}
                                                value={customColors.accentColor}
                                                maxLength={7}
                                                onChange={e => {
                                                    const val = e.target.value;
                                                    if (/^#[0-9a-fA-F]{0,6}$/.test(val)) {
                                                        updateCustomColors({ accentColor: val });
                                                    }
                                                }}
                                            />
                                        </div>
                                    </div>
                                </div>

                                <div className={styles['color-setting-item']}>
                                    <div className={styles['setting-copy']}>
                                        <h2>{t('settings.customColors.background')}</h2>
                                        <p>{t('settings.customColors.backgroundDesc')}</p>
                                    </div>
                                    <div className={styles['color-picker-group']}>
                                        <div className={styles['swatches']}>
                                            {BACKGROUND_COLOR_PRESETS.map(preset => (
                                                <button
                                                    key={preset.color}
                                                    type="button"
                                                    className={`${styles['swatch']} ${customColors.backgroundColor.toLowerCase() === preset.color.toLowerCase() ? styles['swatch-active'] : ''}`}
                                                    style={{ backgroundColor: preset.color }}
                                                    title={preset.label}
                                                    onClick={() => updateCustomColors({ backgroundColor: preset.color })}
                                                />
                                            ))}
                                        </div>
                                        <div className={styles['color-input-wrapper']}>
                                            <input
                                                type="color"
                                                className={styles['color-input']}
                                                value={customColors.backgroundColor}
                                                onChange={e => updateCustomColors({ backgroundColor: e.target.value })}
                                                aria-label={t('settings.customColors.background')}
                                            />
                                            <input
                                                type="text"
                                                className={styles['hex-input']}
                                                value={customColors.backgroundColor}
                                                maxLength={7}
                                                onChange={e => {
                                                    const val = e.target.value;
                                                    if (/^#[0-9a-fA-F]{0,6}$/.test(val)) {
                                                        updateCustomColors({ backgroundColor: val });
                                                    }
                                                }}
                                            />
                                        </div>
                                    </div>
                                </div>

                                <div className={styles['color-setting-item']}>
                                    <div className={styles['setting-copy']}>
                                        <h2>{t('settings.customColors.autoText')}</h2>
                                        <p>{t('settings.customColors.autoTextDesc')}</p>
                                    </div>
                                    <div className={styles['select']}>
                                        <button
                                            type="button"
                                            className={customColors.autoTextColor ? styles.active : ''}
                                            onClick={() => updateCustomColors({ autoTextColor: true })}
                                        >
                                            {t('misc.apply')}
                                        </button>
                                        <button
                                            type="button"
                                            className={!customColors.autoTextColor ? styles.active : ''}
                                            onClick={() => updateCustomColors({ autoTextColor: false })}
                                        >
                                            {t('settings.customColors.textColor')}
                                        </button>
                                    </div>
                                </div>

                                {!customColors.autoTextColor && (
                                    <div className={styles['color-setting-item']}>
                                        <div className={styles['setting-copy']}>
                                            <h2>{t('settings.customColors.textColor')}</h2>
                                            <p>{t('settings.customColors.textColorDesc')}</p>
                                        </div>
                                        <div className={styles['color-input-wrapper']}>
                                            <input
                                                type="color"
                                                className={styles['color-input']}
                                                value={customColors.textColor}
                                                onChange={e => updateCustomColors({ textColor: e.target.value })}
                                                aria-label={t('settings.customColors.textColor')}
                                            />
                                            <input
                                                type="text"
                                                className={styles['hex-input']}
                                                value={customColors.textColor}
                                                maxLength={7}
                                                onChange={e => {
                                                    const val = e.target.value;
                                                    if (/^#[0-9a-fA-F]{0,6}$/.test(val)) {
                                                        updateCustomColors({ textColor: val });
                                                    }
                                                }}
                                            />
                                        </div>
                                    </div>
                                )}

                                <div className={styles['color-reset-row']}>
                                    <button
                                        type="button"
                                        className={styles['action-button']}
                                        onClick={() => updateCustomColors(defaultCustomColors)}
                                    >
                                        {t('settings.customColors.reset')}
                                    </button>
                                </div>
                            </div>
                        )}

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
                    </section>
                )}

                {activeTab === 'content' && (
                    <section className={styles['settings-section-tab']}>
                        <h2 className={styles.sectionTitle}>{t('settings.content')}</h2>
                        <label className={styles['select-setting']}>
                            <span><strong>{t('settings.startPage')}</strong><small>{t('settings.startPage.desc')}</small></span>
                            <select value={settings.content.defaultTabOnHome} onChange={event => updateContent({ defaultTabOnHome: event.target.value as typeof settings.content.defaultTabOnHome })}>
                                <option value="donghua">{t('home.donghua')}</option>
                                <option value="latest">{t('home.latest')}</option><option value="my">{t('home.my')}</option><option value="ongoing">{t('home.ongoing')}</option><option value="announced">{t('home.announced')}</option><option value="finished">{t('home.completed')}</option><option value="films">{t('home.films')}</option>
                            </select>
                        </label>
                        <label className={styles['select-setting']}>
                            <span><strong>{t('roadmap.settings.favoriteStart')}</strong><small>{t('roadmap.settings.favoriteStartHint')}</small></span>
                            <select aria-label={t('roadmap.settings.favoriteStart')} value={settings.content.defaultTabOnFavorites} onChange={event => updateContent({defaultTabOnFavorites: event.target.value as typeof settings.content.defaultTabOnFavorites})}>
                                <option value="favorites">{t('nav.favorites')}</option>
                                <option value="collections">{t('nav.collections')}</option>
                                <option value="history">{t('home.history')}</option>
                                <option value="watching">{t('status.watching')}</option>
                                <option value="planned">{t('status.planned')}</option>
                                <option value="completed">{t('status.watched')}</option>
                                <option value="hold_on">{t('status.hold_on')}</option>
                                <option value="dropped">{t('status.dropped')}</option>
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
                        <div className={styles['action-setting']}>
                            <span><strong>{t('settings.myFilters')}</strong><small>{t('settings.myFilters.desc')}</small></span>
                            <button type="button" className={styles['action-button']} onClick={() => setIsFilterModalOpen(true)}>
                                {t('settings.myFilters.button')}
                            </button>
                        </div>
                    </section>
                )}

                {activeTab === 'player' && (
                    <section className={styles['settings-section-tab']}>
                        <h2 className={styles.sectionTitle}>{t('settings.player')}</h2>
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
                            tooltip={upscalerWarning}
                            onChange={qualityUpgrade => updatePlayer({ qualityUpgrade })}
                        />
                        <label className={styles['select-setting']}>
                            <span><strong>{t('settings.upscalerMode')}</strong><small>{t('settings.upscalerMode.desc')}</small></span>
                            <select disabled={webGpuStatus !== 'supported'} title={upscalerWarning} value={settings.player.qualityUpgradeMode} onChange={event => updatePlayer({ qualityUpgradeMode: event.target.value as typeof settings.player.qualityUpgradeMode })}>
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
                        <ToggleSettingsItem
                            title={t('settings.autoFullscreen')}
                            desc={t('settings.autoFullscreen.desc')}
                            checked={settings.player.autoFullscreen}
                            onChange={autoFullscreen => updatePlayer({ autoFullscreen })}
                        />
                        <ToggleSettingsItem
                            title={t('settings.autoPauseOnTabSwitch')}
                            desc={t('settings.autoPauseOnTabSwitch.desc')}
                            checked={settings.player.autoPauseOnTabSwitch}
                            onChange={autoPauseOnTabSwitch => updatePlayer({ autoPauseOnTabSwitch })}
                        />
                        <div className={styles['keybindings-setting']}>
                            <div className={styles['keybindings-heading']}>
                                <span><strong>{t('settings.keybindings')}</strong><small>{t('settings.keybindings.desc')}</small></span>
                                <button type="button" aria-haspopup="dialog" onClick={() => setIsKeybindingsModalOpen(true)}>{t('settings.keybindings.configure')}</button>
                            </div>

                        </div>
                    </section>
                )}

                {activeTab === 'data' && (
                    <section className={styles['settings-section-tab']}>
                        <h2 className={styles.sectionTitle}>{t('settings.tab.data')}</h2>
                        <AnimeListTransfer />

                        {/* Account Cloud & Server Sync Card */}
                        <div className={styles['cloud-card']}>
                            <div className={styles['cloud-header']}>
                                <h3>{t('settings.accountSync')}</h3>
                                <p>{t('settings.accountSync.desc')}</p>
                            </div>

                            {isUserLoggedIn ? (
                                <>
                                    <div className={styles['cloud-actions-row']}>
                                        <div className={styles['account-sync-badge']}>
                                            <span aria-hidden="true">
                                                <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor">
                                                    <circle cx="4" cy="4" r="3.5" />
                                                </svg>
                                            </span>
                                            {t('settings.accountSync.profile', {
                                                login: userProfile?.login || 'User',
                                                id: String(userId),
                                            })}
                                        </div>

                                        <div className={styles['cloud-actions']}>
                                            <button
                                                type="button"
                                                className={styles['action-button']}
                                                disabled={isAccountSaving}
                                                onClick={handleSaveAccount}
                                            >
                                                {isAccountSaving ? t('settings.accountSync.saving') : t('settings.accountSync.save')}
                                            </button>

                                            <button
                                                type="button"
                                                className={styles['action-button']}
                                                disabled={isAccountLoading}
                                                onClick={handleLoadAccount}
                                            >
                                                {isAccountLoading ? t('settings.accountSync.loading') : t('settings.accountSync.load')}
                                            </button>
                                        </div>
                                    </div>

                                    <div className={styles['auto-sync-toggle']}>
                                        <span>
                                            <strong>{t('settings.accountSync.autoSync')}</strong>
                                            <small>{t('settings.accountSync.autoSyncDesc')}</small>
                                        </span>
                                        <label className={styles['switch']}>
                                            <input
                                                type="checkbox"
                                                checked={autoSyncEnabled}
                                                onChange={handleToggleAutoSync}
                                            />
                                            <span className={styles['slider']} />
                                        </label>
                                    </div>
                                </>
                            ) : (
                                <div className={styles['account-not-logged']}>
                                    <p>{t('settings.accountSync.notLoggedIn')}</p>
                                    <Link to="/account/login" className={styles['action-button']}>
                                        {t('settings.accountSync.loginButton')}
                                    </Link>
                                </div>
                            )}

                            {accountSyncStatus && (
                                <div className={accountSyncStatus.isError ? styles['status-error'] : styles['status-success']} role={accountSyncStatus.isError ? 'alert' : 'status'}>
                                    {accountSyncStatus.message}
                                </div>
                            )}
                        </div>

                        {/* Local Backup Section */}
                        <div className={styles['settings-section']}>
                            <h2 className={styles.sectionTitle}>{t('settings.backup')}</h2>
                            <div className={styles['action-setting']}>
                                <span><strong>{t('settings.export')}</strong><small>{t('settings.export.desc')}</small></span>
                                <button type="button" className={styles['action-button']} onClick={handleExportSettings}>
                                    {t('settings.export.button')}
                                </button>
                            </div>
                            <div className={styles['action-setting']}>
                                <span><strong>{t('settings.import')}</strong><small>{t('settings.import.desc')}</small></span>
                                <label className={styles['import-label']}>
                                    <span>{t('settings.import.button')}</span>
                                    <input data-testid="settings-backup-file" type="file" accept=".json,application/json" onChange={handleImportSettings} style={{ display: 'none' }} />
                                </label>
                            </div>
                            {backupStatus && (
                                <div className={backupStatus.isError ? styles['status-error'] : styles['status-success']} role={backupStatus.isError ? 'alert' : 'status'}>
                                    {backupStatus.message}
                                </div>
                            )}
                        </div>
                    </section>
                )}
            </div>

            {isKeybindingsModalOpen && <KeybindingsModal onClose={() => setIsKeybindingsModalOpen(false)} />}

            <FilterModal
                isOpen={isFilterModalOpen}
                onClose={() => setIsFilterModalOpen(false)}
                filter={myFilters}
                setFilter={filter => {
                    setMyFilters(filter);
                    localStorage.setItem('my_filters', JSON.stringify(filter));
                }}
            />
        </PageLayout>
    )
}
