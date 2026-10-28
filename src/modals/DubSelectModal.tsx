import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
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
import { getReadableErrorMessage } from '../shared/errorUtils';

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

interface ParsedEpisodeQuery {
    trimmed: string;
    isNumeric: boolean;
    numValue?: number;
}

function parseEpisodeQuery(query: string): ParsedEpisodeQuery {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) {
        return { trimmed: '', isNumeric: false };
    }

    const directNum = Number(trimmed);
    if (!Number.isNaN(directNum) && Number.isInteger(directNum) && directNum > 0) {
        return { trimmed, isNumeric: true, numValue: directNum };
    }

    const epMatch = trimmed.match(/^(?:серия|эпизод|эп\.?|ep\.?|s\d+\s*e|e)\s*(\d+)$/i);
    if (epMatch) {
        const parsed = Number(epMatch[1]);
        if (!Number.isNaN(parsed) && Number.isInteger(parsed) && parsed > 0) {
            return { trimmed, isNumeric: true, numValue: parsed };
        }
    }

    return { trimmed, isNumeric: false };
}

function matchesEpisode(episode: Episode, parsed: ParsedEpisodeQuery): boolean {
    if (!parsed.trimmed) return true;

    if (parsed.isNumeric && parsed.numValue !== undefined) {
        if (episode.position === parsed.numValue) return true;
        if (String(episode.position).startsWith(String(parsed.numValue))) return true;
    }

    if (String(episode.position) === parsed.trimmed) return true;
    if (episode.name.toLowerCase().includes(parsed.trimmed)) return true;

    return false;
}

