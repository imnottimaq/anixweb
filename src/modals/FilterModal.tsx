import { useState } from 'react';
import type { Filter } from '../shared/types/api';
import { Modal } from './ModalTemplate';
import styles from './FilterModal.module.css';
import { useTranslation } from '../shared/useTranslation';

type FilterModalProps = {
    isOpen: boolean;
    onClose: () => void;
    filter?: Filter;
    setFilter: (filter: Filter) => void;
};

const PROFILE_LISTS = [[0, 'nav.favorites'], [1, 'status.watching'], [2, 'status.planned'], [3, 'status.watched'], [4, 'status.hold_on'], [5, 'status.dropped']] as const;

export default function FilterModal({ isOpen, onClose, filter = {}, setFilter }: FilterModalProps) {
    if (!isOpen) return null;

    return <FilterModalContent onClose={onClose} filter={filter} setFilter={setFilter} />;
}

function FilterModalContent({ onClose, filter, setFilter }: Omit<FilterModalProps, 'isOpen'> & { filter: Filter }) {
    const { t } = useTranslation();
    const [draft, setDraft] = useState<Filter>(filter);
    const update = <K extends keyof Filter>(key: K, value: Filter[K]) => setDraft(previous => ({ ...previous, [key]: value }));
    const updateNumber = (key: 'start_year' | 'end_year' | 'episodes_from' | 'episodes_to' | 'episode_duration_from' | 'episode_duration_to', value: string) => update(key, value === '' ? undefined : Number(value));
    const toggleProfileList = (id: number) => {
        const current = draft.profile_list_exclusions ?? [];
        update('profile_list_exclusions', current.includes(id) ? current.filter(item => item !== id) : [...current, id]);
    };
    const apply = () => {
        const prepared = Object.fromEntries(Object.entries(draft).filter(([, value]) => value !== undefined && value !== '' && (!Array.isArray(value) || value.length > 0))) as Filter;
        setFilter(prepared);
        onClose();
    };

    return <Modal isOpen onClose={onClose} title={t('filter.title')} size="large" contentClassName={styles.modal}>
        <div className={styles.fields}>
            <Field label={t('filter.country')}><select value={draft.country ?? ''} onChange={event => update('country', (event.target.value || undefined) as Filter['country'])}><option value="">{t('misc.notImportant')}</option><option value="Япония">{t('country.japan')}</option><option value="Китай">{t('country.china')}</option><option value="Южная Корея">{t('country.southKorea')}</option></select></Field>
            <Field label={t('filter.category')}><select value={draft.category_id ?? ''} onChange={event => update('category_id', event.target.value === '' ? undefined : Number(event.target.value) as Filter['category_id'])}><option value="">{t('misc.notImportant')}</option><option value="1">{t('releaseType.series')}</option><option value="2">{t('releaseType.film')}</option><option value="3">OVA</option><option value="4">{t('releaseType.dorama')}</option></select></Field>
            <Field label={t('filter.genres')} hint={t('filter.genresHint')}><input value={(draft.genres ?? []).join(', ')} onChange={event => update('genres', event.target.value.split(',').map(item => item.trim()).filter(Boolean))} placeholder={t('filter.genresHint')} /></Field>
            <label className={styles.checkbox}><input type="checkbox" checked={draft.is_genres_exclude_mode_enabled ?? false} onChange={event => update('is_genres_exclude_mode_enabled', event.target.checked || undefined)} />{t('filter.excludeGenres')}</label>
            <Field label={t('filter.dubs')} hint={t('filter.genresHint')}><input value={(draft.types ?? []).join(', ')} onChange={event => update('types', event.target.value.split(',').map(item => item.trim()).filter(Boolean))} placeholder={t('filter.dubs')} /></Field>
            <div className={styles['two-columns']}><Field label={t('filter.studio')}><input value={draft.studio ?? ''} onChange={event => update('studio', event.target.value || undefined)} placeholder={t('misc.notImportant')} /></Field><Field label={t('filter.source')}><input value={draft.source ?? ''} onChange={event => update('source', event.target.value || undefined)} placeholder={t('misc.notImportant')} /></Field></div>
            <fieldset className={styles.fieldset}><legend>{t('filter.excludeLists')}</legend><div className={styles['checkbox-grid']}>
                {PROFILE_LISTS.map(([id, label]) => <label className={styles.checkbox} key={id}><input type="checkbox" checked={(draft.profile_list_exclusions ?? []).includes(id)} onChange={() => toggleProfileList(id)} />{t(label)}</label>)}
            </div></fieldset>
            <div className={styles['two-columns']}><Field label={t('filter.yearFrom')}><input type="number" min="1900" max="2100" value={draft.start_year ?? ''} onChange={event => updateNumber('start_year', event.target.value)} placeholder={t('misc.notImportant')} /></Field><Field label={t('filter.yearTo')}><input type="number" min="1900" max="2100" value={draft.end_year ?? ''} onChange={event => updateNumber('end_year', event.target.value)} placeholder={t('misc.notImportant')} /></Field></div>
            <div className={styles['two-columns']}><Field label={t('filter.episodesFrom')}><input type="number" min="1" value={draft.episodes_from ?? ''} onChange={event => updateNumber('episodes_from', event.target.value)} placeholder={t('misc.notImportant')} /></Field><Field label={t('filter.episodesTo')}><input type="number" min="1" value={draft.episodes_to ?? ''} onChange={event => updateNumber('episodes_to', event.target.value)} placeholder={t('misc.notImportant')} /></Field></div>
            <div className={styles['two-columns']}><Field label={t('filter.durationFrom')}><input type="number" min="1" value={draft.episode_duration_from ?? ''} onChange={event => updateNumber('episode_duration_from', event.target.value)} placeholder={t('misc.notImportant')} /></Field><Field label={t('filter.durationTo')}><input type="number" min="1" value={draft.episode_duration_to ?? ''} onChange={event => updateNumber('episode_duration_to', event.target.value)} placeholder={t('misc.notImportant')} /></Field></div>
            <div className={styles['two-columns']}><Field label={t('filter.season')}><select value={draft.season ?? ''} onChange={event => update('season', event.target.value === '' ? undefined : Number(event.target.value) as Filter['season'])}><option value="">{t('misc.notImportant')}</option><option value="1">{t('seasons.winter')}</option><option value="2">{t('seasons.spring')}</option><option value="3">{t('seasons.summer')}</option><option value="4">{t('seasons.autumn')}</option></select></Field><Field label={t('filter.status')}><select value={draft.status_id ?? ''} onChange={event => update('status_id', event.target.value === '' ? undefined : Number(event.target.value) as Filter['status_id'])}><option value="">{t('misc.notImportant')}</option><option value="1">{t('filter.statusReleased')}</option><option value="2">{t('filter.statusOngoing')}</option><option value="3">{t('filter.statusAnnounced')}</option></select></Field></div>
            <Field label={t('filter.ageRating')}><select value={draft.age_ratings?.[0] ?? ''} onChange={event => update('age_ratings', event.target.value === '' ? [] : [Number(event.target.value)] as Filter['age_ratings'])}><option value="">{t('misc.notImportant')}</option><option value="1">0+</option><option value="2">6+</option><option value="3">12+</option><option value="4">16+</option><option value="5">18+</option></select></Field>
            <Field label={t('filter.sort')}><select value={draft.sort ?? 0} onChange={event => update('sort', Number(event.target.value) as Filter['sort'])}><option value="0">{t('sort.dateAddedNewFirst')}</option><option value="1">{t('filter.sortRating')}</option><option value="2">{t('filter.sortYear')}</option><option value="3">{t('filter.sortPopularity')}</option></select></Field>
        </div>
        <div className={styles.actions}><button type="button" className={styles.reset} onClick={() => setDraft({})}>{t('misc.reset')}</button><button type="button" className={styles.apply} onClick={apply}>{t('misc.apply')}</button></div>
    </Modal>;
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
    return <label className={styles.field}><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}
