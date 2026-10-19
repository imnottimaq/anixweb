import { useCallback, useEffect, useLayoutEffect, useRef, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from '../shared/useTranslation';
import styles from './TabContextMenu.module.css';

export interface TabContextMenuItem {
    key: string;
    label: string;
    disabled?: boolean;
    onClick: () => void;
    restoreFocusOnSelect?: boolean;
}

export interface TabContextMenuProps {
    x: number;
    y: number;
    trigger: HTMLElement | null;
    title?: string;
    items: TabContextMenuItem[];
    onClose: () => void;
    'aria-label'?: string;
}

export default function TabContextMenu({
    x,
    y,
    trigger,
    title,
    items,
    onClose,
    'aria-label': ariaLabel,
}: TabContextMenuProps) {
    const { t } = useTranslation();
    const root = useRef<HTMLDivElement>(null);

    const close = useCallback((restoreFocus = true) => {
        onClose();
        if (restoreFocus && trigger && trigger.isConnected) {
            trigger.focus();
        }
    }, [onClose, trigger]);

    useEffect(() => {
        const handlePointerDown = (event: PointerEvent) => {
            if (!root.current?.contains(event.target as Node)) {
                close(true);
            }
        };

        const handleScroll = (event: Event) => {
            if (!root.current?.contains(event.target as Node)) {
                close(true);
            }
        };

        const handleResize = () => {
            close(true);
        };

        window.addEventListener('pointerdown', handlePointerDown, true);
        window.addEventListener('scroll', handleScroll, true);
        window.addEventListener('resize', handleResize);

        return () => {
            window.removeEventListener('pointerdown', handlePointerDown, true);
            window.removeEventListener('scroll', handleScroll, true);
            window.removeEventListener('resize', handleResize);
        };
    }, [close]);

    useLayoutEffect(() => {
        const element = root.current;
        if (!element) return;

        const position = () => {
            const rect = element.getBoundingClientRect();
            const padding = 8;
            const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
            const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
            element.style.left = `${Math.max(padding, Math.min(x, viewportWidth - rect.width - padding))}px`;
            element.style.top = `${Math.max(padding, Math.min(y, viewportHeight - rect.height - padding))}px`;
        };
        position();
        // Lazy-loaded styles and fonts can change the dimensions after the first layout.
        const observer = new ResizeObserver(position);
        observer.observe(element);
        const frame = requestAnimationFrame(position);

        if (!element.contains(document.activeElement)) {
            element.focus();
        }
        const firstItem = element.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)');
        firstItem?.focus();
        return () => { observer.disconnect(); cancelAnimationFrame(frame); };
    }, [x, y]);

    const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        event.stopPropagation();

        if (event.key === 'Escape' || event.key === 'Tab') {
            event.preventDefault();
            close(true);
            return;
        }

        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
            event.preventDefault();
            const element = root.current;
            if (!element) return;

            const menuItems = Array.from(
                element.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)')
            );
            if (menuItems.length === 0) return;

            const currentIndex = menuItems.indexOf(document.activeElement as HTMLElement);

            let nextIndex = 0;
            if (event.key === 'Home') {
                nextIndex = 0;
            } else if (event.key === 'End') {
                nextIndex = menuItems.length - 1;
            } else if (event.key === 'ArrowDown') {
                nextIndex = currentIndex >= 0 ? (currentIndex + 1) % menuItems.length : 0;
            } else if (event.key === 'ArrowUp') {
                nextIndex = currentIndex >= 0 ? (currentIndex - 1 + menuItems.length) % menuItems.length : menuItems.length - 1;
            }

            menuItems[nextIndex]?.focus();
        }
    };

    return createPortal(
        <div
            ref={root}
            className={styles.menu}
            role="menu"
            aria-label={ariaLabel || t('tabMenu.title')}
            tabIndex={-1}
            onKeyDown={handleKeyDown}
            onContextMenu={event => {
                event.preventDefault();
                event.stopPropagation();
            }}
        >
            {title && <p className={styles.title}>{title}</p>}
            {items.map(item => (
                <button
                    key={item.key}
                    type="button"
                    role="menuitem"
                    disabled={item.disabled}
                    onClick={() => {
                        item.onClick();
                        close(item.restoreFocusOnSelect ?? true);
                    }}
                >
                    {item.label}
                </button>
            ))}
        </div>,
        document.body
    );
}
