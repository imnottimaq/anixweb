import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import AnimeCard from '../components/AnimeCard';
import AnimeCardHorizontal from '../components/AnimeCardHorizontal';
import PageState from '../components/PageState';
import { PageLayout } from '../components/PageLayout';
import RemoteImage from '../components/RemoteImage';
import { useApi } from '../shared/apiClient';
import type { Anime, DiscoverInteresting, PagedResponse } from '../shared/types/api';
import leftArrowIcon from '../assets/icons/left-arrow.svg';
import rightArrowIcon from '../assets/icons/right-arrow.svg';
import styles from './OverviewScreen.module.css';
import { useAsyncLoad } from '../shared/useAsyncLoad';
import { useTranslation } from '../shared/useTranslation';

import {
    resolveCommentReleases,
    getCommentReleaseDisplayTitle,
    extractReleaseId,
    type DiscoverCommentItem,
} from '../shared/discover/commentTitle';

type DiscoverComment = DiscoverCommentItem;

type OverviewData = {
    interesting: DiscoverInteresting[];
    watching: Anime[];
    discussing: Anime[];
    comments: DiscoverComment[];
    failedSections: number;
};

const EMPTY_DATA: OverviewData = {
    interesting: [], watching: [], discussing: [], comments: [], failedSections: 0,
};


export default function OverviewScreen() {
    const api = useApi();
    const { t, language } = useTranslation();
    const navigate = useNavigate();
    const [activeInterestingIndex, setActiveInterestingIndex] = useState(0);

    const recommendations = useAsyncLoad(
        signal => api.post<PagedResponse<Anime>>('/discover/recommendations/-1?previous_page=-1', undefined, undefined, { signal }),
        [api],
    );
    const recommendedReleases = recommendations.data?.content ?? [];

    const { data = EMPTY_DATA, isLoading, error, reload } = useAsyncLoad(signal => {
        const post = <T,>(path: string) => api.post<PagedResponse<T>>(path, undefined, undefined, { signal });

        const promise = Promise.allSettled([
            post<DiscoverInteresting>('/discover/interesting'),
            post<Anime>('/discover/watching/0'),
            post<Anime>('/discover/discussing'),
            post<DiscoverComment>('/discover/comments'),
        ] as const).then(results => {
            if (signal.aborted) throw new DOMException('Запрос отменён', 'AbortError');
            const [interesting, watching, discussing, comments] = results;
            const failedSections = results.filter(result => result.status === 'rejected').length;
            if (failedSections === results.length) throw new Error('Не удалось загрузить обзор.');

            const result = {
                interesting: getContent(interesting),
                watching: getContent(watching),
                discussing: getContent(discussing),
                comments: resolveCommentReleases(getContent(comments)),
                failedSections,
            };
            return result;
        });

        return promise;
    }, [api], { initialData: EMPTY_DATA });

    const visibleInterestingIndex = data.interesting.length > 0
        ? activeInterestingIndex % data.interesting.length
        : 0;

    return <PageLayout className={styles.page} size="wide">
        {isLoading && <PageState status="loading" message={t('overview.loading')} />}
        {!isLoading && Boolean(error) && <PageState status="error" message={t('overview.error')} onRetry={reload} />}

        {!isLoading && !error && <>
            {data.failedSections > 0 && <div className={styles.partialError} role="alert"><span>{t('roadmap.discover.overview.partialError')}</span><button type="button" onClick={reload}>{t('page.retry')}</button></div>}
            {(data.interesting.length > 0 || data.discussing.length > 0) && <div className={styles.topLayout}>
                {data.interesting.length > 0 && <section className={styles.featured}>
                    <SectionTitle title={t('overview.interesting')} />
                    <div className={styles.gallery}>
                        <FeaturedItem key={data.interesting[visibleInterestingIndex].id} item={data.interesting[visibleInterestingIndex]} />
                        {data.interesting.length > 1 && <>
                            <button
                                type="button"
                                className={`${styles.galleryButton} ${styles.galleryPrevious}`}
                                aria-label={t('overview.previous')}
                                onClick={() => setActiveInterestingIndex(index => (index - 1 + data.interesting.length) % data.interesting.length)}
                            ><img src={leftArrowIcon} alt="" /></button>
                            <button
                                type="button"
                                className={`${styles.galleryButton} ${styles.galleryNext}`}
                                aria-label={t('overview.next')}
                                onClick={() => setActiveInterestingIndex(index => (index + 1) % data.interesting.length)}
                            ><img src={rightArrowIcon} alt="" /></button>
                        </>}
                    </div>
                </section>}

                {data.discussing.length > 0 && <section className={styles.topDiscussing}>
                    <SectionTitle title={t('overview.discussing')} />
                    <div className={styles.releaseList}>
                        {data.discussing.map(anime => <AnimeCardHorizontal key={anime.id} anime={anime} compact />)}
                    </div>
                </section>}
            </div>}

            <nav className={styles.quickActions} aria-label={t('overview.quickAria')}>
                <Link to="/popular" className={`${styles.quickAction} ${styles.quickActionPopular}`}>
                    <span className={styles.quickActionIcon} aria-hidden="true" />
                    <span>{t('overview.popular')}</span>
                </Link>
                <Link to="/schedule" className={`${styles.quickAction} ${styles.quickActionSchedule}`}>
                    <span className={styles.quickActionIcon} aria-hidden="true" />
                    <span>{t('overview.schedule')}</span>
                </Link>
                <button type="button" className={`${styles.quickAction} ${styles.quickActionFilter}`} onClick={() => navigate('/filter')}>
                    <span className={styles.quickActionIcon} aria-hidden="true" />
                    <span>{t('overview.filter')}</span>
                </button>
                <Link to="/random" className={`${styles.quickAction} ${styles.quickActionRandom}`}>
                    <span className={styles.quickActionIcon} aria-hidden="true" />
                    <span>{t('overview.random')}</span>
                </Link>
            </nav>
        </>}

            <section className={styles.section}>
                <SectionTitle title={t('overview.recommended')} description={t('overview.recommendedDescription')} />
                {recommendations.isLoading ? <PageState status="loading" message={t('overview.recommendationsLoading')} />
                    : recommendations.error ? <PageState status="error" message={t('overview.recommendationsError')} onRetry={recommendations.reload} />
                    : recommendedReleases.length > 0
                    ? <div className={styles.posterRail}>
                        {recommendedReleases.map(anime => <AnimeCard key={anime.id} anime={anime} />)}
                    </div>
                    : <p className={styles.recommendationsEmpty}>{t('overview.rateMore')}</p>}
            </section>

        {!isLoading && !error && <>
            {data.watching.length > 0 && <section className={styles.section}>
                <SectionTitle title={t('overview.watching')} />
                <div className={styles.posterRail}>
                    {data.watching.map(anime => <AnimeCard key={anime.id} anime={anime} />)}
                </div>
            </section>}

            {data.comments.length > 0 && <section className={styles.section}>
                <SectionTitle title={t('overview.weekComments')} />
                <div className={styles.comments}>
                    {data.comments.slice(0, 6).map(comment => <CommentPreview key={comment.id} comment={comment} language={language} />)}
                </div>
            </section>}

            {!data.interesting.length && !recommendedReleases.length && !data.watching.length && !data.discussing.length && <p className={styles.empty}>{t('overview.empty')}</p>}
        </>}
    </PageLayout>;
}

