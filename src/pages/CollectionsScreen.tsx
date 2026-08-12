import { useCallback, useEffect, useRef, useState } from 'react';
import RemoteImage from '../components/RemoteImage';
import CollectionCard from '../components/CollectionCard';
import { useApi } from '../shared/apiClient';
import type { Anime, Collection, PagedResponse } from '../shared/types/api';
import { useAsyncLoad } from '../shared/useAsyncLoad';
import { useSearchScope } from '../shared/contexts/searchContext';
import { useUser } from '../shared/contexts/userContext';
import { Modal } from '../modals/ModalTemplate';
import SelectDropdown from '../components/SelectDropdown';
import { useSearchParams } from 'react-router-dom';
import styles from './CollectionsScreen.module.css';

const COLLECTION_SORTS = [
    { value: 1, label: 'Популярное за всё время' },
    { value: 2, label: 'Популярное за год' },
    { value: 3, label: 'Популярное за сезон' },
    { value: 4, label: 'Популярное за неделю' },
    { value: 5, label: 'Недавно добавленные' },
    { value: 6, label: 'Случайный порядок' },
] as const;

type CollectionsView = 'all' | 'mine';
type CreateCollectionResponse = { code: number; collection?: Collection; id?: number };
type ReleaseSearchResponse = { code: number; releases?: Anime[]; content?: Anime[] };

function isEmptyCollectionResponse(error: unknown) {
    return error instanceof Error && error.message === 'API error: 1';
}

