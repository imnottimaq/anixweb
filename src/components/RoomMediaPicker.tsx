import { useEffect, useId, useRef, useState } from 'react';
import { useApi } from '../shared/apiClient';
import { useSettings } from '../shared/contexts/settingsContext';
import type { Anime } from '../shared/types/api';
import type { RoomMedia } from '../shared/roomProtocol';
import type { TranslationKey } from '../shared/i18n';
import { useTranslation } from '../shared/useTranslation';
import RemoteImage from './RemoteImage';
import styles from './RoomMediaPicker.module.css';

type Option = { id: number; name: string };
type Episode = { position: number; name: string };
type Props = { release: Anime; onCancel: () => void; onSelected: (media: RoomMedia) => Promise<void>; disabled?: boolean };
type Stage<T> = { status: 'loading' | 'ready' | 'error'; items: T[] };

// Each stage is keyed by its upstream selection. Its cleanup both aborts the
// request and guards against APIs or test transports which ignore the signal.
function useOptions<T>(path: string, field: string) {
    const api = useApi();
    const [attempt, setAttempt] = useState(0);
    const [stage, setStage] = useState<Stage<T>>({ status: 'loading', items: [] });
    useEffect(() => {
        const controller = new AbortController();
        let active = true;
        api.get<Record<string, T[]>>(path, { signal: controller.signal }).then(response => {
            if (active) setStage({ status: 'ready', items: response[field] ?? [] });
        }).catch(() => {
            if (active) setStage({ status: 'error', items: [] });
        });
        return () => { active = false; controller.abort(); };
    }, [api, path, field, attempt]);
    const retry = () => { setStage({ status: 'loading', items: [] }); setAttempt(value => value + 1); };
    return { ...stage, retry };
}

function StageMessage({ stage, empty }: { stage: Stage<unknown> & { retry: () => void }; empty: TranslationKey }) {
    const { t } = useTranslation();
    if (stage.status === 'loading') return <p className={styles.message} role="status">{t('misc.loading')}</p>;
    if (stage.status === 'error') return <div className={styles.message} role="alert">
        <p>{t('roomUX.mediaLoadError')}</p>
        <button type="button" className={styles.secondary} onClick={stage.retry}>{t('roomUX.retry')}</button>
    </div>;
    if (stage.items.length === 0) return <p className={styles.message} role="status">{t(empty)}</p>;
    return null;
}

export default function RoomMediaPicker(props: Props) {
    return <Picker key={props.release.id} {...props} />;
}

function Picker({ release, onCancel, onSelected, disabled = false }: Props) {
    const { t, language } = useTranslation();
    const { settings } = useSettings();
    const id = useId();
    const stage = useOptions<Option>(`/episode/${release.id}`, 'types');
    const [dub, setDub] = useState<number | null>(null);
    const [pending, setPending] = useState(false);
    const [failed, setFailed] = useState(false);
    const locked = useRef(false);
    const alive = useRef(true);
    const select = useRef<HTMLSelectElement>(null);
    useEffect(() => {
        alive.current = true;
        return () => { alive.current = false; };
    }, []);
    useEffect(() => {
        if (stage.status === 'ready' && stage.items.length && !disabled) select.current?.focus();
    }, [stage.status, stage.items.length, disabled]);
    const initialDub = settings.content.rememberDub
        ? stage.items.find(item => item.id === settings.content.rememberedDubId)?.id
        : undefined;
    const selectedDub = dub ?? initialDub ?? stage.items[0]?.id;
    const title = language === 'english' && release.title_original ? release.title_original : release.title_ru;
    const choose = async (media: RoomMedia) => {
        if (locked.current || disabled || !alive.current) return;
        locked.current = true;
        setPending(true);
        setFailed(false);
        try { await onSelected(media); }
        catch { if (alive.current) setFailed(true); }
        finally {
            locked.current = false;
            if (alive.current) setPending(false);
        }
    };
    return <section className={styles.picker} aria-labelledby={`${id}-heading`} aria-busy={pending}>
        <header className={styles.header}>
            <RemoteImage className={styles.poster} src={release.image} alt="" />
            <div className={styles.heading}>
                <p className={styles.eyebrow}>{t('roomUX.chooseEpisode')}</p>
                <h3 id={`${id}-heading`}>{title}</h3>
            </div>
            <button type="button" className={styles.secondary} disabled={pending} onClick={onCancel}>{t('roomUX.cancelSelection')}</button>
        </header>
        <fieldset className={styles.fields} disabled={disabled || pending}>
            <StageMessage stage={stage} empty="roomUX.noDubs" />
            {stage.status === 'ready' && selectedDub !== undefined ? <>
                <label className={styles.field} htmlFor={`${id}-dub`}>
                    <span>{t('roomUX.dub')}</span>
                    <select id={`${id}-dub`} ref={select} value={selectedDub} onChange={event => setDub(Number(event.target.value))}>
                        {stage.items.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                    </select>
                </label>
                <Sources key={selectedDub} release={release} title={title} dubId={selectedDub} onSelected={choose} pending={pending} />
            </> : null}
        </fieldset>
        {pending ? <p className={styles.message} role="status">{t('roomUX.starting')}</p> : null}
        {failed ? <p className={styles.error} role="alert">{t('roomUX.mediaLoadError')}</p> : null}
    </section>;
}

function Sources({ release, title, dubId, onSelected, pending }: { release: Anime; title: string; dubId: number; onSelected: (media: RoomMedia) => Promise<void>; pending: boolean }) {
    const { t } = useTranslation();
    const { settings } = useSettings();
    const id = useId();
    const stage = useOptions<Option>(`/episode/${release.id}/${dubId}`, 'sources');
    const [source, setSource] = useState<number | null>(null);
    const initialSource = settings.content.rememberSource
        ? stage.items.find(item => item.id === settings.content.rememberedSourceId)?.id
        : undefined;
    const selectedSource = source ?? initialSource ?? stage.items[0]?.id;
    return <>
        <StageMessage stage={stage} empty="roomUX.noSources" />
        {stage.status === 'ready' && selectedSource !== undefined ? <>
            <label className={styles.field} htmlFor={`${id}-source`}>
                <span>{t('roomUX.source')}</span>
                <select id={`${id}-source`} value={selectedSource} onChange={event => setSource(Number(event.target.value))}>
                    {stage.items.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
            </label>
            <Episodes key={selectedSource} release={release} title={title} dubId={dubId} sourceId={selectedSource} onSelected={onSelected} pending={pending} />
        </> : null}
    </>;
}

function Episodes({ release, title, dubId, sourceId, onSelected, pending }: { release: Anime; title: string; dubId: number; sourceId: number; onSelected: (media: RoomMedia) => Promise<void>; pending: boolean }) {
    const { t } = useTranslation();
    const stage = useOptions<Episode>(`/episode/${release.id}/${dubId}/${sourceId}`, 'episodes');
    return <div className={styles.episodes}>
        <StageMessage stage={stage} empty="roomUX.noEpisodes" />
        {stage.status === 'ready' ? stage.items.map(episode => <button
            key={episode.position} type="button" className={styles.episode} disabled={pending}
            onClick={() => void onSelected({ releaseId: release.id, releaseName: title, dubId, sourceId, episode: episode.position, episodeName: episode.name })}
        >
            <strong>{episode.name}</strong>
            <span>{t('roomUX.startTogether')} <span aria-hidden="true">→</span></span>
        </button>) : null}
    </div>;
}