function getContent<T>(result: PromiseSettledResult<PagedResponse<T>>): T[] {
    return result.status === 'fulfilled' ? result.value.content ?? [] : [];
}

function SectionTitle({ title, description }: { title: string; description?: string }) {
    return <div className={styles.sectionTitle}>
        <h2>{title}</h2>
        {description && <p>{description}</p>}
    </div>;
}

function FeaturedItem({ item }: { item: DiscoverInteresting }) {
    const content = <>
        <RemoteImage src={item.image} alt="" />
        <span className={styles.featuredShade} />
        <span className={styles.featuredText}>
            <strong>{item.title}</strong>
            {item.description && <small>{item.description}</small>}
        </span>
    </>;

    return item.action > 0
        ? <Link to={`/anime/${item.action}`} className={styles.featuredItem}>{content}</Link>
        : <article className={styles.featuredItem}>{content}</article>;
}

function CommentPreview({ comment, language }: { comment: DiscoverComment; language: 'russian' | 'english' }) {
    const releaseId = extractReleaseId(comment);
    const releaseTitle = getCommentReleaseDisplayTitle(comment, language);
    const canOpenRelease = typeof releaseId === 'number' && releaseId > 0;
    const content = <>
        <RemoteImage className={styles.commentAvatar} src={comment.profile.avatar} alt="" />
        <span className={styles.commentBody}>
            <span>
                <b>{comment.profile.login}</b>
                {releaseTitle && <> · {releaseTitle}</>}
            </span>
            <span className={styles.commentMessage}>{comment.message}</span>
        </span>
        {typeof comment.vote_count === 'number' && comment.vote_count > 0 && (
            <em className={styles.commentRating}>{comment.vote_count}</em>
        )}
    </>;

    return canOpenRelease
        ? <Link className={styles.comment} to={`/anime/${releaseId}`}>{content}</Link>
        : <article className={styles.comment}>{content}</article>;
}
