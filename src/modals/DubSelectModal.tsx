import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import styles from './DubSelectModal.module.css';
import { extractVideoLinks } from '../utils/LinkParser';
import type { VideoSources } from '../shared/types/video';
import type { PlayerSessionEpisode } from '../shared/playerSession';
import EyeIcon from '../assets/icons/eye.svg';
import { clearWatchProgress, getWatchProgress } from '../shared/watchProgress';
import { Modal } from './ModalTemplate';
import { useSettings } from '../shared/contexts/settingsContext';
import { useTranslation } from '../shared/useTranslation';
import { useApi } from '../shared/apiClient';

interface DubSelectModalProps {
    isOpen: boolean;
    onClose: () => void;
    releaseId: number;
    token: string;
    resolveSources?: boolean;
    autoSelect?: { dubId: number; sourceId: number; episode: number } | null;
    onEpisodeSelect: (sources: VideoSources, episode: PlayerSessionEpisode, episodes: PlayerSessionEpisode[], sourceId: number, dubId: number) => void;
}

export interface Dub {
    id: number;
    name: string;
    episodes_count: number;
    view_count: number;
}

interface Source {
    id: number;
    name: string;
    episodes_count: number;
}

interface Episode {
    name: string;
    url: string;
    is_watched: boolean;
    position: number;
}

function formatProgressTime(seconds: number) {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = String(seconds % 60).padStart(2, '0');

    return `${String(minutes).padStart(2, '0')}:${remainingSeconds}`;
}

