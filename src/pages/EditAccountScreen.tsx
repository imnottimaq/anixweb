import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApi } from '../shared/apiClient';
import { useUser } from '../shared/contexts/userContext';
import type { Profile } from '../shared/types/api';
import RemoteImage from '../components/RemoteImage';
import { PageHeader, PageLayout } from '../components/PageLayout';
import PageState from '../components/PageState';
import { Modal } from '../modals/ModalTemplate';
import styles from './EditAccountScreen.module.css';
import { useTranslation } from '../shared/useTranslation';

type ProfileResponse = {
    code: number;
    profile: Profile;
};

type ProfileDraft = Pick<Profile, 'status' | 'vk_page' | 'tg_page' | 'discord_page' | 'inst_page' | 'tt_page'>;

type ProfilePreferences = {
    code: number;
    privacy_stats: number;
    privacy_counts: number;
    privacy_social: number;
    privacy_friend_requests: number;
    email_hint?: string | null;
};

type SocialResponse = ProfileDraft & { code: number };

type LoginInfoResponse = {
    code: number;
    login: string;
    is_change_available?: boolean;
    is_change_avaliable?: boolean;
    next_change_available_at?: number;
};

type AvatarEditResponse = {
    code: number;
    avatar: string;
};

type PrivacyKey = 'privacy_stats' | 'privacy_counts' | 'privacy_social' | 'privacy_friend_requests';

type CodeResponse = {
    code: number;
    hash?: string;
    message?: string;
    profileToken?: { token?: string };
};

const emptyDraft: ProfileDraft = {
    status: '',
    vk_page: '',
    tg_page: '',
    discord_page: '',
    inst_page: '',
    tt_page: '',
};

async function convertAvatarToJpeg(file: File): Promise<File> {
    const sourceUrl = URL.createObjectURL(file);

    try {
        const image = await new Promise<HTMLImageElement>((resolve, reject) => {
            const element = new Image();
            element.onload = () => resolve(element);
            element.onerror = () => reject(new Error('Не удалось прочитать изображение.'));
            element.src = sourceUrl;
        });
        const side = Math.min(1024, Math.max(image.naturalWidth, image.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = side;
        canvas.height = side;

        const context = canvas.getContext('2d');
        if (!context) throw new Error('Не удалось подготовить изображение.');

        const scale = Math.max(side / image.naturalWidth, side / image.naturalHeight);
        const width = image.naturalWidth * scale;
        const height = image.naturalHeight * scale;
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, side, side);
        context.drawImage(image, (side - width) / 2, (side - height) / 2, width, height);

        const blob = await new Promise<Blob>((resolve, reject) => {
            canvas.toBlob(result => result ? resolve(result) : reject(new Error('Не удалось подготовить JPEG.')), 'image/jpeg', 0.9);
        });

        return new File([blob], `cropped${Date.now()}.jpg`, { type: 'image/jpeg' });
    } finally {
        URL.revokeObjectURL(sourceUrl);
    }
}

async function postAnonymousForm(path: string, values: Record<string, string>): Promise<CodeResponse> {
    const targetUrl = new URL(path, 'https://api-s.anixsekai.com').toString();
    const send = async (url: string) => {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams(values),
        });
        const data = await response.json() as CodeResponse;
        if (!response.ok || data.code !== 0) throw new Error('Request failed');
        return data;
    };

    try {
        return await send(targetUrl);
    } catch {
        return send(`https://kodik-proxy.imnottimaq.workers.dev/agentproxy?url=${encodeURIComponent(targetUrl)}`);
    }
}

