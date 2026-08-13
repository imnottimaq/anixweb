import { useCallback, useEffect, useRef, useState } from 'react';
import styles from './DubSelectModal.module.css'
import { extractVideoLinks } from '../utils/LinkParser';
import type { VideoSources } from '../shared/types/video';
import type { PlayerSessionEpisode } from '../shared/playerSession';
import CloseIcon from '../assets/icons/xmark.svg'
import EyeIcon from '../assets/icons/eye.svg'
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

export default function DubSelectModal({ isOpen, onClose, releaseId, token, autoSelect, onEpisodeSelect }: DubSelectModalProps){
    const { settings, setSettings } = useSettings();
    const api = useApi();
    const { t } = useTranslation();
    const [dubsData, setDubsData] = useState<Dub[]>([]);
    const [sourcesData, setSourcesData] = useState<Source[]>([]);
    const [episodesData, setEpisodesData] = useState<Episode[]>([]);
    const [selectedDub, setSelectedDub] = useState(0);
    const [selectedSource, setSelectedSource] = useState(0);
    const [isSourcesLoading, setIsSourcesLoading] = useState(false);
    const [isEpisodesLoading, setIsEpisodesLoading] = useState(false);
    const [episodeToUnwatch, setEpisodeToUnwatch] = useState<Episode | null>(null);
    const autoSelectedRef = useRef<string | null>(null);
    const dubsRequestRef = useRef(0);
    const sourcesRequestRef = useRef(0);
    const episodesRequestRef = useRef(0);
    const episodeProgress = getWatchProgress()[String(releaseId)] ?? {};

    const loadEpisodes = useCallback((relId: number, dubId: number, srcId: number) => {
        const requestId = ++episodesRequestRef.current;
        setIsEpisodesLoading(true);
        setEpisodesData([]);
        GetEpisodes(api, relId, dubId, srcId)
            .then(data => {
                if (requestId === episodesRequestRef.current) setEpisodesData(data.episodes || []);
            })
            .catch(err => {
                if (requestId === episodesRequestRef.current) console.error(err);
            })
            .finally(() => {
                if (requestId === episodesRequestRef.current) setIsEpisodesLoading(false);
            });
    },[api])

    const loadSources = useCallback((relId: number, dubId: number) => {
        const requestId = ++sourcesRequestRef.current;
        episodesRequestRef.current += 1;
        setIsSourcesLoading(true);
        setIsEpisodesLoading(false);
        setSourcesData([]);
        setEpisodesData([]);
        GetSources(api, relId, dubId)
            .then(data => {
                if (requestId !== sourcesRequestRef.current) return;
                const sources: Source[] = data.sources || [];
                setSourcesData(sources);

                if (sources.length > 0) {
                    const roomSource = autoSelect && sources.find(source => source.id === autoSelect.sourceId);
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
                if (requestId === sourcesRequestRef.current) console.error(err);
            })
            .finally(() => {
                if (requestId === sourcesRequestRef.current) setIsSourcesLoading(false);
            });
    }, [api, autoSelect, loadEpisodes, settings.content.rememberSource, settings.content.rememberedSourceId])
    
    useEffect(() => {
        if (!isOpen) {
            dubsRequestRef.current += 1;
            sourcesRequestRef.current += 1;
            episodesRequestRef.current += 1;
            autoSelectedRef.current = null;
            return;
        }
        const requestId = ++dubsRequestRef.current;
        GetDubs(api, releaseId)
            .then(data => {
                if (requestId !== dubsRequestRef.current) return;
                const dubs: Dub[] = data.types || [];
                setDubsData(dubs);
                
                if (dubs.length > 0) {
                    const roomDub = autoSelect && dubs.find(dub => dub.id === autoSelect.dubId);
                    const rememberedDub = settings.content.rememberDub
                        ? dubs.find(dub => dub.id === settings.content.rememberedDubId)
                        : undefined;
                    const dubId = roomDub?.id ?? rememberedDub?.id ?? dubs[0].id;
                    setSelectedDub(dubId);
                    loadSources(releaseId, dubId);
                }
            })
            .catch(err => {
                if (requestId === dubsRequestRef.current) console.error(err);
            })
    }, [api, autoSelect, isOpen, loadSources, releaseId, settings.content.rememberDub, settings.content.rememberedDubId])

    const selectEpisode = useCallback(async (episode: Episode, shouldMarkWatched: boolean) => {
        const sourceId = selectedSource;
        const dubId = selectedDub;
        const episodes = episodesData.map(({ name, position, url }) => ({ name, position, url }));
        const sources = await extractVideoLinks(episode.url);
        if (!sources) throw new Error('Не удалось получить ссылки на видео');
        if (shouldMarkWatched && token) await SetWatched(api, releaseId, sourceId, episode.position);
        onEpisodeSelect(sources, {
            name: episode.name,
            position: episode.position,
            url: episode.url,
        }, episodes, sourceId, dubId);
    }, [api, episodesData, onEpisodeSelect, releaseId, selectedDub, selectedSource, token]);

    useEffect(() => {
        if (!isOpen || !autoSelect || selectedDub !== autoSelect.dubId || selectedSource !== autoSelect.sourceId) return;
        const episode = episodesData.find(item => item.position === autoSelect.episode);
        const key = `${releaseId}:${autoSelect.dubId}:${autoSelect.sourceId}:${autoSelect.episode}`;
        if (!episode || autoSelectedRef.current === key) return;
        autoSelectedRef.current = key;
        void selectEpisode(episode, false).catch(error => console.error('Не удалось открыть серию комнаты:', error));
    }, [autoSelect, episodesData, isOpen, releaseId, selectEpisode, selectedDub, selectedSource]);

    if (!isOpen) return null;

    return (
        <>
        <Modal onClose={onClose}
            isOpen={isOpen}
            showCloseButton={false}
            contentStyle={{
                '--modal-width': 'min(50%, 1200px)',
                '--modal-height': 'min(50vh, 800px)',
            } as React.CSSProperties}
        > 
            {close => (<>
                <div className={styles['top-row']}>
                    <h3>{t('dubSelect.title')}</h3>
                    <div className={styles['top-row-right']}>
                        <select value={selectedDub} style={{marginRight:'10px'}}
                        onChange={e => {
                            const dubId = +e.target.value;
                            setSelectedDub(dubId);
                            if (settings.content.rememberDub) {
                                setSettings(previous => ({
                                    ...previous,
                                    content: { ...previous.content, rememberedDubId: dubId },
                                }));
                            }
                            loadSources(releaseId, dubId)
                        }}>
                            {dubsData.map((dub) => {
                                return <option key={`dub-${dub.id}`} value={dub.id}>{dub.name} {t('dubSelect.optionMeta', { episodes: dub.episodes_count, views: dub.view_count })}</option>
                            })}
                        </select>
                        {(sourcesData.length > 0 || isSourcesLoading) && (
                            <select onChange={e => {
                            const sourceId = +e.target.value;
                            setSelectedSource(sourceId);
                            if (settings.content.rememberSource) {
                                setSettings(previous => ({
                                    ...previous,
                                    content: { ...previous.content, rememberedSourceId: sourceId },
                                }));
                            }
                            loadEpisodes(releaseId, selectedDub, sourceId)}}
                            disabled={isSourcesLoading || sourcesData.length < 2}
                            style={{marginRight:'10px'}}
                            value={selectedSource}>
                                {sourcesData.map((source) => {
                                    return <option key={`source-${source.id}`} value={source.id}>{source.name}</option>
                                })}
                            </select>
                        )}
                        <img src={CloseIcon} alt={t('misc.close')} onClick={close} />
                    </div>
                </div>
                <div className={styles.episodes}>
                    {isEpisodesLoading && <p>{t('misc.loading')}</p>}
                    {episodesData.map((episode) => (
                        <div key={`episode-${episode.position}`} className={styles['episode-row']}>
                            <button type="button"
                                className={styles['episode']}
                                onClick={() => void selectEpisode(episode, true).catch(error => console.error(error))}>
                                <h3>{episode.name}</h3>
                                <div className={styles['episode-meta']}>
                                    {episodeProgress[String(episode.position)] === -1 ? (
                                        <span className={styles['episode-progress']}>{t('dubSelect.watchedFull')}</span>
                                    ) : typeof episodeProgress[String(episode.position)] === 'number' && episodeProgress[String(episode.position)] > 0 ? (
                                        <span className={styles['episode-progress']}>
                                            {t('dubSelect.watchedUntil')} {formatProgressTime(episodeProgress[String(episode.position)])}
                                        </span>
                                    ) : null}
                                </div>
                            </button>
                            {episode.is_watched && <button type="button" className={styles.seen}
                                aria-label={t('dubSelect.watched')}
                                onClick={() => setEpisodeToUnwatch(episode)}>
                                <img src={EyeIcon} alt="" />
                            </button>}
                        </div>
                    ))}
                </div>
                </>)}
        </Modal>

        <Modal isOpen={episodeToUnwatch !== null}
            onClose={() => setEpisodeToUnwatch(null)}
            title={t('dubSelect.unwatchTitle')}
            text={`${t('dubSelect.unwatchText')} «${episodeToUnwatch?.name ?? ''}»?`}
            actions={[
                {
                    label: t('misc.cancel'),
                    variant: 'secondary',
                    onClick: () => setEpisodeToUnwatch(null)
                },
                {
                    label: t('misc.remove'),
                    variant: 'primary',
                    onClick: async () => {
                        if (!episodeToUnwatch) return;
                        try {
                            await SetUnwatched(api, releaseId, selectedSource, episodeToUnwatch.position);
                            clearWatchProgress(releaseId, String(episodeToUnwatch.position));
                            setEpisodesData(previousEpisodes => previousEpisodes.map(episode =>
                                episode.position === episodeToUnwatch.position
                                    ? { ...episode, is_watched: false }
                                    : episode
                            ));
                            setEpisodeToUnwatch(null);
                        } catch (error) {
                            console.error(error);
                        }
                    }
                }
            ]}/>
        </>
    )
}


type ApiClient = ReturnType<typeof useApi>;

async function GetDubs(api: ApiClient, id: number) {
    return api.get<{ code: number; types: Dub[] }>(`/episode/${id}`);
}

async function GetSources(api: ApiClient, releaseId: number, dubId: number){
    return api.get<{ code: number; sources: Source[] }>(`/episode/${releaseId}/${dubId}`);
}

async function GetEpisodes(api: ApiClient, releaseId: number, dubId:number, sourceId:number) {
    return api.get<{ code: number; episodes: Episode[] }>(`/episode/${releaseId}/${dubId}/${sourceId}`);
}

async function SetWatched(api: ApiClient, releaseId:number, sourceId: number, position: number) {
    const result = await api.get<{ code: number }>(`/episode/watch/${releaseId}/${sourceId}/${position}`);
    void AddToHistory(api, releaseId, sourceId, position);
    return result;
}

async function SetUnwatched(api: ApiClient, releaseId:number, sourceId: number, position: number) {
    return api.get<{ code: number }>(`/episode/unwatch/${releaseId}/${sourceId}/${position}`);
}

async function AddToHistory(api: ApiClient, releaseId:number, sourceId:number, position:number) {
    return api.get<{ code: number }>(`/history/add/${releaseId}/${sourceId}/${position}`);
}
