import styles from './PageLayout.module.css';

type PageStateStatus = 'loading' | 'error' | 'empty';

interface PageStateProps {
    status: PageStateStatus;
    message?: string;
    onRetry?: () => void;
    retryLabel?: string;
}

const defaultMessages: Record<PageStateStatus, string> = {
    loading: 'Загрузка…',
    error: 'Не удалось загрузить данные.',
    empty: 'Здесь пока ничего нет.',
};

export default function PageState({ status, message, onRetry, retryLabel = 'Попробовать снова' }: PageStateProps) {
    const isError = status === 'error';
    return <div className={`${styles.state} ${isError ? styles.stateError : ''}`} role={isError ? 'alert' : 'status'} aria-live={isError ? 'assertive' : 'polite'} aria-busy={status === 'loading'}>
        <p>{message ?? defaultMessages[status]}</p>
        {isError && onRetry && <button type="button" onClick={onRetry}>{retryLabel}</button>}
    </div>;
}

export type { PageStateProps, PageStateStatus };
