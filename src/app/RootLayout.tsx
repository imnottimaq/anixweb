import { Link, NavLink, Outlet } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import { Modal } from '../modals/ModalTemplate';
import ReleaseActionsProvider from '../components/ReleaseContextMenu';
import SearchBar from '../components/SearchBar';
import { useSettings } from '../shared/contexts/settingsContext';
import { useUser } from '../shared/contexts/userContext';
import { useTranslation } from '../shared/useTranslation';
import SettingsIcon from '../assets/icons/gear.svg';
import UsersIcon from '../assets/icons/users.svg';
import NotificationsIcon from '../assets/icons/notifications.svg';
import LogoIcon from '../assets/icons/logo.svg';
import { useRoomPresence } from '../shared/contexts/roomContext';
import { applyTheme } from '../shared/theme';
import styles from './RootLayout.module.css';

export default function RootLayout() {
  return <ReleaseActionsProvider><RootLayoutContent /></ReleaseActionsProvider>;
}

function RootLayoutContent() {
  const { settings, setSettings } = useSettings();
  const { userToken } = useUser();
  const { t } = useTranslation();
  const { activeRoomId } = useRoomPresence();
  const [isFirstTimeOpening, setIsFirstTimeOpeningState] = useState<boolean>(() => localStorage.getItem('onboarded') !== 'true');
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const navigationRef = useRef<HTMLElement>(null);

  const closeOnboarding = () => {
    localStorage.setItem('onboarded', 'true');
    setIsFirstTimeOpeningState(false);
  };

  const changeLanguageToEnglish = () => {
    setSettings(previous => ({
      ...previous,
      appearance: { ...previous.appearance, language: 'english' }
    }));
  };

  useEffect(() => {
    return applyTheme(settings.appearance);
  }, [settings.appearance]);

  useEffect(() => {
    if (!isMenuOpen) return;
    navigationRef.current?.querySelector<HTMLAnchorElement>('a')?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsMenuOpen(false);
        menuButtonRef.current?.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isMenuOpen]);

  const navClassName = ({ isActive }: { isActive: boolean }) =>
    `${styles['nav-link']} ${isActive ? styles.active : ''}`;

  return (
    <div className={styles.layout}>
      <header className={styles.header}>
        <Link to="/" className={`${styles['nav-link']} ${styles['nav-logo-block']}`} aria-label="Anixweb">
          <img src={LogoIcon} alt="" />
          <p>Anixweb</p>
        </Link>
        <button
          ref={menuButtonRef}
          type="button"
          className={styles['menu-toggle']}
          aria-label={t('nav.menu')}
          aria-expanded={isMenuOpen}
          aria-controls="primary-navigation"
          onClick={() => {
            setIsMenuOpen(open => !open);
          }}
        >
          <span aria-hidden="true" />
          <span aria-hidden="true" />
          <span aria-hidden="true" />
        </button>
        <nav ref={navigationRef} id="primary-navigation" className={`${styles.navigation} ${isMenuOpen ? styles.open : ''}`} aria-label={t('nav.primary')} onClick={() => setIsMenuOpen(false)}>
          <NavLink to="/" end className={navClassName}>{t('nav.home')}</NavLink>
          <NavLink to="/overview" className={navClassName}>{t('nav.overview')}</NavLink>
          <NavLink to="/feed" className={navClassName}>{t('nav.feed')}</NavLink>
          <NavLink to="/favorites" className={navClassName}>{t('nav.favorites')}</NavLink>
          <NavLink to={userToken ? '/account' : '/account/login'} className={navClassName}>{t('nav.account')}</NavLink>
          <NavLink to="/collections" className={navClassName}>{t('nav.collections')}</NavLink>
          <NavLink to="/together" className={navClassName}>{t('nav.watchTogether')}</NavLink>
        </nav>
        {isMenuOpen && <div className={styles.backdrop} onClick={() => { setIsMenuOpen(false); menuButtonRef.current?.focus(); }} aria-hidden="true" />}
        <SearchBar />
        {activeRoomId && <Link
          to={`/together/${activeRoomId}`}
          className={styles['room-indicator']}
          title={t('room.return')}
          aria-label={t('room.return')}
        ><span className={styles['room-status']} /><img src={UsersIcon} alt="" /><span className={styles['room-label']}>{t('room.inRoom')}</span></Link>}
        <NavLink
          to="/settings"
          className={({ isActive }) => `${styles['theme-toggle']} ${styles['settings-link']} ${isActive ? styles.active : ''}`}
          aria-label={t('nav.settings')}
          title={t('nav.settings')}
        >
          <img src={SettingsIcon} alt="" />
        </NavLink>
        <NavLink
          to="/notifications"
          className={({ isActive }) => `${styles['theme-toggle']} ${styles['notifications-link']} ${isActive ? styles.active : ''}`}
          aria-label={t('nav.notifications')}
          title={t('nav.notifications')}
        >
          <img src={NotificationsIcon} alt="" />
        </NavLink>
      </header>
      <main className={styles.main}>
        <Outlet />
      </main>
      <Modal
        isOpen={isFirstTimeOpening}
        onClose={closeOnboarding}
        showCloseButton={false}
        title={t('modal.warning')}
        text={t('modal.unofficialClientNotice')}
        actions={[
          {
            label: t('modal.changeLanguage'),
            variant: 'secondary',
            onClick: changeLanguageToEnglish
          },
          {
            label: t('misc.continue'),
            variant: 'primary',
            onClick: closeOnboarding
          }
        ]}
      />
    </div>
  );
}
