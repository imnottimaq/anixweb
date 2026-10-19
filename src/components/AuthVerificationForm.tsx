import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useUser } from '../shared/contexts/userContext';
import { useTranslation } from '../shared/useTranslation';
import { resolveAndStoreProfileIdentity } from '../shared/profileIdentity';
import styles from '../pages/LoginScreen.module.css';

export default function AuthVerificationForm({ mode }: { mode: 'register' | 'recover' }) {
    const register = mode === 'register';
    const { t } = useTranslation();
    const { userToken, setUserToken, setUserId } = useUser();
    const navigate = useNavigate();
    const [username, setUsername] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirmation, setConfirmation] = useState('');
    const [hash, setHash] = useState('');
    const [code, setCode] = useState('');
    const [pending, setPending] = useState(false);
    const [error, setError] = useState('');
    const [mismatch, setMismatch] = useState(false);
    const request = useRef<AbortController | null>(null);
    const codeRef = useRef<HTMLInputElement>(null);
    const usernameRef = useRef<HTMLInputElement>(null);
    const confirmationRef = useRef<HTMLInputElement>(null);
    useEffect(() => () => request.current?.abort(), []);
    useEffect(() => { if (hash) codeRef.current?.focus(); }, [hash]);

    const run = async (verify: boolean) => {
        if (request.current) return;
        if ((register || verify) && password !== confirmation) { setMismatch(true); confirmationRef.current?.focus(); return; }
        const controller = new AbortController();
        request.current = controller;
        setPending(true);
        setError('');
        try {
            const path = register ? verify ? '/auth/verify' : '/auth/signUp' : verify ? '/auth/restore/verify' : '/auth/restore';
            const credentials: Record<string, string> = register ? { login: username.trim(), email: email.trim(), password } : { data: username.trim(), ...(verify ? { password } : {}) };
            const body = new URLSearchParams({ ...credentials, ...(verify ? { hash, code: code.trim() } : {}) });
            const response = await fetch(`https://api-s.anixsekai.com${path}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body, signal: controller.signal });
            if (!response.ok) throw new Error('Request failed');
            const data = await response.json() as { code: number; hash?: string; profileToken?: { token: string; id: number } };
            if (data.code !== 0) throw new Error('Request rejected');
            if (controller.signal.aborted) return;
            if (!verify) {
                if (!data.hash) throw new Error('Missing verification hash');
                setCode('');
                setHash(data.hash);
                codeRef.current?.focus();
            } else {
                if (!data.profileToken?.token) throw new Error('Missing session');
                const profileId = await resolveAndStoreProfileIdentity(username).catch(() => null);
                if (controller.signal.aborted) return;
                setUserId(profileId ?? data.profileToken.id);
                setUserToken(data.profileToken.token);
                navigate('/account', { replace: true, state: { authStatus: t(register ? 'auth.registrationSuccess' : 'auth.recoverySuccess') } });
            }
        } catch {
            if (!controller.signal.aborted) setError(t(!verify ? 'auth.codeRequestError' : register ? 'auth.registrationError' : 'auth.recoveryError'));
        } finally {
            if (request.current === controller) request.current = null;
            if (!controller.signal.aborted) setPending(false);
        }
    };
    const submit = (event: FormEvent) => { event.preventDefault(); void run(Boolean(hash)); };
    const edit = () => { setHash(''); setCode(''); setError(''); setMismatch(false); window.requestAnimationFrame(() => usernameRef.current?.focus()); };
    const passwordFields = <>
        <label className={styles.field}>{t('auth.password')}<input type="password" name="password" autoComplete="new-password" required value={password} onChange={event => { setPassword(event.target.value); setMismatch(false); }} /></label>
        <label className={styles.field}>{t('auth.confirmPassword')}<input ref={confirmationRef} type="password" name="confirmPassword" autoComplete="new-password" required value={confirmation} aria-invalid={mismatch || undefined} aria-describedby={mismatch ? 'password-mismatch' : undefined} onChange={event => { setConfirmation(event.target.value); setMismatch(false); }} onBlur={() => setMismatch(Boolean(confirmation) && confirmation !== password)} /></label>
        {mismatch && <p id="password-mismatch" className={styles.error} role="alert">{t('ux.passwordMismatch')}</p>}
    </>;

    if (userToken) return <Navigate to="/account" replace />;
    return <div className={styles.body}><section className={styles['auth-card']}>
        <h1>{t(register ? 'auth.registerTitle' : 'auth.restoreTitle')}</h1>
        <form className={styles['form-container']} onSubmit={submit} aria-busy={pending}>
            {error && <p className={styles.error} role="alert">{error}</p>}
            <fieldset className={styles.authFields} disabled={pending}>
                {!hash ? <>
                    <label className={styles.field}>{t('auth.username')}<input ref={usernameRef} type="text" name="username" autoComplete="username" required value={username} onChange={event => setUsername(event.target.value)} /></label>
                    {register && <><label className={styles.field}>{t('auth.email')}<input type="email" name="email" autoComplete="email" required value={email} onChange={event => setEmail(event.target.value)} /></label>{passwordFields}</>}
                    <button type="submit">{t(pending ? 'ux.sendingCode' : 'ux.sendCode')}</button>
                </> : <>
                    <p className={styles['code-hint']} role="status">{t('ux.codeSent')}</p>
                    <p>{register ? email : username}</p>
                    <label className={styles.field}>{t('auth.emailCode')}<input ref={codeRef} type="text" name="code" inputMode="numeric" autoComplete="one-time-code" required value={code} onChange={event => setCode(event.target.value)} /></label>
                    {!register && passwordFields}
                    <button type="submit">{t(pending ? 'ux.verifying' : register ? 'ux.verifyAccount' : 'ux.resetPassword')}</button>
                    <button type="button" className={styles.secondary} onClick={() => void run(false)}>{t('ux.resendCode')}</button>
                    <button type="button" className={styles.secondary} onClick={edit}>{t('ux.editDetails')}</button>
                </>}
            </fieldset>
        </form>
    </section></div>;
}
