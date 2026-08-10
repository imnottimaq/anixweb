import { Link, NavLink, Outlet } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import { Modal } from '../modals/ModalTemplate';
import SearchBar from '../components/SearchBar';
import { useSettings } from '../shared/contexts/settingsContext';
import { useTranslation } from '../shared/useTranslation';
import SettingsIcon from '../assets/icons/gear.svg';
import UsersIcon from '../assets/icons/users.svg';
import NotificationsIcon from '../assets/icons/notifications.svg';
import { useRoomPresence } from '../shared/contexts/roomContext';
import styles from './RootLayout.module.css';

export default function RootLayout() {
  const { settings } = useSettings();
  const { t } = useTranslation();
  const { activeRoomId } = useRoomPresence();
  const { theme } = settings.appearance;
  const [isFirstTimeOpening, setIsFirstTimeOpeningState] = useState<boolean>(() => localStorage.getItem('onboarded') !== 'true');
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  const closeOnboarding = () => {
    localStorage.setItem('onboarded', 'true');
    setIsFirstTimeOpeningState(false);
  };

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    if (!isMenuOpen) return;

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
          <img src="https://anixart-app.com/assets/images/logo.svg?v2" alt="" />
          <p>Anixweb</p>
        </Link>
        <button
          ref={menuButtonRef}
          type="button"
          className={styles['menu-toggle']}
          aria-label="Меню"
          aria-expanded={isMenuOpen}
          aria-controls="primary-navigation"
          onClick={() => setIsMenuOpen(open => !open)}
        >
          <span aria-hidden="true" />
          <span aria-hidden="true" />
          <span aria-hidden="true" />
        </button>
        <nav id="primary-navigation" className={`${styles.navigation} ${isMenuOpen ? styles.open : ''}`} aria-label="Основная навигация" onClick={() => setIsMenuOpen(false)}>
          <NavLink to="/" end className={navClassName}>{t('nav.home')}</NavLink>
          <NavLink to="/overview" className={navClassName}>{t('nav.overview')}</NavLink>
          <NavLink to="/favorites" className={navClassName}>{t('nav.favorites')}</NavLink>
          <NavLink to="/account" className={navClassName}>{t('nav.account')}</NavLink>
          <NavLink to="/collections" className={navClassName}>Коллекции</NavLink>
          <NavLink to="/together" className={navClassName}>Смотреть вместе</NavLink>
        </nav>
        <SearchBar />
        {activeRoomId && <Link
          to={`/together/${activeRoomId}`}
          className={styles['room-indicator']}
          title="Вы в комнате — вернуться"
          aria-label="Вы в комнате — вернуться"
        ><span className={styles['room-status']} /><img src={UsersIcon} alt="" /><span className={styles['room-label']}>В комнате</span></Link>}
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
          aria-label="Уведомления"
          title="Уведомления"
        >
          <img src={NotificationsIcon} alt="" />
        </NavLink>
      </header>
      <main className={styles.main}>
        <Outlet />
      </main>
      <Modal
        isOpen={isFirstTimeOpening}
        onClose={() => closeOnboarding}
        showCloseButton={false}
        title={t('modal.warning')}
        text={t('modal.unofficialClientNotice')}
        actions={[
          {
            label: t('modal.closeSite'),
            variant: 'secondary',
            onClick: () => window.location.href = 'https://google.com'
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
