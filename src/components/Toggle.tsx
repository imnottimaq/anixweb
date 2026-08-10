import type { ChangeEventHandler } from 'react';
import styles from './Toggle.module.css';

interface ToggleProps {
    checked: boolean;
    disabled?: boolean;
    onChange: (checked: boolean) => void;
    label?: string;
    className?: string;
}

export default function Toggle({ checked, disabled = false, onChange, label = 'Переключатель', className = '' }: ToggleProps) {
    const handleChange: ChangeEventHandler<HTMLInputElement> = event => onChange(event.target.checked);
    return <label className={`${styles.toggle} ${className}`}>
        <span className={styles.visuallyHidden}>{label}</span>
        <input type="checkbox" checked={checked} disabled={disabled} onChange={handleChange} />
        <span className={styles.track} aria-hidden="true" />
    </label>;
}

export type { ToggleProps };
