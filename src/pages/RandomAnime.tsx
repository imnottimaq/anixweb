import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { type Anime } from '../shared/types/api';
import { useTranslation } from '../shared/useTranslation';
import { useApi } from '../shared/apiClient';
import styles from './RandomAnime.module.css';

export default function RandomAnime() {
    const navigate = useNavigate();
    const api = useApi();
    const [error, setError] = useState<string | null>(null);
    const [attempt, setAttempt] = useState(0);
    const { t } = useTranslation();

    const retry = useCallback(() => {
        setError(null);
        setAttempt(current => current + 1);
    }, []);

    useEffect(() => {
        const controller = new AbortController();
        let isCurrentRequest = true;
        let hasTimedOut = false;
        const timeoutId = window.setTimeout(() => {
            hasTimedOut = true;
            controller.abort();
        }, 15_000);

        api.get<{ code: number; release: Anime }>('/release/random?extended_mode=true', { signal: controller.signal })
            .then(({ release }) => {
                if (!release?.id) throw new Error('Сервер вернул релиз без ID.');
                navigate(`/anime/${release.id}`, { replace: true, state: { partialAnime: release } });
            })
            .catch((requestError: unknown) => {
                if (!isCurrentRequest) return;
                console.error(requestError);
                setError(hasTimedOut ? t('random.timeout') : t('random.loadError'));
            })
            .finally(() => window.clearTimeout(timeoutId));

        return () => {
            isCurrentRequest = false;
            controller.abort();
            window.clearTimeout(timeoutId);
        };
    }, [api, attempt, navigate, t]);

    return <main className={styles.page}>
        <section className={styles.card} aria-live="polite" aria-busy={!error}>
            {!error && <><span className={styles.spinner} aria-hidden="true" /><p role="status">{t('random.searching')}</p></>}
            {error && <>
                <p role="alert">{error}</p>
                <div className={styles.actions}>
                    <button type="button" onClick={retry}>{t('page.retry')}</button>
                    <button type="button" onClick={() => navigate(-1)}>{t('page.back')}</button>
                </div>
            </>}
        </section>
    </main>;
}
