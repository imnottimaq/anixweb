import { useId, useRef, useState } from 'react';
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
    const [genres, setGenres] = useState((filter.genres ?? []).join(', '));
    const [dubs, setDubs] = useState((filter.types ?? []).join(', '));
    const [invalidFields, setInvalidFields] = useState<string[]>([]);
    const [error, setError] = useState('');
    const formId = useId();
    const errorId = useId();
    const formRef = useRef<HTMLFormElement>(null);
    const numericProps = (key: keyof Filter) => ({ name: key, 'aria-invalid': invalidFields.includes(key) || undefined, 'aria-describedby': invalidFields.includes(key) ? errorId : undefined });
    const advancedKeys: (keyof Filter)[] = ['types', 'studio', 'source', 'episode_duration_from', 'episode_duration_to', 'episodes_from', 'episodes_to', 'profile_list_exclusions', 'season', 'age_ratings'];
    const hasAdvanced = advancedKeys.some(key => Array.isArray(filter[key]) ? (filter[key] as unknown[]).length > 0 : Boolean(filter[key]));
    const parseList = (value: string) => [...new Set(value.split(',').map(item => item.trim()).filter(Boolean))];
    const update = <K extends keyof Filter>(key: K, value: Filter[K]) => setDraft(previous => ({ ...previous, [key]: value }));
    const updateNumber = (key: 'start_year' | 'end_year' | 'episodes_from' | 'episodes_to' | 'episode_duration_from' | 'episode_duration_to', value: string) => update(key, value === '' ? undefined : Number(value));
    const toggleProfileList = (id: number) => {
        const current = draft.profile_list_exclusions ?? [];
        update('profile_list_exclusions', current.includes(id) ? current.filter(item => item !== id) : [...current, id]);
    };
    const apply = () => {
        const fields: string[] = [];
        let rangeError = false;
        formRef.current?.querySelectorAll<HTMLInputElement>('input[type=number]').forEach(input => { if (input.validity.badInput) fields.push(input.name); });
        for (const [from, to, min, max] of [['start_year', 'end_year', 1900, 2100], ['episodes_from', 'episodes_to', 1, Infinity], ['episode_duration_from', 'episode_duration_to', 1, Infinity]] as const) {
            for (const key of [from, to]) {
                const value = draft[key];
                if (value != null && (!Number.isInteger(value) || value < min || value > max)) fields.push(key);
            }
            if (draft[from] != null && draft[to] != null && draft[from]! > draft[to]!) { fields.push(from, to); rangeError = true; }
        }
        setInvalidFields(fields);
        if (fields.length) {
            setError(t(rangeError ? 'ux.invalidRange' : 'ux.invalidNumber'));
            window.requestAnimationFrame(() => {
                const field = formRef.current?.querySelector<HTMLInputElement>('[aria-invalid="true"]');
                const details = field?.closest('details');
                if (details) details.open = true;
                field?.focus();
            });
            return;
        }
        setError('');
        const parsed = { ...draft, genres: parseList(genres), types: parseList(dubs) };
        const prepared = Object.fromEntries(Object.entries(parsed).filter(([, value]) => value !== undefined && value !== '' && (!Array.isArray(value) || value.length > 0))) as Filter;
        setFilter(prepared);
        onClose();
    };

    return <Modal isOpen onClose={onClose} title={t('filter.title')} size="large" contentClassName={styles.modal} footer={<div className={styles.actions}>
        <button type="button" className={styles.reset} onClick={() => { setDraft({}); setGenres(''); setDubs(''); setError(''); setInvalidFields([]); }}>{t('misc.reset')}</button>
        <button type="submit" form={formId} className={styles.apply}>{t('misc.apply')}</button>
    </div>}>
        <form id={formId} ref={formRef} className={styles.fields} noValidate onSubmit={event => { event.preventDefault(); apply(); }}>
            {error && <p id={errorId} className={styles.error} role="alert">{error}</p>}
            <Field label={t('filter.country')}><select value={draft.country ?? ''} onChange={event => update('country', (event.target.value || undefined) as Filter['country'])}><option value="">{t('misc.notImportant')}</option><option value="Япония">{t('country.japan')}</option><option value="Китай">{t('country.china')}</option><option value="Южная Корея">{t('country.southKorea')}</option></select></Field>
            <Field label={t('filter.category')}><select value={draft.category_id ?? ''} onChange={event => update('category_id', event.target.value === '' ? undefined : Number(event.target.value) as Filter['category_id'])}><option value="">{t('misc.notImportant')}</option><option value="1">{t('releaseType.series')}</option><option value="2">{t('releaseType.film')}</option><option value="3">OVA</option><option value="4">{t('releaseType.dorama')}</option></select></Field>
            <Field label={t('filter.genres')} hint={t('filter.genresHint')}><input value={genres} onChange={event => setGenres(event.target.value)} placeholder={t('filter.genresHint')} /></Field>
            <label className={styles.checkbox}><input type="checkbox" checked={draft.is_genres_exclude_mode_enabled ?? false} onChange={event => update('is_genres_exclude_mode_enabled', event.target.checked || undefined)} />{t('filter.excludeGenres')}</label>
            <div className={styles['two-columns']}><Field label={t('filter.yearFrom')}><input type="number" min="1900" max="2100" {...numericProps('start_year')} value={draft.start_year ?? ''} onChange={event => updateNumber('start_year', event.target.value)} placeholder={t('misc.notImportant')} /></Field><Field label={t('filter.yearTo')}><input type="number" min="1900" max="2100" {...numericProps('end_year')} value={draft.end_year ?? ''} onChange={event => updateNumber('end_year', event.target.value)} placeholder={t('misc.notImportant')} /></Field></div>
            <Field label={t('filter.status')}><select value={draft.status_id ?? ''} onChange={event => update('status_id', event.target.value === '' ? undefined : Number(event.target.value) as Filter['status_id'])}><option value="">{t('misc.notImportant')}</option><option value="1">{t('filter.statusReleased')}</option><option value="2">{t('filter.statusOngoing')}</option><option value="3">{t('filter.statusAnnounced')}</option></select></Field>
            <Field label={t('filter.sort')}><select value={draft.sort ?? 0} onChange={event => update('sort', Number(event.target.value) as Filter['sort'])}><option value="0">{t('sort.dateAddedNewFirst')}</option><option value="1">{t('filter.sortRating')}</option><option value="2">{t('filter.sortYear')}</option><option value="3">{t('filter.sortPopularity')}</option></select></Field>
            <details className={styles.advanced} open={hasAdvanced || undefined}><summary>{t('ux.moreFilters')}</summary><div className={styles.fields}>
            <Field label={t('filter.dubs')} hint={t('ux.dubsHint')}><input value={dubs} onChange={event => setDubs(event.target.value)} placeholder={t('filter.dubs')} /></Field>
            <div className={styles['two-columns']}><Field label={t('filter.studio')}><input value={draft.studio ?? ''} onChange={event => update('studio', event.target.value || undefined)} placeholder={t('misc.notImportant')} /></Field><Field label={t('filter.source')}><input value={draft.source ?? ''} onChange={event => update('source', event.target.value || undefined)} placeholder={t('misc.notImportant')} /></Field></div>
            <fieldset className={styles.fieldset}><legend>{t('filter.excludeLists')}</legend><div className={styles['checkbox-grid']}>
                {PROFILE_LISTS.map(([id, label]) => <label className={styles.checkbox} key={id}><input type="checkbox" checked={(draft.profile_list_exclusions ?? []).includes(id)} onChange={() => toggleProfileList(id)} />{t(label)}</label>)}
            </div></fieldset>
            <div className={styles['two-columns']}><Field label={t('filter.episodesFrom')}><input type="number" min="1" {...numericProps('episodes_from')} value={draft.episodes_from ?? ''} onChange={event => updateNumber('episodes_from', event.target.value)} placeholder={t('misc.notImportant')} /></Field><Field label={t('filter.episodesTo')}><input type="number" min="1" {...numericProps('episodes_to')} value={draft.episodes_to ?? ''} onChange={event => updateNumber('episodes_to', event.target.value)} placeholder={t('misc.notImportant')} /></Field></div>
            <div className={styles['two-columns']}><Field label={t('filter.durationFrom')}><input type="number" min="1" {...numericProps('episode_duration_from')} value={draft.episode_duration_from ?? ''} onChange={event => updateNumber('episode_duration_from', event.target.value)} placeholder={t('misc.notImportant')} /></Field><Field label={t('filter.durationTo')}><input type="number" min="1" {...numericProps('episode_duration_to')} value={draft.episode_duration_to ?? ''} onChange={event => updateNumber('episode_duration_to', event.target.value)} placeholder={t('misc.notImportant')} /></Field></div>
            <div className={styles['two-columns']}><Field label={t('filter.season')}><select value={draft.season ?? ''} onChange={event => update('season', event.target.value === '' ? undefined : Number(event.target.value) as Filter['season'])}><option value="">{t('misc.notImportant')}</option><option value="1">{t('seasons.winter')}</option><option value="2">{t('seasons.spring')}</option><option value="3">{t('seasons.summer')}</option><option value="4">{t('seasons.autumn')}</option></select></Field></div>
            <Field label={t('filter.ageRating')}><select value={draft.age_ratings?.[0] ?? ''} onChange={event => update('age_ratings', event.target.value === '' ? [] : [Number(event.target.value)] as Filter['age_ratings'])}><option value="">{t('misc.notImportant')}</option><option value="1">0+</option><option value="2">6+</option><option value="3">12+</option><option value="4">16+</option><option value="5">18+</option></select></Field>
            </div></details>
        </form>
    </Modal>;
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
    return <label className={styles.field}><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}