function highlightMatch(text: string, query: string): ReactNode {
    const q = query.trim();
    if (!q) return text;
    let index = text.toLowerCase().indexOf(q.toLowerCase());
    let matchLen = q.length;

    if (index === -1) {
        const parsed = parseEpisodeQuery(q);
        if (parsed.isNumeric && parsed.numValue !== undefined) {
            const numStr = String(parsed.numValue);
            index = text.toLowerCase().indexOf(numStr);
            matchLen = numStr.length;
        }
    }

    if (index === -1) return text;
    const before = text.slice(0, index);
    const match = text.slice(index, index + matchLen);
    const after = text.slice(index + matchLen);
    return <>
        {before}
        <mark className={styles.highlight}>{match}</mark>
        {after}
    </>;
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
    const [searchQuery, setSearchQuery] = useState('');
    const [isSearchOpen, setIsSearchOpen] = useState(false);
    const [isReversed, setIsReversed] = useState(false);
    const searchInputRef = useRef<HTMLInputElement | null>(null);

    const displayedEpisodes = useMemo(() => {
        return isReversed ? [...episodesData].reverse() : episodesData;
    }, [episodesData, isReversed]);

    const matchingIndices = useMemo(() => {
        const parsed = parseEpisodeQuery(searchQuery);
        if (!parsed.trimmed) return new Set<number>();
        const set = new Set<number>();
        displayedEpisodes.forEach((ep, index) => {
            if (matchesEpisode(ep, parsed)) {
                set.add(index);
            }
        });
        return set;
    }, [displayedEpisodes, searchQuery]);

    const primaryMatchIndex = useMemo(() => {
        const parsed = parseEpisodeQuery(searchQuery);
        if (!parsed.trimmed || displayedEpisodes.length === 0) return -1;

        if (parsed.isNumeric && parsed.numValue !== undefined) {
            const exactIdx = displayedEpisodes.findIndex(ep => ep.position === parsed.numValue);
            if (exactIdx !== -1) return exactIdx;

            const prefixIdx = displayedEpisodes.findIndex(ep => String(ep.position).startsWith(String(parsed.numValue)));
            if (prefixIdx !== -1) return prefixIdx;
        }

        const nameStartsIdx = displayedEpisodes.findIndex(ep => ep.name.toLowerCase().startsWith(parsed.trimmed));
        if (nameStartsIdx !== -1) return nameStartsIdx;

        return displayedEpisodes.findIndex(ep => matchesEpisode(ep, parsed));
    }, [displayedEpisodes, searchQuery]);

    const lastTypeTimeRef = useRef(0);

    const [isDubsLoading, setIsDubsLoading] = useState(false);
    const [isSourcesLoading, setIsSourcesLoading] = useState(false);
    const [isEpisodesLoading, setIsEpisodesLoading] = useState(false);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [selectionError, setSelectionError] = useState<string | null>(null);
    const [focusedEpisodeIndex, setFocusedEpisodeIndex] = useState(-1);

    const activeFocusedIndex = focusedEpisodeIndex !== -1 ? focusedEpisodeIndex : primaryMatchIndex;

    const updateSearchQuery = useCallback((updater: string | ((prev: string) => string)) => {
        setFocusedEpisodeIndex(-1);
        setSearchQuery(updater);
    }, []);
    const [isSelecting, setIsSelecting] = useState(false);
    const selectionRef = useRef<{ id: number; controller: AbortController } | null>(null);
    const selectionGenerationRef = useRef(0);
    const invalidateSelection = useCallback(() => {
        selectionGenerationRef.current++;
        selectionRef.current?.controller.abort();
        selectionRef.current = null;
        setIsSelecting(false);
        setSelectionError(null);
        setFocusedEpisodeIndex(-1);
    }, []);

    const [episodeToUnwatch, setEpisodeToUnwatch] = useState<Episode | null>(null);
    const autoSelectedRef = useRef<string | null>(null);
    const dubsRequestRef = useRef(0);
    const sourcesRequestRef = useRef(0);
    const episodesRequestRef = useRef(0);
    const activeEpisodeRef = useRef<HTMLButtonElement | null>(null);
    const episodeListRef = useRef<HTMLDivElement | null>(null);
    const episodeProgress = useMemo(() => getWatchProgress()[String(releaseId)] ?? {}, [releaseId]);

    const resumeTarget = useMemo(() => {
        if (!episodesData.length || Object.keys(episodeProgress).length === 0) return null;

        // 1. Partially watched episode (savedTime > 0)
        const partialWatched = episodesData
            .filter(ep => {
                const time = episodeProgress[String(ep.position)];
                return typeof time === 'number' && time > 0;
            })
            .sort((a, b) => b.position - a.position);

        if (partialWatched.length > 0) {
            const ep = partialWatched[0];
            return {
                episode: ep,
                isPartial: true,
                isCompleted: false,
                time: episodeProgress[String(ep.position)] as number,
            };
        }

        // 2. Fully watched episodes from local progress (time === -1)
        const watchedEpisodes = episodesData
            .filter(ep => episodeProgress[String(ep.position)] === -1)
            .sort((a, b) => b.position - a.position);

        if (watchedEpisodes.length > 0) {
            const lastWatched = watchedEpisodes[0];
            const nextEp = episodesData.find(ep => ep.position === lastWatched.position + 1);
            if (nextEp) {
                return {
                    episode: nextEp,
                    isPartial: false,
                    isCompleted: false,
                    time: 0,
                };
            }
            return {
                episode: lastWatched,
                isPartial: false,
                isCompleted: true,
                time: -1,
            };
        }

        return null;
    }, [episodesData, episodeProgress]);

    const autoDubId = autoSelect?.dubId;
    const autoSrcId = autoSelect?.sourceId;
    const autoEpNumber = autoSelect?.episode;

    const loadEpisodes = useCallback((relId: number, dubId: number, srcId: number) => {
        invalidateSelection();
        const requestId = ++episodesRequestRef.current;
        setIsEpisodesLoading(true);
        setLoadError(null);
        setEpisodesData([]);
        setSearchQuery('');

        GetEpisodes(api, relId, dubId, srcId)
            .then(data => {
                if (requestId === episodesRequestRef.current) {
                    setEpisodesData(data.episodes || []);
                }
            })
            .catch(err => {
                if (requestId === episodesRequestRef.current) {
                    console.error(err);
                    setLoadError(getReadableErrorMessage(err, t) || t('roadmap.player.pickerError') || 'Не удалось загрузить список серий');
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
        setSearchQuery('');

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
                    setLoadError(getReadableErrorMessage(err, t) || t('roadmap.player.pickerError') || 'Не удалось загрузить источники');
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
                    setLoadError(getReadableErrorMessage(err, t) || t('roadmap.player.pickerError') || 'Не удалось загрузить список озвучек');
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
            setFocusedEpisodeIndex(-1);
            setIsSearchOpen(false);
            setSearchQuery('');
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
        setSelectionError(null);
        const sourceId = selectedSource;
        const dubId = selectedDub;
        const episodes = episodesData.map(({ name, position, url }) => ({ name, position, url }));
        try {
            const sources = resolveSources ? await extractVideoLinks(episode.url, controller.signal) : {};
            if (controller.signal.aborted || id !== selectionGenerationRef.current) return;
            if (!sources || (resolveSources && Object.keys(sources).length === 0)) {
                throw new Error(t('dubSelect.extractError'));
            }
            if (resolveSources && shouldMarkWatched && token) await SetWatched(api, releaseId, sourceId, episode.position);
            if (controller.signal.aborted || id !== selectionGenerationRef.current) return;
            onEpisodeSelect(sources, {
                name: episode.name,
                position: episode.position,
                url: episode.url,
            }, episodes, sourceId, dubId);
        } catch (error) {
            if (!controller.signal.aborted && id === selectionGenerationRef.current) {
                console.error('Ошибка при выборе серии:', error);
                setSelectionError(getReadableErrorMessage(error, t) || t('dubSelect.extractError'));
            }
        } finally {
            if (selectionRef.current?.id === id) { selectionRef.current = null; setIsSelecting(false); }
        }
    }, [api, episodesData, isDubsLoading, isEpisodesLoading, isOpen, isSourcesLoading, loadError, onEpisodeSelect, releaseId, resolveSources, selectedDub, selectedSource, token, t]);

    useEffect(() => {
        if (!isOpen || isDubsLoading || isSourcesLoading || isEpisodesLoading || loadError || autoDubId === undefined || autoSrcId === undefined || autoEpNumber === undefined) return;
        if (selectedDub !== autoDubId || selectedSource !== autoSrcId) return;
        const episode = episodesData.find(item => item.position === autoEpNumber);
        const key = `${releaseId}:${autoDubId}:${autoSrcId}:${autoEpNumber}`;
        if (!episode || autoSelectedRef.current === key) return;
        autoSelectedRef.current = key;
        void selectEpisode(episode, false).catch(error => console.error('Не удалось открыть серию комнаты:', error));
    }, [autoDubId, autoEpNumber, autoSrcId, episodesData, isDubsLoading, isEpisodesLoading, isOpen, isSourcesLoading, loadError, releaseId, selectEpisode, selectedDub, selectedSource]);


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
    }, [activeFocusedIndex]);

    useEffect(() => {
        if (!searchQuery.trim() || activeFocusedIndex === -1) return;
        const targetEl = document.getElementById(
            `episode-row-${releaseId}-${displayedEpisodes[activeFocusedIndex]?.position}`
        );
        if (typeof targetEl?.scrollIntoView === 'function') {
            targetEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
    }, [searchQuery, activeFocusedIndex, releaseId, displayedEpisodes]);

    const navigateMatches = useCallback((direction: 1 | -1) => {
        if (matchingIndices.size > 0) {
            const matchList = Array.from(matchingIndices);
            const currentPos = matchList.indexOf(activeFocusedIndex);
            const nextPos = currentPos !== -1
                ? (currentPos + direction + matchList.length) % matchList.length
                : (direction === 1 ? 0 : matchList.length - 1);
            const nextIndex = matchList[nextPos];
            setFocusedEpisodeIndex(nextIndex);
            const targetEl = document.getElementById(
                `episode-row-${releaseId}-${displayedEpisodes[nextIndex].position}`
            );
            if (typeof targetEl?.scrollIntoView === 'function') {
                try {
                    targetEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                } catch {
                    // Ignore jsdom errors
                }
            }
        } else if (displayedEpisodes.length > 0) {
            const currentIndex = activeFocusedIndex !== -1 ? activeFocusedIndex : (direction === 1 ? -1 : 0);
            const nextIndex = (currentIndex + direction + displayedEpisodes.length) % displayedEpisodes.length;
            setFocusedEpisodeIndex(nextIndex);
            const targetEl = document.getElementById(
                `episode-row-${releaseId}-${displayedEpisodes[nextIndex].position}`
            );
            if (typeof targetEl?.scrollIntoView === 'function') {
                try {
                    targetEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                } catch {
                    // Ignore jsdom errors
                }
            }
        }
    }, [activeFocusedIndex, displayedEpisodes, matchingIndices, releaseId]);

    useEffect(() => {
        if (!isOpen) return;

        const handleGlobalKeyDown = (event: globalThis.KeyboardEvent) => {
            if (episodeToUnwatch !== null) return;
            if (event.defaultPrevented || event.isComposing) return;

            const el = event.target instanceof Element ? event.target : null;
            const tagName = el?.tagName?.toLowerCase();
            const isInsideInput = tagName === 'input' || tagName === 'textarea';
            const isSeenButton = Boolean(el?.closest(`.${styles.seen}`) || el?.getAttribute('aria-label') === t('dubSelect.watched'));
            const isSelect = tagName === 'select';

            // 1. ESCAPE: if search query or search bar is active, clear it and prevent modal from closing
            if (event.key === 'Escape') {
                if (searchQuery.trim().length > 0 || isSearchOpen) {
                    event.preventDefault();
                    event.stopPropagation();
                    if (event.stopImmediatePropagation) event.stopImmediatePropagation();
                    updateSearchQuery('');
                    setIsSearchOpen(false);
                    lastTypeTimeRef.current = 0;
                }
                return;
            }

            // 2. BACKSPACE: if not inside an input and search query exists, delete last character
            if (event.key === 'Backspace' && !isInsideInput && searchQuery.length > 0) {
                event.preventDefault();
                event.stopPropagation();
                updateSearchQuery(q => {
                    const next = q.slice(0, -1);
                    if (!next) setIsSearchOpen(false);
                    return next;
                });
                lastTypeTimeRef.current = Date.now();
                return;
            }

            // If loading or selecting or error or no episodes, skip navigation/selection
            if (isSelecting || isDubsLoading || isSourcesLoading || isEpisodesLoading || loadError || displayedEpisodes.length === 0) {
                return;
            }

            // 3. ENTER: select episode
            if (event.key === 'Enter') {
                if (isSeenButton) return;
                if (el?.closest(`.${styles['resume-btn']}`) || el?.closest(`.${styles['retry-button']}`) || el?.closest(`.${styles['search-clear-btn']}`) || el?.closest(`.${styles['sort-toggle-btn']}`)) {
                    return;
                }

                const activeOption = (el?.closest('button[role="option"]') as HTMLButtonElement | null) ?? (document.activeElement?.closest('button[role="option"]') as HTMLButtonElement | null);
                if (activeOption && !searchQuery.trim()) {
                    const optId = activeOption.id;
                    const ep = displayedEpisodes.find(item => optId.endsWith(`-${item.position}`));
                    if (ep) {
                        event.preventDefault();
                        event.stopPropagation();
                        void selectEpisode(ep, true).catch(console.error);
                        return;
                    }
                }

                if (activeFocusedIndex >= 0 && activeFocusedIndex < displayedEpisodes.length) {
                    event.preventDefault();
                    event.stopPropagation();
                    const ep = displayedEpisodes[activeFocusedIndex];
                    if (ep) void selectEpisode(ep, true).catch(console.error);
                }
                return;
            }

            // 4. ARROW KEYS: navigate matching episodes
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                if (isSelect) return;
                event.preventDefault();
                event.stopPropagation();
                navigateMatches(event.key === 'ArrowDown' ? 1 : -1);
                return;
            }

            // 5. PRINTABLE CHARACTERS: Dota 2 style type-to-find
            if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
                const now = Date.now();
                const isTimeout = now - lastTypeTimeRef.current > 1800;

                if (isInsideInput) {
                    lastTypeTimeRef.current = now;
                    if (isTimeout && searchQuery.length > 0) {
                        event.preventDefault();
                        updateSearchQuery(event.key);
                    }
                    return;
                }

                if (event.key === ' ' && el?.closest('button')) {
                    return;
                }

                if (isSelect && event.key === ' ') return;

                event.preventDefault();
                event.stopPropagation();

                lastTypeTimeRef.current = now;
                setIsSearchOpen(true);
                if (isTimeout) {
                    updateSearchQuery(event.key);
                } else {
                    updateSearchQuery(prev => prev + event.key);
                }
            }
        };

        window.addEventListener('keydown', handleGlobalKeyDown, true);
        return () => {
            window.removeEventListener('keydown', handleGlobalKeyDown, true);
        };
    }, [
        isOpen,
        isSearchOpen,
        episodeToUnwatch,
        searchQuery,
        isSelecting,
        isDubsLoading,
        isSourcesLoading,
        isEpisodesLoading,
        loadError,
        displayedEpisodes,
        activeFocusedIndex,
        updateSearchQuery,
        selectEpisode,
        navigateMatches,
        t,
    ]);

    const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.defaultPrevented || event.nativeEvent.isComposing) return;
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            navigateMatches(event.key === 'ArrowDown' ? 1 : -1);
        }
    };

    const handleSearchInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
        if (event.defaultPrevented || event.nativeEvent.isComposing) return;
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            navigateMatches(event.key === 'ArrowDown' ? 1 : -1);
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
                contentClassName={styles.modal}
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

                        {selectionError && (
                            <div className={styles['selection-error-banner']} role="alert">
                                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                                    <circle cx="12" cy="12" r="10" />
                                    <line x1="12" y1="8" x2="12" y2="12" />
                                    <line x1="12" y1="16" x2="12.01" y2="16" />
                                </svg>
                                <span className={styles['selection-error-text']}>{selectionError}</span>
                                <button
                                    type="button"
                                    className={styles['selection-error-close']}
                                    onClick={() => setSelectionError(null)}
                                    aria-label={t('dubSelect.dismiss')}
                                    title={t('dubSelect.dismiss')}
                                >×</button>
                            </div>
                        )}

                        {resumeTarget && !isLoading && !loadError && (
                            <div className={styles['resume-header-banner']}>
                                <div className={styles['resume-content']}>
                                    <span className={styles['resume-badge']}>
                                        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                                            <circle cx="12" cy="12" r="10" />
                                            <polyline points="12 6 12 12 16 14" />
                                        </svg>
                                        {resumeTarget.isPartial
                                            ? t('dubSelect.continueWatching')
                                            : resumeTarget.isCompleted
                                                ? t('dubSelect.lastWatched')
                                                : t('dubSelect.nextEpisode')}
                                    </span>
                                    <span className={styles['resume-ep-name']}>
                                        {resumeTarget.episode.name}
                                        {resumeTarget.isPartial && (
                                            <span className={styles['resume-time']}>
                                                ({formatProgressTime(resumeTarget.time)})
                                            </span>
                                        )}
                                    </span>
                                </div>
                                <button
                                    type="button"
                                    className={styles['resume-btn']}
                                    disabled={isSelecting}
                                    onClick={() => void selectEpisode(resumeTarget.episode, true).catch(error => console.error(error))}
                                    aria-label={`${resumeTarget.isPartial ? t('dubSelect.continue') : t('dubSelect.play')} ${resumeTarget.episode.name}`}
                                >
                                    <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden="true">
                                        <polygon points="5 3 19 12 5 21 5 3" />
                                    </svg>
                                    <span>
                                        {resumeTarget.isPartial
                                            ? t('dubSelect.continue')
                                            : t('dubSelect.play')}
                                    </span>
                                </button>
                            </div>
                        )}

                        {!isLoading && !loadError && episodesData.length > 0 && (
                            <div className={styles['episodes-header']}>
                                <div className={styles['episodes-header-left']}>
                                    <span className={styles['episodes-count']}>
                                        {t('dubSelect.title')} ({displayedEpisodes.length})
                                    </span>
                                </div>
                                <div className={styles['episodes-header-actions']}>
                                    {!isSearchOpen && !searchQuery.trim() && (
                                        <button
                                            type="button"
                                            className={styles['header-action-btn']}
                                            onClick={() => {
                                                setIsSearchOpen(true);
                                                setTimeout(() => searchInputRef.current?.focus(), 50);
                                            }}
                                            title={t('dubSelect.quickSearch')}
                                            aria-label={t('dubSelect.quickSearch')}
                                        >
                                            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                                                <circle cx="11" cy="11" r="8" />
                                                <line x1="21" y1="21" x2="16.65" y2="16.65" />
                                            </svg>
                                        </button>
                                    )}
                                    {episodesData.length > 1 && (
                                        <button
                                            type="button"
                                            className={`${styles['header-action-btn']} ${styles['sort-toggle-btn']} ${isReversed ? styles['sort-active'] : ''}`}
                                            onClick={() => setIsReversed(v => !v)}
                                            title={isReversed ? t('dubSelect.sortOrder') : t('dubSelect.sortReverse')}
                                            aria-label={isReversed ? 'Сначала старые' : 'Сначала новые'}
                                        >
                                            <span aria-hidden="true">{isReversed ? 'N → 1' : '1 → N'}</span>
                                        </button>
                                    )}
                                </div>
                            </div>
                        )}

                        {!isLoading && !loadError && (isSearchOpen || searchQuery.trim().length > 0) && (
                            <div className={styles['search-bar']}>
                                <div className={styles['search-input-wrapper']}>
                                    <svg className={styles['search-icon']} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                                        <circle cx="11" cy="11" r="8" />
                                        <line x1="21" y1="21" x2="16.65" y2="16.65" />
                                    </svg>
                                    <input
                                        ref={searchInputRef}
                                        type="text"
                                        className={styles['search-input']}
                                        placeholder={t('dubSelect.quickSearch')}
                                        value={searchQuery}
                                        onChange={e => updateSearchQuery(e.target.value)}
                                        onKeyDown={handleSearchInputKeyDown}
                                        aria-label={t('dubSelect.quickSearch')}
                                        autoFocus
                                    />
                                    <button
                                        type="button"
                                        className={styles['search-clear-btn']}
                                        onClick={() => {
                                            updateSearchQuery('');
                                            setIsSearchOpen(false);
                                        }}
                                        aria-label={t('search.clear') || 'Очистить'}
                                    >×</button>
                                </div>
                                {searchQuery.trim() && (
                                    <span className={styles['match-count']}>
                                        {t('dubSelect.matchCount', { count: matchingIndices.size, total: displayedEpisodes.length })}
                                    </span>
                                )}
                            </div>
                        )}

                        <div
                            ref={episodeListRef}
                            className={styles.episodes}
                            tabIndex={0}
                            role="listbox"
                            aria-activedescendant={displayedEpisodes[activeFocusedIndex] ? `episode-option-${releaseId}-${selectedDub}-${selectedSource}-${displayedEpisodes[activeFocusedIndex].position}` : undefined}
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

                            {!isLoading && !loadError && displayedEpisodes.length === 0 && (
                                <div className={styles['state-container']}>
                                    <p>{t('page.empty')}</p>
                                </div>
                            )}

                            {!isLoading && !loadError && searchQuery.trim() && matchingIndices.size === 0 && (
                                <div className={styles['state-container']}>
                                    <p>{t('dubSelect.noMatches')}</p>
                                </div>
                            )}

                            {!isLoading && !loadError && displayedEpisodes.map((episode, index) => {
                                const savedTime = episodeProgress[String(episode.position)];
                                const hasProgress = typeof savedTime === 'number' && savedTime > 0;
                                const isFullWatched = savedTime === -1 || episode.is_watched;
                                const isFocused = index === activeFocusedIndex;
                                const hasQuery = searchQuery.trim().length > 0;
                                const isMatching = !hasQuery || matchingIndices.has(index);
                                const isPrimaryMatch = hasQuery && isFocused && isMatching;

                                return (
                                    <div
                                        id={`episode-row-${releaseId}-${episode.position}`}
                                        key={`episode-${episode.position}`}
                                        className={`${styles['episode-row']} ${isFocused ? styles['episode-focused'] : ''} ${hasQuery && isMatching ? styles['dota-matched'] : ''} ${hasQuery && !isMatching ? styles['dota-dimmed'] : ''} ${isPrimaryMatch ? styles['dota-primary-match'] : ''}`}
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
                                            <h3>{highlightMatch(episode.name, searchQuery)}</h3>
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
