import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useRoomPresence } from '../shared/contexts/roomContext';
import { useUser } from '../shared/contexts/userContext';
import { useTranslation } from '../shared/useTranslation';
import { roomErrorKey } from '../shared/roomError';
import { Modal } from './ModalTemplate';
import styles from './JoinRoomModal.module.css';

interface JoinRoomModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export default function JoinRoomModal({ isOpen, onClose }: JoinRoomModalProps) {
    const navigate = useNavigate();
    const { joinByCode } = useRoomPresence();
    const { userToken } = useUser();
    const { t } = useTranslation();

    const [code, setCode] = useState('');
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
        const cleanCode = code.trim().toUpperCase();
        if (cleanCode.length !== 8) return;

        setBusy(true);
        setError(null);
        try {
            const id = await joinByCode(cleanCode);
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
            title={t('watchRoom.joinCode')}
            size="small"
            contentClassName={styles.modal}
        >
            <p className={styles.hint}>{t('roomUX.joinHint')}</p>

            {!userToken && (
                <div className={styles.signInNotice}>
                    <p>{t('watchRoom.signInJoin')}</p>
                    <Link to="/account/login" className={styles.signInLink} onClick={handleClose}>
                        {t('nav.account')}
                    </Link>
                </div>
            )}

            <form onSubmit={handleSubmit} className={styles.form}>
                <label className={styles.field}>
                    <span>{t('watchRoom.code')}</span>
                    <input
                        className={styles.codeInput}
                        required
                        minLength={8}
                        maxLength={8}
                        value={code}
                        autoComplete="off"
                        spellCheck={false}
                        placeholder="ABCD2345"
                        disabled={busy || !userToken}
                        onChange={event => setCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8))}
                    />
                </label>

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
                        disabled={busy || !userToken || code.length !== 8}
                    >
                        {busy ? t('roomUX.joining') : t('watchRoom.joinCode')}
                    </button>
                </div>
            </form>
        </Modal>
    );
}
