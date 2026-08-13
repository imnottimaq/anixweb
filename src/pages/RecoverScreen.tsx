import { useState } from "react"
import { useUser } from "../shared/contexts/userContext";
import styles from './LoginScreen.module.css'
import { Navigate } from "react-router-dom";
import { useTranslation } from '../shared/useTranslation';
import { resolveAndStoreProfileIdentity } from '../shared/profileIdentity';

export default function RecoverScreen() {
    const [username, setUsername] = useState("")
    const [password, setPassword] = useState("")
    const [confirmPassword, setConfirmPassword] = useState("")

    const {userToken, setUserToken, setUserId } = useUser()
    const [hash, setHash] = useState("")
    const [code, setCode] = useState("")
    const [errorMsg, setErrorMsg] = useState("")
    const { t } = useTranslation();

    const isCodeRequestDisabled = !username || !password || password !== confirmPassword;

    if (userToken !== "") return <Navigate to="/account" replace />


    return (
        <div className={styles['body']}>
            <section className={styles['auth-card']}>
            <h2>{t('auth.restoreTitle')}</h2>
            <div className={styles['form-container']}>
                
                {errorMsg && <p className={styles.error} role="alert">{errorMsg}</p>}
                <div className={styles['form-fields']}>
                        <input 
                            type="text"
                            name="username"
                            autoComplete="username"
                            placeholder={t('auth.login')}
                            value={username}
                            onChange={e => setUsername(e.target.value)}
                        />
                       
                        <input 
                            type="password"
                            name="password"
                            autoComplete="new-password"
                            placeholder={t('auth.password')}
                            value={password}
                            onChange={e => setPassword(e.target.value)}
                        />

                        <input 
                            type="password"
                            name="confirmPassword"
                            autoComplete="new-password"
                            placeholder={t('auth.confirmPassword')}
                            value={confirmPassword}
                            onChange={e => setConfirmPassword(e.target.value)}
                        />

                        <div className={styles['code-row']}>
                            <input
                                type="text"
                                inputMode="numeric"
                                autoComplete="one-time-code"
                                placeholder={t('auth.emailCode')}
                                onChange={e => setCode(e.target.value)}
                                value={code}
                            />
                            <button
                                type="button"
                                className={styles['send-code-button']}
                            onClick={() => handleRecoverFirstStage(
                                username, 
                                setHash, 
                                setErrorMsg,
                                t('auth.codeRequestError')
                            )} 
                            disabled={isCodeRequestDisabled}
                        >
                            {hash ? t('misc.reset') : t('auth.sendCode')}
                        </button>
                        </div>
                        {hash && <p className={styles['code-hint']}>{t('auth.checkEmail')}</p>}
                        <button
                            className={styles['submit-button']}
                            onClick={() => handleRecoverSecondStage(
                                username,
                                password,
                                hash,
                                code,
                                setUserToken,
                                setUserId,
                                setErrorMsg,
                                t('auth.recoveryError'),
                                t('auth.recoverySuccess')
                            )}
                            disabled={!hash || !code}
                        >
                            {t('auth.restoreTitle')}
                        </button>
                </div>
            </div>
            </section>
        </div>
    )
}

async function handleRecoverFirstStage(
    username: string, 
    setHash: (hash: string) => void,
    setErrorMsg: (msg: string) => void,
    errorMessage: string
) {
    setErrorMsg("");
    try {
        const response = await fetch(`https://api-s.anixsekai.com/auth/restore`, { 
            method: 'POST',
            headers: {'Content-Type': 'application/x-www-form-urlencoded'},
            body: new URLSearchParams({ data: username })
        });
        
        const rawText = await response.text();

        if (!rawText) {
            setErrorMsg(errorMessage);
            return;
        }

        const data = JSON.parse(rawText);
        if (data.code !== 0) throw new Error(data.message || "Ошибка восстановления");

        setHash(data.hash);
    } catch (err: unknown) {
        console.error(err);
        setErrorMsg(errorMessage);
    }
}

async function handleRecoverSecondStage(
    username: string, 
    password: string, 
    hash: string, 
    code: string, 
    setUserToken: (token: string) => void,
    setUserId: (id: number) => void,
    setErrorMsg: (msg: string) => void,
    errorMessage: string,
    successMessage: string
) {
    setErrorMsg("");
    try {
        const response = await fetch(`https://api-s.anixsekai.com/auth/restore/verify`, {   
                method: 'POST',
                headers: {'Content-Type': 'application/x-www-form-urlencoded'},
                body: new URLSearchParams({ data: username, password: password, hash: hash, code:code })
            });
        if (!response.ok) throw new Error("Ошибка при подтверждении: " + response.status);

        const data = await response.json();
        if (data.code !== 0) throw new Error(data.message || "Неверный код или не удалось восстановить пароль");
        if (data.profileToken && data.profileToken.token) {
            setUserToken(data.profileToken.token);
            const profileId = await resolveAndStoreProfileIdentity(username);
            setUserId(profileId ?? data.profileToken.id);
            alert(successMessage);
        }
    } catch (err: unknown) {
        console.error(err);
        setErrorMsg(errorMessage);
    }
}
