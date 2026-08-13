import type { HTMLAttributes, ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import styles from './PageLayout.module.css';
import { useTranslation } from '../shared/useTranslation';

interface PageLayoutProps extends HTMLAttributes<HTMLElement> {
    children: ReactNode;
    size?: 'default' | 'wide';
}

interface PageHeaderProps {
    title: ReactNode;
    description?: ReactNode;
    actions?: ReactNode;
    back?: boolean;
}

interface BackButtonProps {
    label?: string;
    onClick?: () => void;
}

export function PageLayout({ children, className = '', size = 'default', ...props }: PageLayoutProps) {
    return <div className={`${styles.page} ${size === 'wide' ? styles.wide : ''} ${className}`} {...props}>{children}</div>;
}

export function PageHeader({ title, description, actions, back = false }: PageHeaderProps) {
    return <header className={styles.header}>
        <div className={styles.heading}>
            {back && <BackButton />}
            <div>
                <h1>{title}</h1>
                {description && <p>{description}</p>}
            </div>
        </div>
        {actions && <div className={styles.actions}>{actions}</div>}
    </header>;
}

export function BackButton({ label, onClick }: BackButtonProps) {
    const navigate = useNavigate();
    const { t } = useTranslation();
    const accessibleLabel = label ?? t('page.back');
    return <button type="button" className={styles.backButton} aria-label={accessibleLabel} onClick={onClick ?? (() => navigate(-1))}>
        <span aria-hidden="true" />
    </button>;
}