export default function DubSelectModal({
    isOpen,
    onClose,
    releaseId,
    token,
    autoSelect,
    resolveSources = true,
    onEpisodeSelect,
}: DubSelectModalProps) {
    const { settings, setSettings } = useSettings();
    const api = useApi();
    const { t } = useTranslation();

    const [dubsData, setDubsData] = useState<Dub[]>([]);
    const [sourcesData, setSourcesData] = useState<Source[]>([]);
    const [episodesData, setEpisodesData] = useState<Episode[]>([]);
    const [selectedDub, setSelectedDub] = useState(0);
    const [selectedSource, setSelectedSource] = useState(0);
    const [isDubsLoading, setIsDubsLoading] = useState(false);
    const [isSourcesLoading, setIsSourcesLoading] = useState(false);
    const [isEpisodesLoading, setIsEpisodesLoading] = useState(false);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [filterQuery, setFilterQuery] = useState('');
    const [focusedEpisodeIndex, setFocusedEpisodeIndex] = useState(-1);
    const [isSelecting, setIsSelecting] = useState(false);
    const selectionRef = useRef<{ id: number; controller: AbortController } | null>(null);
    const selectionGenerationRef = useRef(0);
    const invalidateSelection = useCallback(() => {
        selectionGenerationRef.current++;
        selectionRef.current?.controller.abort();
        selectionRef.current = null;
        setIsSelecting(false);
        setFocusedEpisodeIndex(-1);
    }, []);

    const [episodeToUnwatch, setEpisodeToUnwatch] = useState<Episode | null>(null);
    const autoSelectedRef = useRef<string | null>(null);
    const dubsRequestRef = useRef(0);
    const sourcesRequestRef = useRef(0);
    const episodesRequestRef = useRef(0);
    const activeEpisodeRef = useRef<HTMLButtonElement | null>(null);
    const episodeListRef = useRef<HTMLDivElement | null>(null);
    const episodeProgress = getWatchProgress()[String(releaseId)] ?? {};

    const autoDubId = autoSelect?.dubId;
    const autoSrcId = autoSelect?.sourceId;
    const autoEpNumber = autoSelect?.episode;

    const loadEpisodes = useCallback((relId: number, dubId: number, srcId: number) => {
        invalidateSelection();
        const requestId = ++episodesRequestRef.current;
        setIsEpisodesLoading(true);
        setLoadError(null);
        setEpisodesData([]);

        GetEpisodes(api, relId, dubId, srcId)
            .then(data => {
                if (requestId === episodesRequestRef.current) {
                    setEpisodesData(data.episodes || []);
                }
            })
            .catch(err => {
                if (requestId === episodesRequestRef.current) {
                    console.error(err);
                    setLoadError(t('roadmap.player.pickerError') || 'Не удалось загрузить список серий');
                }
            })
            .finally(() => {
                if (requestId === episodesRequestRef.current) setIsEpisodesLoading(false);
            });
    }, [api, t, invalidateSelection]);

    const loadSources = useCallback((relId: number, dubId: number) => {
        invalidateSelection();
        const requestId = ++sourcesRequestRef.current;
        episodesRequestRef.current += 1;
        setIsSourcesLoading(true);
        setIsEpisodesLoading(false);
        setLoadError(null);
        setSourcesData([]);
        setEpisodesData([]);

        GetSources(api, relId, dubId)
            .then(data => {
                if (requestId !== sourcesRequestRef.current) return;
                const sources: Source[] = data.sources || [];
                setSourcesData(sources);

                if (sources.length > 0) {
                    const roomSource = autoSrcId ? sources.find(source => source.id === autoSrcId) : undefined;
                    const rememberedSource = settings.content.rememberSource
                        ? sources.find(source => source.id === settings.content.rememberedSourceId)
                        : undefined;
                    const sourceId = roomSource?.id ?? rememberedSource?.id ?? sources[0].id;
                    setSelectedSource(sourceId);
                    loadEpisodes(relId, dubId, sourceId);
                } else {
                    setSelectedSource(0);
                }
            })
            .catch(err => {
                if (requestId === sourcesRequestRef.current) {
                    console.error(err);
                    setLoadError(t('roadmap.player.pickerError') || 'Не удалось загрузить источники');
                }
            })
            .finally(() => {
                if (requestId === sourcesRequestRef.current) setIsSourcesLoading(false);
            });
    }, [api, autoSrcId, invalidateSelection, loadEpisodes, settings.content.rememberSource, settings.content.rememberedSourceId, t]);

    const loadDubs = useCallback(() => {
        invalidateSelection();
        sourcesRequestRef.current++;
        episodesRequestRef.current++;
        setEpisodesData([]);
        const requestId = ++dubsRequestRef.current;
        setIsDubsLoading(true);
        setLoadError(null);

        GetDubs(api, releaseId)
            .then(data => {
                if (requestId !== dubsRequestRef.current) return;
                const dubs: Dub[] = data.types || [];
                setDubsData(dubs);

                if (dubs.length > 0) {
                    const roomDub = autoDubId ? dubs.find(dub => dub.id === autoDubId) : undefined;
                    const rememberedDub = settings.content.rememberDub
                        ? dubs.find(dub => dub.id === settings.content.rememberedDubId)
                        : undefined;
                    const dubId = roomDub?.id ?? rememberedDub?.id ?? dubs[0].id;
                    setSelectedDub(dubId);
                    loadSources(releaseId, dubId);
                } else {
                    setSelectedDub(0);
                }
            })
            .catch(err => {
                if (requestId === dubsRequestRef.current) {
                    console.error(err);
                    setLoadError(t('roadmap.player.pickerError') || 'Не удалось загрузить список озвучек');
                }
            })
            .finally(() => {
                if (requestId === dubsRequestRef.current) setIsDubsLoading(false);
            });
    }, [api, autoDubId, invalidateSelection, loadSources, releaseId, settings.content.rememberDub, settings.content.rememberedDubId, t]);

    useEffect(() => {
        if (!isOpen) {
            // Closing a controlled modal resets its transient selection state.
            // eslint-disable-next-line react-hooks/set-state-in-effect
            invalidateSelection();
            dubsRequestRef.current += 1;
            sourcesRequestRef.current += 1;
            episodesRequestRef.current += 1;
            autoSelectedRef.current = null;
            setFilterQuery('');
            setFocusedEpisodeIndex(-1);
            return;
        }

        loadDubs();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, releaseId]);

    useEffect(() => () => {
        selectionGenerationRef.current++;
        selectionRef.current?.controller.abort();
        selectionRef.current = null;
        dubsRequestRef.current++; sourcesRequestRef.current++; episodesRequestRef.current++;
    }, [releaseId]);

    const selectEpisode = useCallback(async (episode: Episode, shouldMarkWatched: boolean) => {
        if (!isOpen || selectionRef.current || isDubsLoading || isSourcesLoading || isEpisodesLoading || loadError) return;
        const id = ++selectionGenerationRef.current;
        const controller = new AbortController();
        selectionRef.current = { id, controller };
        setIsSelecting(true);
        const sourceId = selectedSource;
        const dubId = selectedDub;
        const episodes = episodesData.map(({ name, position, url }) => ({ name, position, url }));
        try {
        const sources = resolveSources ? await extractVideoLinks(episode.url, controller.signal) : {};
        if (controller.signal.aborted || id !== selectionGenerationRef.current) return;
        if (!sources) throw new Error('Не удалось получить ссылки на видео');
        if (resolveSources && shouldMarkWatched && token) await SetWatched(api, releaseId, sourceId, episode.position);
        if (controller.signal.aborted || id !== selectionGenerationRef.current) return;
        onEpisodeSelect(sources, {
            name: episode.name,
            position: episode.position,
            url: episode.url,
        }, episodes, sourceId, dubId);
        } finally {
            if (selectionRef.current?.id === id) { selectionRef.current = null; setIsSelecting(false); }
        }
    }, [api, episodesData, isDubsLoading, isEpisodesLoading, isOpen, isSourcesLoading, loadError, onEpisodeSelect, releaseId, resolveSources, selectedDub, selectedSource, token]);

    useEffect(() => {
        if (!isOpen || isDubsLoading || isSourcesLoading || isEpisodesLoading || loadError || autoDubId === undefined || autoSrcId === undefined || autoEpNumber === undefined) return;
        if (selectedDub !== autoDubId || selectedSource !== autoSrcId) return;
        const episode = episodesData.find(item => item.position === autoEpNumber);
        const key = `${releaseId}:${autoDubId}:${autoSrcId}:${autoEpNumber}`;
        if (!episode || autoSelectedRef.current === key) return;
        autoSelectedRef.current = key;
        void selectEpisode(episode, false).catch(error => console.error('Не удалось открыть серию комнаты:', error));
    }, [autoDubId, autoEpNumber, autoSrcId, episodesData, isDubsLoading, isEpisodesLoading, isOpen, isSourcesLoading, loadError, releaseId, selectEpisode, selectedDub, selectedSource]);

    const filteredEpisodes = useMemo(() => {
        if (!filterQuery.trim()) return episodesData;
        const query = filterQuery.trim().toLowerCase();
        return episodesData.filter(episode =>
            episode.name.toLowerCase().includes(query) || String(episode.position).includes(query)
        );
    }, [episodesData, filterQuery]);

    useEffect(() => {
        if (activeEpisodeRef.current && typeof activeEpisodeRef.current.scrollIntoView === 'function') {
            try {
                activeEpisodeRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            } catch {
                // Ignore layout/jsdom errors
            }
        }
    }, [episodesData]);

    useEffect(() => {
        episodeListRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest' });
    }, [focusedEpisodeIndex]);

    const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.target !== event.currentTarget || event.defaultPrevented || event.nativeEvent.isComposing || isSelecting || isDubsLoading || isSourcesLoading || isEpisodesLoading || loadError || filteredEpisodes.length === 0) return;

        if (event.key === 'ArrowDown') {
            event.preventDefault();
            setFocusedEpisodeIndex(prev => (prev < filteredEpisodes.length - 1 ? prev + 1 : 0));
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setFocusedEpisodeIndex(prev => (prev > 0 ? prev - 1 : filteredEpisodes.length - 1));
        } else if (event.key === 'Enter' && focusedEpisodeIndex >= 0 && focusedEpisodeIndex < filteredEpisodes.length) {
            event.preventDefault();
            const target = filteredEpisodes[focusedEpisodeIndex];
            if (target) void selectEpisode(target, true).catch(err => console.error(err));
        }
    };

    if (!isOpen) return null;

    const isLoading = isDubsLoading || isSourcesLoading || isEpisodesLoading;

    return (
        <div className={styles['picker-root']}>
            <Modal
                onClose={onClose}
                onCloseStart={invalidateSelection}
                isOpen={isOpen}
                title={t('dubSelect.title')}
                stickyHeader
                contentStyle={{
                    '--modal-width': 'min(640px, 92vw)',
                    '--modal-max-height': 'min(580px, calc(100dvh - 24px))',
                } as React.CSSProperties}
            >
                    <>
                        <div className={styles['picker-controls']}>
                            <label className={styles['picker-field']}>
                                <span>{t('roadmap.player.pickerDubs')}</span>
                                <select
                                    value={selectedDub}
                                    aria-label={t('roadmap.player.pickerDubs') || 'Озвучка'}
                                    onChange={e => {
                                        const dubId = +e.target.value;
                                        setSelectedDub(dubId);
                                        if (settings.content.rememberDub) {
                                            setSettings(previous => ({
                                                ...previous,
                                                content: { ...previous.content, rememberedDubId: dubId },
                                            }));
                                        }
                                        loadSources(releaseId, dubId);
                                    }}
                                >
                                    {dubsData.map(dub => (
                                        <option key={`dub-${dub.id}`} value={dub.id}>
                                            {dub.name} {t('dubSelect.optionMeta', { episodes: dub.episodes_count, views: dub.view_count })}
                                        </option>
                                    ))}
                                </select>
                            </label>
                                {(sourcesData.length > 0 || isSourcesLoading) && (
                                    <label className={styles['picker-field']}>
                                    <span>{t('roadmap.player.pickerSources')}</span>
                                    <select
                                        aria-label={t('roadmap.player.pickerSources') || 'Источник'}
                                        onChange={e => {
                                            const sourceId = +e.target.value;
                                            setSelectedSource(sourceId);
                                            if (settings.content.rememberSource) {
                                                setSettings(previous => ({
                                                    ...previous,
                                                    content: { ...previous.content, rememberedSourceId: sourceId },
                                                }));
                                            }
                                            loadEpisodes(releaseId, selectedDub, sourceId);
                                        }}
                                        disabled={isSourcesLoading || sourcesData.length < 2}
                                        value={selectedSource}
                                    >
                                        {sourcesData.map(source => (
                                            <option key={`source-${source.id}`} value={source.id}>
                                                {source.name}
                                            </option>
                                        ))}
                                    </select>
                                    </label>
                                )}
                        </div>

                        {episodesData.length > 6 && (
                            <div className={styles['filter-bar']}>
                                <input
                                    type="search"
                                    className={styles['filter-input']}
                                    placeholder={t('roadmap.player.pickerFilterPlaceholder') || 'Поиск серии…'}
                                    value={filterQuery}
                                    onChange={e => {
                                        setFilterQuery(e.target.value);
                                        setFocusedEpisodeIndex(-1);
                                    }}
                                />
                                <span className={styles['keyboard-hint']}>
                                    {t('roadmap.player.pickerKeyboardHint') || '↑↓ Enter'}
                                </span>
                            </div>
                        )}

                        <div
                            ref={episodeListRef}
                            className={styles.episodes}
                            tabIndex={0}
                            role="listbox"
                            aria-activedescendant={filteredEpisodes[focusedEpisodeIndex] ? `episode-option-${releaseId}-${selectedDub}-${selectedSource}-${filteredEpisodes[focusedEpisodeIndex].position}` : undefined}
                            aria-label={t('dubSelect.title')}
                            onKeyDown={handleKeyDown}
                        >
                            {isLoading && (
                                <div className={styles['state-container']}>
                                    <p>{t('misc.loading')}</p>
                                </div>
                            )}

                            {!isLoading && loadError && (
                                <div className={styles['state-container']}>
                                    <p className={styles['error-text']}>{loadError}</p>
                                    <button
                                        type="button"
                                        className={styles['retry-button']}
                                        onClick={() => {
                                            if (selectedDub && selectedSource) loadEpisodes(releaseId, selectedDub, selectedSource);
                                            else loadDubs();
                                        }}
                                    >
                                        {t('roadmap.player.pickerRetry') || 'Попробовать снова'}
                                    </button>
                                </div>
                            )}

                            {!isLoading && !loadError && filteredEpisodes.length === 0 && (
                                <div className={styles['state-container']}>
                                    <p>{filterQuery ? (t('roadmap.player.pickerEmptyEpisodes') || 'Серии не найдены') : (t('page.empty') || 'Здесь пока ничего нет.')}</p>
                                </div>
                            )}

                            {!isLoading && !loadError && filteredEpisodes.map((episode, index) => {
                                const savedTime = episodeProgress[String(episode.position)];
                                const hasProgress = typeof savedTime === 'number' && savedTime > 0;
                                const isFullWatched = savedTime === -1 || episode.is_watched;
                                const isFocused = index === focusedEpisodeIndex;

                                return (
                                    <div
                                        key={`episode-${episode.position}`}
                                        className={`${styles['episode-row']} ${isFocused ? styles['episode-focused'] : ''}`}
                                    >
                                        <button
                                            ref={hasProgress ? activeEpisodeRef : null}
                                            type="button"
                                            role="option"
                                            id={`episode-option-${releaseId}-${selectedDub}-${selectedSource}-${episode.position}`}
                                            className={styles['episode']}
                                            aria-selected={isFocused}
                                            disabled={isSelecting}
                                            onClick={() => void selectEpisode(episode, true).catch(error => console.error(error))}
                                        >
                                            <h3>{episode.name}</h3>
                                            <div className={styles['episode-meta']}>
                                                {isFullWatched && !hasProgress ? (
                                                    <span className={styles['episode-progress']}>
                                                        {t('dubSelect.watchedFull')}
                                                    </span>
                                                ) : hasProgress ? (
                                                    <span className={styles['episode-progress']}>
                                                        {t('dubSelect.watchedUntil')} {formatProgressTime(savedTime)}
                                                    </span>
                                                ) : null}
                                            </div>
                                        </button>
                                        {episode.is_watched && (
                                            <button
                                                type="button"
                                                className={styles.seen}
                                                aria-label={t('dubSelect.watched')}
                                                onClick={() => setEpisodeToUnwatch(episode)}
                                            >
                                                <img src={EyeIcon} alt="" />
                                            </button>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </>
            </Modal>

            <Modal
                isOpen={episodeToUnwatch !== null}
                onClose={() => setEpisodeToUnwatch(null)}
                title={t('dubSelect.unwatchTitle')}
                text={`${t('dubSelect.unwatchText')} «${episodeToUnwatch?.name ?? ''}»?`}
                actions={[
                    {
                        label: t('misc.cancel'),
                        variant: 'secondary',
                        onClick: () => setEpisodeToUnwatch(null),
                    },
                    {
                        label: t('misc.remove'),
                        variant: 'primary',
                        onClick: async () => {
                            if (!episodeToUnwatch) return;
                            try {
                                await SetUnwatched(api, releaseId, selectedSource, episodeToUnwatch.position);
                                clearWatchProgress(releaseId, String(episodeToUnwatch.position));
                                setEpisodesData(previousEpisodes =>
                                    previousEpisodes.map(episode =>
                                        episode.position === episodeToUnwatch.position
                                            ? { ...episode, is_watched: false }
                                            : episode
                                    )
                                );
                                setEpisodeToUnwatch(null);
                            } catch (error) {
                                console.error(error);
                            }
                        },
                    },
                ]}
            />
        </div>
    );
}

type ApiClient = ReturnType<typeof useApi>;

async function GetDubs(api: ApiClient, id: number) {
    return api.get<{ code: number; types: Dub[] }>(`/episode/${id}`);
}

async function GetSources(api: ApiClient, releaseId: number, dubId: number) {
    return api.get<{ code: number; sources: Source[] }>(`/episode/${releaseId}/${dubId}`);
}

async function GetEpisodes(api: ApiClient, releaseId: number, dubId: number, sourceId: number) {
    return api.get<{ code: number; episodes: Episode[] }>(`/episode/${releaseId}/${dubId}/${sourceId}`);
}

async function SetWatched(api: ApiClient, releaseId: number, sourceId: number, position: number) {
    const result = await api.get<{ code: number }>(`/episode/watch/${releaseId}/${sourceId}/${position}`);
    void AddToHistory(api, releaseId, sourceId, position);
    return result;
}

async function SetUnwatched(api: ApiClient, releaseId: number, sourceId: number, position: number) {
    return api.get<{ code: number }>(`/episode/unwatch/${releaseId}/${sourceId}/${position}`);
}

async function AddToHistory(api: ApiClient, releaseId: number, sourceId: number, position: number) {
    return api.get<{ code: number }>(`/history/add/${releaseId}/${sourceId}/${position}`);
}
