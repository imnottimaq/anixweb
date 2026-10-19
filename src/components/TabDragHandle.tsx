import styles from './TabDragHandle.module.css';

export default function TabDragHandle() {
    return <span data-tab-grip className={styles.grip} aria-hidden="true"><svg width="12" height="18" viewBox="0 0 12 18" fill="currentColor">
        {[4, 9, 14].map(y => <g key={y}><circle cx="3" cy={y} r="1.2" /><circle cx="8" cy={y} r="1.2" /></g>)}
    </svg></span>;
}
