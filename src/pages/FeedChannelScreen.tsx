import { FeedLink as Link } from '../shared/feedNavigation';
import { useParams } from 'react-router-dom';
import { PageHeader, PageLayout } from '../components/PageLayout';
import PageState from '../components/PageState';
import RemoteImage from '../components/RemoteImage';
import { useApi } from '../shared/apiClient';
import { useUser } from '../shared/contexts/userContext';
import { feedId, feedUrl, loadFeedChannel } from '../shared/feed';
import { useAsyncLoad } from '../shared/useAsyncLoad';
import { useTranslation } from '../shared/useTranslation';
import { FeedList } from './FeedScreen';
import styles from '../components/FeedContent.module.css';
import { FeedChannelActions } from '../components/FeedActions';
import shell from './FeedShell.module.css';
import { FeedBack } from '../shared/feedNavigation';

function ChannelPage({ id }: { id: number }) {
    const api = useApi();
    const { t } = useTranslation();
    const { data, error, isLoading, reload } = useAsyncLoad(signal => loadFeedChannel(api, id, signal), [api, id]);
    return <>
        {isLoading && <PageState status="loading" />}
        {error && <PageState status="error" message={t('feed.invalid')} onRetry={reload} />}
        {data && !error && <header className={styles.channelHeader}>
            {feedUrl(data.cover) && <RemoteImage src={feedUrl(data.cover)} alt="" className={styles.cover} />}
            <div className={`${styles.channelHeading} ${shell.channelIdentity}`}><RemoteImage src={feedUrl(data.avatar)} alt="" className={styles.avatar} /><div><h1>{data.title}</h1><p className={styles.meta}>{t('feed.subscribers', { count: data.subscriber_count ?? 0 })}</p></div></div>
            {data.description && <p className={`${styles.description} ${shell.channelDescription}`}>{data.description}</p>}
            <FeedChannelActions key={data.id} channel={data} onChanged={reload} />
        </header>}
        {!error && <FeedList source={{ kind: 'channel', id }} />}
    </>;
}

export default function FeedChannelScreen() {
    const { channelId } = useParams();
    const id = feedId(channelId);
    const { userToken } = useUser();
    const { t } = useTranslation();
    return <PageLayout className={styles.page}><FeedBack />
        {id === null ? <><PageHeader title={t('feed.channel')} /><PageState status="error" message={t('feed.invalid')} /></> : !userToken ? <><PageState status="empty" message={t('feed.signIn')} /><Link to="/account/login">{t('feed.login')}</Link></> : <ChannelPage key={`${userToken}:${id}`} id={id} />}
    </PageLayout>;
}