export default function EditAccountScreen() {
    const navigate = useNavigate();
    const api = useApi();
    const { t } = useTranslation();
    const { userId, userToken, setUserToken } = useUser();
    const [profile, setProfile] = useState<Profile | null>(null);
    const [draft, setDraft] = useState<ProfileDraft>(emptyDraft);
    const [isLoading, setIsLoading] = useState(true);
    const [privacy, setPrivacy] = useState<Record<PrivacyKey, number>>({
        privacy_stats: 0,
        privacy_counts: 0,
        privacy_social: 0,
        privacy_friend_requests: 0,
    });
    const [isSaving, setIsSaving] = useState(false);
    const [login, setLogin] = useState('');
    const [isLoginChangeAvailable, setIsLoginChangeAvailable] = useState(false);
    const [isLoginSaving, setIsLoginSaving] = useState(false);
    const [isPrivacySaving, setIsPrivacySaving] = useState<PrivacyKey | null>(null);
    const [saveMessage, setSaveMessage] = useState<string | null>(null);
    const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
    const [isAvatarUploading, setIsAvatarUploading] = useState(false);
    const avatarInputRef = useRef<HTMLInputElement>(null);
    const [emailHint, setEmailHint] = useState<string | null>(null);
    const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
    const [newPassword, setNewPassword] = useState('');
    const [confirmNewPassword, setConfirmNewPassword] = useState('');
    const [passwordCode, setPasswordCode] = useState('');
    const [passwordHash, setPasswordHash] = useState('');
    const [passwordError, setPasswordError] = useState<string | null>(null);
    const [isPasswordRequesting, setIsPasswordRequesting] = useState(false);
    const [isPasswordSaving, setIsPasswordSaving] = useState(false);
    const [isEmailModalOpen, setIsEmailModalOpen] = useState(false);
    const [currentEmail, setCurrentEmail] = useState('');
    const [newEmail, setNewEmail] = useState('');
    const [emailPassword, setEmailPassword] = useState('');
    const [emailError, setEmailError] = useState<string | null>(null);
    const [isEmailSaving, setIsEmailSaving] = useState(false);

    const getRequest = useCallback(<T,>(path: string) => api.get<T>(path), [api]);

    useEffect(() => {
        if (!userToken) navigate('/account/login', { replace: true });
    }, [navigate, userToken]);

    useEffect(() => {
        if (!userToken || userId <= 0) return;

        let isCancelled = false;

        const loadProfile = async () => {
            try {
                const [response, social, preferences, loginInfo] = await Promise.all([
                    getRequest<ProfileResponse>(`/profile/${userId}`),
                    getRequest<SocialResponse>('/profile/preference/social'),
                    getRequest<ProfilePreferences>('/profile/preference/my'),
                    getRequest<LoginInfoResponse>('/profile/preference/login/info'),
                ]);
                if (isCancelled) return;

                setProfile(response.profile);
                setLogin(loginInfo.login ?? response.profile.login);
                setIsLoginChangeAvailable(loginInfo.is_change_available ?? loginInfo.is_change_avaliable ?? false);
                setDraft({
                    status: response.profile.status ?? '',
                    vk_page: social.vk_page ?? '',
                    tg_page: social.tg_page ?? '',
                    discord_page: social.discord_page ?? '',
                    inst_page: social.inst_page ?? '',
                    tt_page: social.tt_page ?? '',
                });
                setPrivacy({
                    privacy_stats: preferences.privacy_stats ?? 0,
                    privacy_counts: preferences.privacy_counts ?? 0,
                    privacy_social: preferences.privacy_social ?? 0,
                    privacy_friend_requests: preferences.privacy_friend_requests ?? 0,
                });
                setEmailHint(preferences.email_hint ?? null);
            } catch (error) {
                console.error('Не удалось загрузить профиль для редактирования:', error);
            } finally {
                if (!isCancelled) setIsLoading(false);
            }
        };

        void loadProfile();
        return () => { isCancelled = true; };
    }, [userId, userToken, getRequest]);

    const updateDraft = <Key extends keyof ProfileDraft>(key: Key, value: ProfileDraft[Key]) => {
        setSaveMessage(null);
        setDraft(current => ({ ...current, [key]: value }));
    };

    const postRequest = <T,>(path: string, body: unknown) => api.post<T>(path, body);

    const saveProfile = async () => {
        if (isSaving) return;
        setIsSaving(true);
        setSaveMessage(null);

        try {
            await Promise.all([
                postRequest('/profile/preference/status/edit', { status: draft.status }),
                postRequest('/profile/preference/social/edit', {
                    vkPage: draft.vk_page,
                    tgPage: draft.tg_page,
                    instPage: draft.inst_page,
                    ttPage: draft.tt_page,
                    discordPage: draft.discord_page,
                }),
            ]);
            setProfile(current => current ? { ...current, ...draft } : current);
            setSaveMessage(t('editAccount.saved'));
        } catch {
            setSaveMessage(t('editAccount.saveError'));
        } finally {
            setIsSaving(false);
        }
    };

    const changeLogin = async () => {
        const newLogin = login.trim();
        if (!newLogin || isLoginSaving || !isLoginChangeAvailable) return;

        setIsLoginSaving(true);
        setSaveMessage(null);
        try {
            await getRequest<{ code: number }>(`/profile/preference/login/change?login=${encodeURIComponent(newLogin)}`);
            setProfile(current => current ? { ...current, login: newLogin } : current);
            setIsLoginChangeAvailable(false);
            setSaveMessage(t('editAccount.loginSaved'));
        } catch {
            setSaveMessage(t('editAccount.loginError'));
        } finally {
            setIsLoginSaving(false);
        }
    };

    const changePrivacy = async (key: PrivacyKey, permission: number) => {
        if (isPrivacySaving) return;
        const endpoints: Record<PrivacyKey, string> = {
            privacy_stats: '/profile/preference/privacy/stats/edit',
            privacy_counts: '/profile/preference/privacy/counts/edit',
            privacy_social: '/profile/preference/privacy/social/edit',
            privacy_friend_requests: '/profile/preference/privacy/friendRequests/edit',
        };

        setIsPrivacySaving(key);
        try {
            await postRequest(endpoints[key], { permission });
            setPrivacy(current => ({ ...current, [key]: permission }));
        } catch {
            setSaveMessage(t('editAccount.privacyError'));
        } finally {
            setIsPrivacySaving(null);
        }
    };

    const requestPasswordCode = async () => {
        const profileLogin = profile?.login;
        if (!profileLogin || newPassword.length < 1 || newPassword !== confirmNewPassword || isPasswordRequesting) return;

        setIsPasswordRequesting(true);
        setPasswordError(null);
        try {
            const response = await postAnonymousForm('/auth/restore', { data: profileLogin });
            if (!response.hash) throw new Error('Сервер не вернул код восстановления.');
            setPasswordHash(response.hash);
        } catch {
            setPasswordError(t('editAccount.passwordCodeError'));
        } finally {
            setIsPasswordRequesting(false);
        }
    };

    const restorePassword = async (close: () => void) => {
        const profileLogin = profile?.login;
        if (!profileLogin || !passwordHash || !passwordCode || isPasswordSaving) return;

        setIsPasswordSaving(true);
        setPasswordError(null);
        try {
            const response = await postAnonymousForm('/auth/restore/verify', {
                data: profileLogin,
                password: newPassword,
                hash: passwordHash,
                code: passwordCode,
            });
            if (response.profileToken?.token) setUserToken(response.profileToken.token);
            setNewPassword('');
            setConfirmNewPassword('');
            setPasswordCode('');
            setPasswordHash('');
            setSaveMessage(t('editAccount.passwordSaved'));
            close();
        } catch {
            setPasswordError(t('editAccount.passwordError'));
        } finally {
            setIsPasswordSaving(false);
        }
    };

    const changeEmail = async (close: () => void) => {
        if (!currentEmail.trim() || !newEmail.trim() || !emailPassword || isEmailSaving) return;

        setIsEmailSaving(true);
        setEmailError(null);
        try {
            await postRequest('/profile/preference/email/edit', {
                password: emailPassword,
                email: currentEmail.trim(),
                newEmail: newEmail.trim(),
            });
            setCurrentEmail('');
            setNewEmail('');
            setEmailPassword('');
            setSaveMessage(t('editAccount.emailSaved'));
            close();
        } catch {
            setEmailError(t('editAccount.emailError'));
        } finally {
            setIsEmailSaving(false);
        }
    };

    const handleAvatarSelect = async (file: File | undefined) => {
        if (!file) return;
        if (!file.type.startsWith('image/')) {
            setSaveMessage(t('editAccount.avatarTypeError'));
            return;
        }

        if (file.size > 8 * 1024 * 1024) {
            setSaveMessage(t('editAccount.avatarSizeError'));
            return;
        }

        try {
            const jpegFile = await convertAvatarToJpeg(file);
            if (avatarPreview) URL.revokeObjectURL(avatarPreview);
            setAvatarPreview(URL.createObjectURL(jpegFile));
            setIsAvatarUploading(true);
            setSaveMessage(t('editAccount.avatarUploading'));

            const response = await uploadAvatar(jpegFile);
            setProfile(current => current ? { ...current, avatar: response.avatar } : current);
            setSaveMessage(t('editAccount.avatarSaved'));
        } catch {
            setSaveMessage(t('editAccount.avatarError'));
        } finally {
            setIsAvatarUploading(false);
        }
    };

    const uploadAvatar = async (file: File): Promise<AvatarEditResponse> => {
        const targetUrl = new URL('https://api-s.anixsekai.com/profile/preference/avatar/edit');
        targetUrl.searchParams.set('token', userToken);

        const send = async (url: string) => {
            const formData = new FormData();
            formData.append('image', file, file.name);
            formData.append('name', 'image');

            const response = await fetch(url, { method: 'POST', body: formData });
            if (!response.ok) throw new Error(`Avatar upload failed: ${response.status}`);
            const data = await response.json() as AvatarEditResponse;
            if (data.code !== 0 || !data.avatar) throw new Error(`Avatar upload failed: ${data.code}`);
            return data;
        };

        const proxyUrl = `https://kodik-proxy.imnottimaq.workers.dev/agentproxy?url=${encodeURIComponent(targetUrl.toString())}`;

        return send(proxyUrl);
    };

    useEffect(() => () => {
        if (avatarPreview) URL.revokeObjectURL(avatarPreview);
    }, [avatarPreview]);

    if (isLoading) return <PageLayout><PageState status="loading" message={t('account.loading')} /></PageLayout>;

    return (
        <PageLayout>
            <PageHeader title={t('editAccount.title')} description={t('editAccount.description')} back />

            <section className={styles.section}>
                <h2>{t('editAccount.general')}</h2>
                <div className={styles.avatarSetting}>
                    <span>{t('editAccount.avatar')} <small>{t('editAccount.avatarHint')}</small></span>
                    <div className={styles.avatarControl}>
                        {avatarPreview
                            ? <img src={avatarPreview} alt={t('editAccount.avatarPreviewAlt')} />
                            : <RemoteImage src={profile?.avatar} alt={t('editAccount.avatarCurrentAlt')} />}
                        <input ref={avatarInputRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={event => {
                            const file = event.target.files?.[0];
                            event.target.value = '';
                            void handleAvatarSelect(file);
                        }} />
                        <button type="button" disabled={isAvatarUploading} onClick={() => avatarInputRef.current?.click()}>{isAvatarUploading ? t('editAccount.uploading') : t('editAccount.changeAvatar')}</button>
                    </div>
                </div>
                <label className={styles.field}>
                    <span>{t('editAccount.nickname')} <small>{t('editAccount.nicknameHint')}</small></span>
                    <div className={styles.loginControl}>
                        <input value={login} disabled={!isLoginChangeAvailable || isLoginSaving} placeholder={profile?.login ?? 'username'} onChange={event => { setLogin(event.target.value); setSaveMessage(null); }} />
                        <button type="button" disabled={!isLoginChangeAvailable || isLoginSaving || login.trim() === profile?.login} onClick={() => void changeLogin()}>{isLoginSaving ? t('editAccount.changing') : t('editAccount.change')}</button>
                    </div>
                    {!isLoginChangeAvailable && <small className={styles.fieldHint}>{t('editAccount.nicknameUnavailable')}</small>}
                </label>
                <label className={styles.field}>
                    <span>{t('editAccount.status')} <small>{t('editAccount.statusHint')}</small></span>
                    <textarea value={draft.status} maxLength={240} placeholder={t('editAccount.statusPlaceholder')} onChange={event => updateDraft('status', event.target.value)} />
                </label>
                <div className={styles.accountActions}>
                    <button type="button" onClick={() => { setPasswordError(null); setIsPasswordModalOpen(true); }}>{t('editAccount.restorePassword')}</button>
                    <button type="button" onClick={() => { setEmailError(null); setIsEmailModalOpen(true); }}>{t('editAccount.changeEmail')}</button>
                </div>
            </section>

            <section className={styles.section}>
                <h2>{t('editAccount.social')}</h2>
                <p className={styles.sectionDescription}>{t('editAccount.socialDescription')}</p>
                <div className={styles.fieldsGrid}>
                    <label className={styles.field}><span>ВКонтакте</span><input value={draft.vk_page} placeholder="vk.com/username" onChange={event => updateDraft('vk_page', event.target.value)} /></label>
                    <label className={styles.field}><span>Telegram</span><input value={draft.tg_page} placeholder="t.me/username" onChange={event => updateDraft('tg_page', event.target.value)} /></label>
                    <label className={styles.field}><span>Discord</span><input value={draft.discord_page} placeholder="username" onChange={event => updateDraft('discord_page', event.target.value)} /></label>
                    <label className={styles.field}><span>Instagram</span><input value={draft.inst_page} placeholder="instagram.com/username" onChange={event => updateDraft('inst_page', event.target.value)} /></label>
                    <label className={styles.field}><span>TikTok</span><input value={draft.tt_page} placeholder="tiktok.com/@username" onChange={event => updateDraft('tt_page', event.target.value)} /></label>
                </div>
            </section>

            <section className={styles.section}>
                <h2>{t('editAccount.privacy')}</h2>
                <p className={styles.sectionDescription}>{t('editAccount.privacyDescription')}</p>
                <div className={styles.privacyGrid}>
                    <label className={styles.selectField}><span>{t('editAccount.privacyStats')}</span><select value={privacy.privacy_stats} disabled={isPrivacySaving === 'privacy_stats'} onChange={event => void changePrivacy('privacy_stats', Number(event.target.value))}><option value={0}>{t('editAccount.everyone')}</option><option value={1}>{t('editAccount.friendsOnly')}</option><option value={2}>{t('editAccount.nobody')}</option></select></label>
                    <label className={styles.selectField}><span>{t('editAccount.privacyCounts')}</span><select value={privacy.privacy_counts} disabled={isPrivacySaving === 'privacy_counts'} onChange={event => void changePrivacy('privacy_counts', Number(event.target.value))}><option value={0}>{t('editAccount.everyone')}</option><option value={1}>{t('editAccount.friendsOnly')}</option><option value={2}>{t('editAccount.nobody')}</option></select></label>
                    <label className={styles.selectField}><span>{t('editAccount.social')}</span><select value={privacy.privacy_social} disabled={isPrivacySaving === 'privacy_social'} onChange={event => void changePrivacy('privacy_social', Number(event.target.value))}><option value={0}>{t('editAccount.everyone')}</option><option value={1}>{t('editAccount.friendsOnly')}</option><option value={2}>{t('editAccount.nobody')}</option></select></label>
                    <label className={styles.selectField}><span>{t('editAccount.friendRequests')}</span><select value={privacy.privacy_friend_requests} disabled={isPrivacySaving === 'privacy_friend_requests'} onChange={event => void changePrivacy('privacy_friend_requests', Number(event.target.value))}><option value={0}>{t('editAccount.fromEveryone')}</option><option value={1}>{t('editAccount.fromNobody')}</option></select></label>
                </div>
            </section>

            <footer className={styles.footer}>
                {saveMessage && <span className={saveMessage === t('editAccount.saved') ? styles.success : styles.error}>{saveMessage}</span>}
                <button type="button" className={styles.saveButton} disabled={isSaving} onClick={() => void saveProfile()}>{isSaving ? t('editAccount.saving') : t('editAccount.save')}</button>
            </footer>

            <Modal isOpen={isPasswordModalOpen} onClose={() => setIsPasswordModalOpen(false)} title={t('editAccount.passwordTitle')} size="small">
                {close => <div className={styles.modalForm}>
                    <p>{t('editAccount.passwordDescription')}</p>
                    <label><span>{t('editAccount.newPassword')}</span><input type="password" autoComplete="new-password" value={newPassword} onChange={event => { setNewPassword(event.target.value); setPasswordError(null); }} /></label>
                    <label><span>{t('editAccount.repeatPassword')}</span><input type="password" autoComplete="new-password" value={confirmNewPassword} onChange={event => { setConfirmNewPassword(event.target.value); setPasswordError(null); }} /></label>
                    <div className={styles.codeRow}>
                        <input inputMode="numeric" placeholder={t('editAccount.emailCode')} value={passwordCode} onChange={event => setPasswordCode(event.target.value)} />
                        <button type="button" disabled={!newPassword || newPassword !== confirmNewPassword || isPasswordRequesting} onClick={() => void requestPasswordCode()}>{isPasswordRequesting ? t('editAccount.sending') : passwordHash ? t('editAccount.resendCode') : t('auth.sendCode')}</button>
                    </div>
                    {passwordHash && <small>{t('editAccount.codeHint')}</small>}
                    {passwordError && <p className={styles.modalError}>{passwordError}</p>}
                    <div className={styles.modalActions}><button type="button" onClick={close}>{t('misc.cancel')}</button><button type="button" disabled={!passwordHash || !passwordCode || isPasswordSaving} onClick={() => void restorePassword(close)}>{isPasswordSaving ? t('editAccount.changing') : t('editAccount.changePassword')}</button></div>
                </div>}
            </Modal>

            <Modal isOpen={isEmailModalOpen} onClose={() => setIsEmailModalOpen(false)} title={t('editAccount.emailTitle')} size="small">
                {close => <div className={styles.modalForm}>
                    <p>{t('editAccount.emailDescription')}</p>
                    {emailHint && <small>{t('editAccount.emailHint', { hint: emailHint })}</small>}
                    <label><span>{t('editAccount.currentEmail')}</span><input type="email" autoComplete="email" value={currentEmail} onChange={event => { setCurrentEmail(event.target.value); setEmailError(null); }} /></label>
                    <label><span>{t('editAccount.newEmail')}</span><input type="email" autoComplete="email" value={newEmail} onChange={event => { setNewEmail(event.target.value); setEmailError(null); }} /></label>
                    <label><span>{t('editAccount.currentPassword')}</span><input type="password" autoComplete="current-password" value={emailPassword} onChange={event => { setEmailPassword(event.target.value); setEmailError(null); }} /></label>
                    {emailError && <p className={styles.modalError}>{emailError}</p>}
                    <div className={styles.modalActions}><button type="button" onClick={close}>{t('misc.cancel')}</button><button type="button" disabled={!currentEmail || !newEmail || !emailPassword || isEmailSaving} onClick={() => void changeEmail(close)}>{isEmailSaving ? t('editAccount.changing') : t('editAccount.changeEmail')}</button></div>
                </div>}
            </Modal>
        </PageLayout>
    );
}
