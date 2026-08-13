import styles from './PageLayout.module.css';
import { useTranslation } from '../shared/useTranslation';

type PageStateStatus = 'loading' | 'error' | 'empty';

interface PageStateProps {
    status: PageStateStatus;
    message?: string;
    onRetry?: () => void;
    retryLabel?: string;
}

export default function PageState({ status, message, onRetry, retryLabel }: PageStateProps) {
    const { t } = useTranslation();
    const isError = status === 'error';
    return <div className={`${styles.state} ${isError ? styles.stateError : ''}`} role={isError ? 'alert' : 'status'} aria-live={isError ? 'assertive' : 'polite'} aria-busy={status === 'loading'}>
        <p>{message ?? t(`page.${status}`)}</p>
        {isError && onRetry && <button type="button" onClick={onRetry}>{retryLabel ?? t('page.retry')}</button>}
    </div>;
}

export type { PageStateProps, PageStateStatus };
