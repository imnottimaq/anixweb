import styles from '../pages/SettingsScreen.module.css';
import Toggle from './Toggle';

interface ToggleSettingsItemProps {
    title: string;
    desc?: string;
    checked: boolean;
    disabled?: boolean;
    tooltip?: string;
    onChange: (value: boolean) => void;
}

export default function ToggleSettingsItem({
    title,
    desc,
    checked,
    disabled = false,
    tooltip,
    onChange,
}: ToggleSettingsItemProps) {
    return (
        <div className={styles['settings-item']} title={tooltip}>
            <div className={styles['setting-copy']}>
                <h2>{title}</h2>
                {desc && <p>{desc}</p>}
            </div>
            <div
                className={styles['toggle-wrapper']}
                title={tooltip}
                aria-label={tooltip}
                data-disabled={disabled}
            >
                <Toggle
                    className={styles.switch}
                    label={title}
                    disabled={disabled}
                    checked={checked}
                    onChange={onChange}
                />
                {tooltip && (
                    <span className={styles['toggle-tooltip']} role="tooltip">
                        {tooltip}
                    </span>
                )}
            </div>
        </div>
    );
}
