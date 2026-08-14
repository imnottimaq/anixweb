import { useState, type UIEventHandler } from 'react';
import XMarkIcon from '../assets/icons/xmark.svg'
import styles from './ModalTemplate.module.css'
import { useTranslation } from '../shared/useTranslation';

type ModalAction = {
    label: string;
    onClick: () => void;
    variant?: 'primary' | 'secondary' | 'danger';
};

type ModalProps = {
    isOpen: boolean;
    onClose: () => void;

    title?: string;
    text?: string;
    actions?: ModalAction[];
    children?: React.ReactNode | ((close: () => void) => React.ReactNode);

    size? : "small" | "medium" | "large" | "fullscreen";
    showCloseButton?: boolean;
    stickyHeader?: boolean;
    onBodyScroll?: UIEventHandler<HTMLDivElement>;
    contentClassName?: string;
    contentStyle?: React.CSSProperties;
};

export function Modal({ isOpen, onClose, title, text, actions, children, size, showCloseButton, stickyHeader = false, onBodyScroll, contentClassName, contentStyle }: ModalProps) {
    const { t } = useTranslation();
    const [isClosing, setIsClosing] = useState(false);

    const handleClose = () => {
        if (isClosing) return;

        setIsClosing(true);
        window.setTimeout(() => {
            setIsClosing(false);
            onClose();
        }, 180);
    };
    if (!isOpen) return null;

    return (
        <div
        className={`${styles['modal-overlay']} ${isClosing ? styles['modal-overlay-closing'] : ''}`}
        role="presentation"
        onMouseDown={handleClose}
        >
        <section
            className={[
                styles.modal,
                `${ size ? styles[`size-${size ?? ''}`]: ""}`,
                stickyHeader ? styles['sticky-header'] : '',
                contentClassName,
                isClosing ? styles['modal-closing'] : '',
            ].filter(Boolean).join(' ')}
            style={contentStyle}
            role="dialog"
            aria-modal="true"
            aria-label={title ? 'modal-title' : undefined}
            onMouseDown={(event) => event.stopPropagation()}
        >
            {(title || showCloseButton !== false) && <header className={styles['modal-header']}>
                {title && <h2 className={styles.title}>{title}</h2>}
                {showCloseButton !== false && <button className={styles['close-button']} onClick={handleClose} aria-label={t('misc.close')}>
                    <img alt="" src={XMarkIcon}/>
                </button>}
            </header>}
            <div className={styles['modal-body']} onScroll={onBodyScroll}>
                {text && <p className={styles.text}>{text}</p>}
                {typeof children === 'function' ? children(handleClose) : children}

                {actions && (
                <footer className={styles.actions}>
                    {actions.map((action) => (
                    <button
                        key={action.label}
                        className={`${styles.action} ${styles[`action-${action.variant ?? 'primary'}`]}`}
                        onClick={action.onClick}
                    >
                        {action.label}
                    </button>
                    ))}
                </footer>
                )}
            </div>
        </section>
        </div>
    );
}
