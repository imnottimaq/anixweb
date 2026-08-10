import styles from '../pages/SettingsScreen.module.css'
import Toggle from './Toggle'

interface ToggleSettingsItem {
    title: string,
    desc?: string,
    checked: boolean,
    disabled?: boolean,
    onChange: (value: boolean) => void
}

export default function ToggleSettingsItem({title, desc, checked, disabled = false, onChange}: ToggleSettingsItem){
    return (
        <div className={styles['settings-item']}>
            <div className={styles['setting-copy']}>
                <h2>{title}</h2>
                <p>{desc}</p>
            </div>
            <Toggle
                className={styles.switch}
                label={title}
                disabled={disabled}
                checked={checked}
                onChange={onChange}
            />
        </div>
    )
}
