import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useRoomPresence } from '../shared/contexts/roomContext';
import { useUser } from '../shared/contexts/userContext';
import { useTranslation } from '../shared/useTranslation';
import { roomErrorKey } from '../shared/roomError';
import type { RoomVisibility } from '../shared/roomProtocol';
import { Modal } from './ModalTemplate';
import styles from './CreateRoomModal.module.css';

interface CreateRoomModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export default function CreateRoomModal({ isOpen, onClose }: CreateRoomModalProps) {
    const navigate = useNavigate();
    const { create } = useRoomPresence();
    const { userToken } = useUser();
    const { t } = useTranslation();

    const [title, setTitle] = useState(() => t('watchRoom.defaultTitle'));
    const [visibility, setVisibility] = useState<RoomVisibility>('private');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleClose = () => {
        if (busy) return;
        setError(null);
        onClose();
    };

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault();
        if (busy || !userToken) return;
        const trimmedTitle = title.trim();
        if (!trimmedTitle) return;

        setBusy(true);
        setError(null);
        try {
            const id = await create({ title: trimmedTitle, visibility });
            handleClose();
            navigate(`/together/${id}`);
        } catch (cause) {
            setError(t(roomErrorKey(cause instanceof Error ? cause.message : '')));
        } finally {
            setBusy(false);
        }
    };

    return (
        <Modal
            isOpen={isOpen}
            onClose={handleClose}
            title={t('watchRoom.new')}
            size="small"
            contentClassName={styles.modal}
        >
            <p className={styles.hint}>{t('roomUX.createHint')}</p>

            {!userToken && (
                <div className={styles.signInNotice}>
                    <p>{t('watchRoom.signInCreate')}</p>
                    <Link to="/account/login" className={styles.signInLink} onClick={handleClose}>
                        {t('nav.account')}
                    </Link>
                </div>
            )}

            <form onSubmit={handleSubmit} className={styles.form}>
                <label className={styles.field}>
                    <span>{t('watchRoom.name')}</span>
                    <input
                        required
                        value={title}
                        maxLength={80}
                        disabled={busy || !userToken}
                        placeholder={t('watchRoom.defaultTitle')}
                        onChange={event => setTitle(event.target.value)}
                    />
                </label>

                <label className={styles.field}>
                    <span>{t('watchRoom.visibility')}</span>
                    <select
                        value={visibility}
                        disabled={busy || !userToken}
                        onChange={event => setVisibility(event.target.value as RoomVisibility)}
                    >
                        <option value="private">{t('watchRoom.private')}</option>
                        <option value="public">{t('watchRoom.public')}</option>
                    </select>
                </label>

                <p className={styles.fieldHint}>
                    {t(visibility === 'private' ? 'roomUX.privateHint' : 'roomUX.publicHint')}
                </p>

                {error && <p role="alert" className={styles.error}>{error}</p>}

                <div className={styles.actions}>
                    <button
                        type="button"
                        className={styles.cancelButton}
                        onClick={handleClose}
                        disabled={busy}
                    >
                        {t('misc.cancel')}
                    </button>
                    <button
                        type="submit"
                        className={styles.submitButton}
                        disabled={busy || !userToken || !title.trim()}
                    >
                        {busy ? t('roomUX.creating') : t('watchRoom.create')}
                    </button>
                </div>
            </form>
        </Modal>
    );
}