export default function CollectionsScreen() {
    const api = useApi();
    const { userId, userToken } = useUser();
    const [searchParams] = useSearchParams();
    const { setSearchScope } = useSearchScope();
    const triggerRef = useRef<HTMLDivElement | null>(null);
    const [firstPagesCache, setFirstPagesCache] = useState(() => new Map<string, PagedResponse<Collection>>());
    const extraPagesCacheRef = useRef(new Map<string, Array<{ page: number; collections: Collection[] }>>());
    const activeCacheKeyRef = useRef('');
    const [extraPages, setExtraPages] = useState<Array<{ page: number; collections: Collection[] }>>([]);
    const [isLoadingMore, setIsLoadingMore] = useState(false);
    const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
    const [view, setView] = useState<CollectionsView>(() => searchParams.get('view') === 'mine' ? 'mine' : 'all');
    const [sort, setSort] = useState<(typeof COLLECTION_SORTS)[number]['value']>(5);
    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
    const [newCollectionTitle, setNewCollectionTitle] = useState('');
    const [newCollectionDescription, setNewCollectionDescription] = useState('');
    const [newCollectionCover, setNewCollectionCover] = useState<File | null>(null);
    const [isNewCollectionPrivate, setIsNewCollectionPrivate] = useState(false);
    const [releaseQuery, setReleaseQuery] = useState('');
    const [releaseResults, setReleaseResults] = useState<Anime[]>([]);
    const [isReleaseSearchLoading, setIsReleaseSearchLoading] = useState(false);
    const [selectedReleases, setSelectedReleases] = useState<Anime[]>([]);
    const [createError, setCreateError] = useState<string | null>(null);
    const [createNotice, setCreateNotice] = useState<string | null>(null);
    const [isCreating, setIsCreating] = useState(false);
    const profileCollectionId = Number(searchParams.get('profileId'));
    const isProfileView = Number.isInteger(profileCollectionId) && profileCollectionId > 0;
    const isMine = view === 'mine';
    const canShowMine = userId > 0;
    const getCacheKey = useCallback((targetView: CollectionsView, targetSort: number) => `${isProfileView ? `profile:${profileCollectionId}` : targetView}:${targetSort}:${targetView === 'mine' ? userId : ''}`, [isProfileView, profileCollectionId, userId]);
    const cacheKey = getCacheKey(view, sort);
    const getPagePath = useCallback((page: number, previousPage: number) => {
        const basePath = isProfileView
            ? `/collection/all/profile/${profileCollectionId}/${page}`
            : isMine
                ? `/collection/all/profile/${userId}/${page}`
                : `/collection/all/${page}`;
        return `${basePath}?previous_page=${previousPage}&sort=${sort}`;
    }, [isMine, isProfileView, profileCollectionId, sort, userId]);
    const { data, error, isLoading, reload } = useAsyncLoad(
        signal => {
            const cached = firstPagesCache.get(cacheKey);
            if (cached) return Promise.resolve(cached);

            return api.get<PagedResponse<Collection>>(getPagePath(0, -1), { signal })
                .catch(error => {
                    if (isEmptyCollectionResponse(error)) {
                        return { code: 0, content: [], total_count: 0, total_page_count: 0, current_page: 0 };
                    }
                    throw error;
                })
                .then(response => {
                    setFirstPagesCache(current => new Map(current).set(cacheKey, response));
                    return response;
                });
        },
        [api, cacheKey, firstPagesCache, getPagePath],
        {
            enabled: isProfileView || !isMine || canShowMine,
            initialData: { code: 0, content: [], total_count: 0, total_page_count: 0, current_page: 0 },
        },
    );
    const cachedData = firstPagesCache.get(cacheKey);
    const currentData = cachedData ?? data;
    const isCurrentViewLoading = isLoading && !cachedData;
    const initialCollections = currentData?.content ?? [];
    const collections = [...initialCollections, ...extraPages.flatMap(item => item.collections)];
    const lastLoadedPage = extraPages.at(-1)?.page ?? currentData?.current_page ?? 0;
    const hasMore = lastLoadedPage < (currentData?.total_page_count ?? 0);
    const errorMessage = error instanceof Error ? error.message : error ? 'Не удалось загрузить коллекции' : null;

    useEffect(() => {
        setSearchScope({ type: 'collections' });
        return () => setSearchScope({ type: 'releases' });
    }, [setSearchScope]);

    useEffect(() => {
        activeCacheKeyRef.current = cacheKey;
    }, [cacheKey]);

    useEffect(() => {
        const query = releaseQuery.trim();
        if (!isCreateModalOpen || query.length < 2) return;

        let isCurrent = true;
        const timer = window.setTimeout(() => {
            setIsReleaseSearchLoading(true);
            api.post<ReleaseSearchResponse>('/search/releases/0', { query, searchBy: 0 }, { 'Api-Version': 'v2' })
                .then(data => {
                    if (isCurrent) setReleaseResults(data.releases ?? data.content ?? []);
                })
                .catch(() => {
                    if (isCurrent) setReleaseResults([]);
                })
                .finally(() => {
                    if (isCurrent) setIsReleaseSearchLoading(false);
                });
        }, 350);

        return () => {
            isCurrent = false;
            window.clearTimeout(timer);
        };
    }, [api, isCreateModalOpen, releaseQuery]);

    const loadMore = useCallback(async () => {
        if (!hasMore || isLoadingMore) return;

        const page = lastLoadedPage + 1;
        setIsLoadingMore(true);
        setLoadMoreError(null);
        try {
            const response = await api.get<PagedResponse<Collection>>(getPagePath(page, lastLoadedPage));
            const cachedPages = extraPagesCacheRef.current.get(cacheKey) ?? [];
            const nextPages = cachedPages.some(item => item.page === page)
                ? cachedPages
                : [...cachedPages, { page, collections: response.content ?? [] }];
            extraPagesCacheRef.current.set(cacheKey, nextPages);
            if (activeCacheKeyRef.current === cacheKey) setExtraPages(nextPages);
        } catch (error) {
            if (isEmptyCollectionResponse(error)) {
                const nextPages = [...(extraPagesCacheRef.current.get(cacheKey) ?? []), { page, collections: [] }];
                extraPagesCacheRef.current.set(cacheKey, nextPages);
                if (activeCacheKeyRef.current === cacheKey) setExtraPages(nextPages);
                return;
            }
            setLoadMoreError('Не удалось загрузить следующую страницу.');
        } finally {
            setIsLoadingMore(false);
        }
    }, [api, cacheKey, getPagePath, hasMore, isLoadingMore, lastLoadedPage]);

    const changeView = (nextView: CollectionsView) => {
        if (nextView === 'mine' && !canShowMine) {
            alert('Войдите в аккаунт, чтобы посмотреть свои коллекции');
            return;
        }
        if (nextView === view) return;
        extraPagesCacheRef.current.set(cacheKey, extraPages);
        setView(nextView);
        setExtraPages(extraPagesCacheRef.current.get(getCacheKey(nextView, sort)) ?? []);
        setLoadMoreError(null);
    };

    const changeSort = (nextSort: number) => {
        if (!COLLECTION_SORTS.some(option => option.value === nextSort)) return;
        extraPagesCacheRef.current.set(cacheKey, extraPages);
        setSort(nextSort as (typeof COLLECTION_SORTS)[number]['value']);
        setExtraPages(extraPagesCacheRef.current.get(getCacheKey(view, nextSort)) ?? []);
        setLoadMoreError(null);
    };

    const createCollection = async () => {
        const title = newCollectionTitle.trim();
        const description = newCollectionDescription.trim();
        if (isCreating) return;
        if (title.length < 10 || title.length > 60) {
            setCreateError('Название должно содержать от 10 до 60 символов.');
            return;
        }
        if (description.length > 1000) {
            setCreateError('Описание не должно превышать 1000 символов.');
            return;
        }
        if (selectedReleases.length === 0) {
            setCreateError('Добавьте хотя бы один релиз.');
            return;
        }
        if (selectedReleases.length > 100) {
            setCreateError('В коллекции может быть не больше 100 релизов.');
            return;
        }
        if (!userToken) {
            setCreateError('Войдите в аккаунт, чтобы создать коллекцию.');
            return;
        }

        setIsCreating(true);
        setCreateError(null);
        try {
            const created = await api.postViaAgent<CreateCollectionResponse>('/collectionMy/create', {
                title,
                description,
                is_private: isNewCollectionPrivate,
                releases: selectedReleases.map(release => release.id),
            });
            const collectionId = created.collection?.id ?? created.id;
            let coverUploadFailed = false;
            if (newCollectionCover) {
                if (!collectionId) {
                    coverUploadFailed = true;
                } else {
                    const image = new FormData();
                    image.append('image', newCollectionCover, newCollectionCover.name);
                    image.append('name', 'image');
                    try {
                        await api.postFormViaAgent(`/collectionMy/editImage/${collectionId}`, image);
                    } catch (error) {
                        coverUploadFailed = true;
                        console.error('Коллекция создана, но обложку загрузить не удалось:', error);
                    }
                }
            }
            setNewCollectionTitle('');
            setNewCollectionDescription('');
            setNewCollectionCover(null);
            setIsNewCollectionPrivate(false);
            setReleaseQuery('');
            setReleaseResults([]);
            setSelectedReleases([]);
            setIsCreateModalOpen(false);
            setCreateNotice(coverUploadFailed
                ? 'Коллекция создана, но обложку загрузить не удалось. Её можно добавить позже при редактировании.'
                : null);
            setFirstPagesCache(current => {
                const next = new Map(current);
                next.delete(getCacheKey('mine', sort));
                return next;
            });
            extraPagesCacheRef.current.delete(getCacheKey('mine', sort));
            setExtraPages([]);
            if (view === 'mine') reload();
            else changeView('mine');
        } catch (error) {
            setCreateError(error instanceof Error ? error.message : 'Не удалось создать коллекцию.');
        } finally {
            setIsCreating(false);
        }
    };

    useEffect(() => {
        const trigger = triggerRef.current;
        if (!trigger || !hasMore || isCurrentViewLoading || isLoadingMore) return;

        const observer = new IntersectionObserver(entries => {
            if (entries[0]?.isIntersecting) void loadMore();
        }, { rootMargin: '240px' });

        observer.observe(trigger);
        return () => observer.disconnect();
    }, [hasMore, isCurrentViewLoading, isLoadingMore, loadMore]);

    return <section className={styles.main}>
        <header className={styles.header}>
            <div>
                <h1>{isProfileView ? 'Коллекции пользователя' : 'Коллекции'}</h1>
                <p>{isProfileView ? 'Подборки, созданные пользователем' : 'Подборки аниме от сообщества'}</p>
            </div>
            <div className={styles.toolbar}>
                {!isProfileView && <><button type="button" className={`${styles.toolbarButton} ${styles.createButton}`} onClick={() => setIsCreateModalOpen(true)}>Создать коллекцию</button>
                <button type="button" className={`${styles.toolbarButton} ${isMine ? styles.toolbarButtonActive : ''}`} onClick={() => changeView(isMine ? 'all' : 'mine')}>{isMine ? 'Все коллекции' : 'Мои коллекции'}</button></>}
                <div className={styles.sortDropdown}>
                    <SelectDropdown value={sort} options={COLLECTION_SORTS} onChange={changeSort} ariaLabel="Сортировка коллекций" />
                </div>
            </div>
        </header>
        {createNotice && <p className={styles.message} role="status">{createNotice}</p>}
        {isCurrentViewLoading && <p className={styles.message}>Загружаем коллекции...</p>}
        {errorMessage && <p className={`${styles.message} ${styles.error}`}>{errorMessage}</p>}
        {!isCurrentViewLoading && !errorMessage && collections.length === 0 && <p className={styles.message}>Коллекций пока нет.</p>}
        <div className={styles.list}>
            {collections.map(collection => <CollectionCard key={collection.id} collection={collection} />)}
        </div>
        {hasMore && <div ref={triggerRef} className={styles.loadMoreTrigger} />}
        {isLoadingMore && <p className={styles.loadingMore}>Загружаем ещё коллекции…</p>}
        {loadMoreError && <p className={`${styles.message} ${styles.error}`}>{loadMoreError}</p>}
        <Modal isOpen={isCreateModalOpen} onClose={() => setIsCreateModalOpen(false)} title="Новая коллекция" contentClassName={styles.createModal}>
            <form className={styles.createForm} onSubmit={event => {
                event.preventDefault();
                void createCollection();
            }}>
                <label>
                    <span>Название</span>
                    <input value={newCollectionTitle} minLength={10} maxLength={60} onChange={event => {
                        setNewCollectionTitle(event.target.value);
                        setCreateError(null);
                    }} autoFocus />
                </label>
                <label>
                    <span>Описание</span>
                    <textarea value={newCollectionDescription} maxLength={1000} onChange={event => setNewCollectionDescription(event.target.value)} />
                </label>
                <label className={styles.coverField}>
                    <span>Обложка</span>
                    <input type="file" accept="image/*" onChange={event => setNewCollectionCover(event.target.files?.[0] ?? null)} />
                    <small>{newCollectionCover ? newCollectionCover.name : 'Не выбрана'}</small>
                </label>
                <label className={styles.privateToggle}>
                    <input type="checkbox" checked={isNewCollectionPrivate} onChange={event => setIsNewCollectionPrivate(event.target.checked)} />
                    <span>Доступна только мне</span>
                </label>
                <div className={styles.releasePicker}>
                    <span>Релизы в коллекции ({selectedReleases.length}/100)</span>
                    <input value={releaseQuery} placeholder="Начните вводить название…" onChange={event => setReleaseQuery(event.target.value)} />
                    {releaseQuery.trim().length >= 2 && <div className={styles.releaseSearchResults}>
                        {isReleaseSearchLoading && <small>Ищем релизы…</small>}
                        {!isReleaseSearchLoading && releaseResults.map(release => {
                            const isSelected = selectedReleases.some(selected => selected.id === release.id);
                            return <button key={release.id} type="button" disabled={isSelected || selectedReleases.length >= 100} onClick={() => {
                                setSelectedReleases(current => [...current, release]);
                                setReleaseQuery('');
                                setReleaseResults([]);
                            }}>
                                <RemoteImage src={release.image} alt="" />
                                <span>{release.title_ru}</span>
                            </button>;
                        })}
                        {!isReleaseSearchLoading && releaseResults.length === 0 && <small>Ничего не найдено</small>}
                    </div>}
                    {selectedReleases.length > 0 && <div className={styles.selectedReleases}>
                        {selectedReleases.map(release => <button key={release.id} type="button" onClick={() => setSelectedReleases(current => current.filter(selected => selected.id !== release.id))}>
                            <span>{release.title_ru}</span> ×
                        </button>)}
                    </div>}
                </div>
                {createError && <p className={styles.error}>{createError}</p>}
                <button type="submit" className={styles.createSubmit} disabled={isCreating}>{isCreating ? 'Создаём…' : 'Создать'}</button>
            </form>
        </Modal>
    </section>;
}
