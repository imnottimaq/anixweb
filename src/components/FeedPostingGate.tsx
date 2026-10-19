import { Modal } from '../modals/ModalTemplate';
import { useState } from 'react';
import { useTranslation } from '../shared/useTranslation';
import type { FeedPostingRestriction } from '../shared/feed';
import { FeedIcon } from './FeedIcons';
import styles from './FeedPostingGate.module.css';

export default function FeedPostingGate({ restriction, onClose }: { restriction: FeedPostingRestriction; onClose: () => void }) {
    const { t } = useTranslation();
    const { level, required } = restriction;
    const [helpOpen, setHelpOpen] = useState(false);
    return <><Modal isOpen onClose={onClose} title={t('feed.reputationTitle')} size="medium" actions={[{ label: t('feed.reputationUnderstood'), onClick: onClose }]}>
        <div className={styles.levels}><strong>{t('feed.reputationLevel', { level })}</strong><span>{t('feed.reputationLevel', { level: required })}</span></div>
        <progress className={styles.progress} value={Math.max(0, level)} max={required} aria-label={t('feed.reputationTitle')} />
        <p className={styles.description}>{t('feed.reputationRequired', { level: required })} <button type="button" className={styles.helpLink} onClick={() => setHelpOpen(true)}>{t('feed.reputationLearn')}</button></p>
        <ul className={styles.benefits}>
            {(['edit', 'users', 'image'] as const).map((icon, index) => <li key={icon}><FeedIcon name={icon} size={25} /><div><strong>{t((['feed.reputationPosts', 'feed.reputationChannels', 'feed.reputationCover'] as const)[index])}</strong><p>{t((['feed.reputationPostsDescription', 'feed.reputationChannelsDescription', 'feed.reputationCoverDescription'] as const)[index])}</p></div></li>)}
        </ul>
    </Modal><Modal isOpen={helpOpen} onClose={() => setHelpOpen(false)} title={t('feed.reputationHelpTitle')} size="medium" actions={[{ label: t('feed.reputationUnderstood'), onClick: () => setHelpOpen(false) }]}>
        <div className={styles.helpContent}>
            <p>{t('feed.reputationHelpIntro')}</p>
            <ul><li>{t('feed.reputationHelpComments')}</li><li>{t('feed.reputationHelpCollections')}</li><li>{t('feed.reputationHelpFriends')}</li></ul>
            <p>{t('feed.reputationHelpWarning')}</p>
            <p>{t('feed.reputationHelpUnlock', { level: required })}</p>
            <p>{t('feed.reputationHelpLimits')}</p>
            <p>{t('feed.reputationHelpWhere')}</p>
        </div>
    </Modal></>;
}
