import { useCallback, useEffect, useId, useRef, useState, type UIEventHandler } from 'react';
import { useDialogFocus } from '../shared/useDialogFocus';
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
    onCloseStart?: () => void;

    title?: string;
    text?: string;
    actions?: ModalAction[];
    footer?: React.ReactNode;
    children?: React.ReactNode | ((close: () => void) => React.ReactNode);

    size? : "small" | "medium" | "large" | "fullscreen";
    showCloseButton?: boolean;
    stickyHeader?: boolean;
    onBodyScroll?: UIEventHandler<HTMLDivElement>;
    contentClassName?: string;
    contentStyle?: React.CSSProperties;
};

export function Modal({ isOpen, onClose, onCloseStart, title, text, actions, children, footer, size, showCloseButton, stickyHeader = true, onBodyScroll, contentClassName, contentStyle }: ModalProps) {
    const { t } = useTranslation();
    const [isClosing, setIsClosing] = useState(false);
    const titleId = useId();
    const dialogRef = useRef<HTMLElement>(null);
    const closeTimer = useRef<number | undefined>(undefined);
    const onCloseRef = useRef(onClose);
    const onCloseStartRef = useRef(onCloseStart);
    useEffect(() => { onCloseRef.current = onClose; onCloseStartRef.current = onCloseStart; }, [onClose, onCloseStart]);

    const handleClose = useCallback(() => {
        if (closeTimer.current !== undefined) return;

        onCloseStartRef.current?.();
        setIsClosing(true);
        closeTimer.current = window.setTimeout(() => {
            closeTimer.current = undefined;
            setIsClosing(false);
            onCloseRef.current();
        }, 180);
    }, []);

    useDialogFocus(dialogRef, isOpen, handleClose);
    useEffect(() => () => {
        window.clearTimeout(closeTimer.current);
        closeTimer.current = undefined;
        setIsClosing(false);
    }, [isOpen]);
    if (!isOpen) return null;

    return (
        <div
        className={`${styles['modal-overlay']} ${isClosing ? styles['modal-overlay-closing'] : ''}`}
        role="presentation"
        onMouseDown={handleClose}
        >
        <section
            ref={dialogRef}
            tabIndex={-1}
            className={[
                styles.modal,
                `${ size ? styles[`size-${size ?? ''}`]: ""}`,
                stickyHeader ? styles['sticky-header'] : '',
                footer ? styles['with-footer'] : '',
                contentClassName,
                isClosing ? styles['modal-closing'] : '',
            ].filter(Boolean).join(' ')}
            style={contentStyle}
            role="dialog"
            aria-modal="true"
            aria-labelledby={title ? titleId : undefined}
            onMouseDown={(event) => event.stopPropagation()}
        >
            {(title || showCloseButton !== false) && <header className={styles['modal-header']}>
                {title && <h2 id={titleId} className={styles.title}>{title}</h2>}
                {showCloseButton !== false && <button type="button" className={styles['close-button']} onClick={handleClose} aria-label={t('misc.close')}>
                    <img alt="" src={XMarkIcon}/>
                </button>}
            </header>}
            <div className={styles['modal-body']} onScroll={onBodyScroll}>
                {text && <p className={styles.text}>{text}</p>}
                {/* The render prop receives an event callback; it never reads refs during render. */}
                {/* eslint-disable-next-line react-hooks/refs */}
                {typeof children === 'function' ? children(handleClose) : children}

                {actions && (
                <footer className={styles.actions}>
                    {actions.map((action) => (
                    <button
                        type="button"
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
            {footer && <footer className={styles.footer}>{footer}</footer>}
        </section>
        </div>
    );
}
