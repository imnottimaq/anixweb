import { useEffect, useRef, useState } from 'react';
import styles from './SortSelect.module.css';

type SelectDropdownProps<T extends string | number> = {
    value: T;
    options: ReadonlyArray<{ value: T; label: string }>;
    onChange: (value: T) => void;
    ariaLabel: string;
};

export default function SelectDropdown<T extends string | number>({ value, options, onChange, ariaLabel }: SelectDropdownProps<T>) {
    const [isOpen, setIsOpen] = useState(false);
    const selectRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);
    const selectedOption = options.find(option => option.value === value) ?? options[0];

    useEffect(() => {
        const closeOnOutsideClick = (event: MouseEvent) => {
            if (!selectRef.current?.contains(event.target as Node)) setIsOpen(false);
        };

        document.addEventListener('mousedown', closeOnOutsideClick);
        return () => document.removeEventListener('mousedown', closeOnOutsideClick);
    }, []);

    const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (event.key === 'Escape') {
            if (isOpen) {
                event.preventDefault();
                event.stopPropagation();
                setIsOpen(false);
                triggerRef.current?.focus();
            }
            return;
        }

        if (event.key === 'ArrowDown') {
            event.preventDefault();
            if (!isOpen) {
                setIsOpen(true);
                setTimeout(() => {
                    const selectedIdx = options.findIndex(opt => opt.value === value);
                    const targetIdx = selectedIdx >= 0 ? selectedIdx : 0;
                    optionRefs.current[targetIdx]?.focus();
                }, 0);
            } else {
                const currentIndex = optionRefs.current.findIndex(el => el === document.activeElement);
                const nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % options.length;
                optionRefs.current[nextIndex]?.focus();
            }
            return;
        }

        if (event.key === 'ArrowUp') {
            event.preventDefault();
            if (!isOpen) {
                setIsOpen(true);
                setTimeout(() => {
                    const selectedIdx = options.findIndex(opt => opt.value === value);
                    const targetIdx = selectedIdx >= 0 ? selectedIdx : options.length - 1;
                    optionRefs.current[targetIdx]?.focus();
                }, 0);
            } else {
                const currentIndex = optionRefs.current.findIndex(el => el === document.activeElement);
                const prevIndex = currentIndex < 0 ? options.length - 1 : (currentIndex - 1 + options.length) % options.length;
                optionRefs.current[prevIndex]?.focus();
            }
            return;
        }
    };

    if (!selectedOption) return null;

    return <div className={styles.select} ref={selectRef} onKeyDown={handleKeyDown}>
        <button
            ref={triggerRef}
            type="button"
            className={styles.trigger}
            aria-expanded={isOpen}
            aria-haspopup="listbox"
            onClick={() => setIsOpen(previous => !previous)}
        >
            <span>{selectedOption.label}</span>
            <span className={`${styles.chevron} ${isOpen ? styles['chevron-open'] : ''}`} aria-hidden="true" />
        </button>
        {isOpen && <div className={styles.options} role="listbox" aria-label={ariaLabel}>
            {options.map((option, index) => <button
                key={option.value}
                ref={el => { optionRefs.current[index] = el; }}
                type="button"
                role="option"
                aria-selected={option.value === value}
                className={`${styles.option} ${option.value === value ? styles.selected : ''}`}
                onClick={() => {
                    onChange(option.value);
                    setIsOpen(false);
                    triggerRef.current?.focus();
                }}
                onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onChange(option.value);
                        setIsOpen(false);
                        triggerRef.current?.focus();
                    }
                }}
            >{option.label}</button>)}
        </div>}
    </div>;
}
