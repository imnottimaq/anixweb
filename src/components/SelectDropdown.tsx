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
    const selectedOption = options.find(option => option.value === value) ?? options[0];

    useEffect(() => {
        const closeOnOutsideClick = (event: MouseEvent) => {
            if (!selectRef.current?.contains(event.target as Node)) setIsOpen(false);
        };

        document.addEventListener('mousedown', closeOnOutsideClick);
        return () => document.removeEventListener('mousedown', closeOnOutsideClick);
    }, []);

    if (!selectedOption) return null;

    return <div className={styles.select} ref={selectRef}>
        <button type="button" className={styles.trigger} aria-expanded={isOpen} aria-haspopup="listbox" onClick={() => setIsOpen(previous => !previous)}>
            <span>{selectedOption.label}</span>
            <span className={`${styles.chevron} ${isOpen ? styles['chevron-open'] : ''}`} aria-hidden="true" />
        </button>
        {isOpen && <div className={styles.options} role="listbox" aria-label={ariaLabel}>
            {options.map(option => <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={option.value === value}
                className={`${styles.option} ${option.value === value ? styles.selected : ''}`}
                onClick={() => {
                    onChange(option.value);
                    setIsOpen(false);
                }}
            >{option.label}</button>)}
        </div>}
    </div>;
}
