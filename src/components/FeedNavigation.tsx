import { FeedLink as Link } from '../shared/feedNavigation';
import { useTranslation } from '../shared/useTranslation';
import styles from './FeedNavigation.module.css';
import { useLocation, useNavigate } from 'react-router-dom';
import { trailOf } from '../shared/feedNavigationState';

type FeedNavigationProps = {
    active: 'personal' | 'latest' | 'channels';
};

export default function FeedNavigation({ active }: FeedNavigationProps) {
    const { t } = useTranslation();
    const location = useLocation(), navigate = useNavigate();
    const trail = trailOf(location.state);
    const tabs = [
        { id: 'personal', label: t('feed.personal'), to: '/feed?tab=my' },
        { id: 'latest', label: t('feed.latest'), to: '/feed' },
        { id: 'channels', label: t('feed.channels'), to: '/feed/studio?tab=managed' },
    ] as const;

    return <nav className={styles.navigation} aria-label={t('feed.title')}>
        {tabs.map(tab => {
            const previous = active === tab.id ? undefined : [...trail].reverse().find(origin => {
                const url = new URL(origin.to, 'https://feed.invalid');
                if (url.searchParams.has('q') || url.searchParams.has('search')) return false;
                return tab.id === 'channels' ? url.pathname === '/feed/studio' && !url.searchParams.has('create') && !url.searchParams.has('edit')
                    : url.pathname === '/feed' && (tab.id === 'personal' ? url.searchParams.get('tab') === 'my' : url.searchParams.get('tab') !== 'my');
            });
            const personalPeriod = active === 'personal' && tab.id === 'personal' ? new URLSearchParams(location.search).get('date') : null;
            const target = previous?.to ?? (personalPeriod && /^[0-5]$/.test(personalPeriod) ? `/feed?tab=my&date=${personalPeriod}` : tab.to);
            return <Link key={tab.id} to={target} className={styles.tab} aria-current={active === tab.id ? 'page' : undefined} onClick={event => {
                if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                const index: unknown = window.history.state?.idx;
                if (previous?.index !== null && previous?.index !== undefined && typeof index === 'number' && previous.index < index) {
                    event.preventDefault(); navigate(previous.index - index);
                }
            }}>{tab.label}</Link>;
        })}
    </nav>;
}
