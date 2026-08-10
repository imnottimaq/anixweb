import { useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useUser } from '../shared/contexts/userContext';
import styles from './LoginScreen.module.css';
import { useTranslation } from '../shared/useTranslation';
import { resolveAndStoreProfileIdentity } from '../shared/profileIdentity';
import { saveRoomIdentity } from '../shared/roomParticipant';

export default function LoginScreen() {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');
    const { userToken, setUserToken, setUserId } = useUser();
    const { t } = useTranslation();

    if (userToken !== '') return <Navigate to="/account" replace />;

    return <div className={styles.body}>
        <section className={styles['auth-card']}>
            <h2>{t('auth.loginTitle')}</h2>
            <form className={styles['form-container']} onSubmit={async event => {
                event.preventDefault();
                setIsLoading(true);
                setError('');
                try { await handleLogin(username, password, setUserToken, setUserId); }
                catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'Не удалось войти'); }
                finally { setIsLoading(false); }
            }}>
                <label className={styles.field}><span>{t('auth.username')}</span><input type="text" name="username" autoComplete="username" required value={username} onChange={e => setUsername(e.target.value)} /></label>
                <label className={styles.field}><span>{t('auth.password')}</span><input type="password" name="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} /></label>
                {error && <p className={styles.error} role="alert">{error}</p>}
                <div className={styles.actions}><Link to="/account/recover">{t('auth.forgotPassword')}</Link><Link to="/account/create">{t('auth.register')}</Link></div>
                <button type="submit" disabled={isLoading}>{isLoading ? 'Входим…' : t('auth.login')}</button>
            </form>
        </section>
    </div>;
}

async function handleLogin(username: string, password: string, setUserToken: (token: string) => void, setUserId: (id: number) => void) {
    const response = await fetch(`https://api-s.anixsekai.com/auth/signIn?login=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
    });
    if (!response.ok) throw new Error('Не удалось войти');
    const data = await response.json();
    if (data.code !== 0 || !data.profileToken?.token) throw new Error('Неверный логин или пароль');
    setUserToken(data.profileToken.token);
    if (data.profile?.id && data.profile.login) {
        saveRoomIdentity({ id: data.profile.id, login: data.profile.login, avatar: data.profile.avatar ?? null });
        setUserId(data.profile.id);
    } else {
        const profileId = await resolveAndStoreProfileIdentity(username);
        setUserId(profileId ?? 0);
    }
}
