import { Link, Outlet } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { Modal } from '../modals/ModalTemplate';
import SearchBar from '../components/SearchBar'
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
  const [isFirstTimeOpening, setIsFirstTimeOpeningState] = useState<boolean>(() => localStorage.getItem('onboarded') != "true")

  const closeOnboarding = () => {
      localStorage.setItem('onboarded', 'true');
      setIsFirstTimeOpeningState(false);
    };

  useEffect(() => {
      document.documentElement.dataset.theme = theme;
  }, [theme]);

  return (
      <div className={styles.layout}>
        <header className={styles.header}>
          <Link to="/" className={`${styles['nav-link']} ${styles['nav-logo-block']}`}>
              <img src="https://anixart-app.com/assets/images/logo.svg?v2" alt="Anixart" />
              <p>Anixweb</p>
            </Link>  
          <nav className={styles.navigation}>
            <Link to="/" className={styles['nav-link']}>{t('nav.home')}</Link>
            <Link to="/overview" className={styles['nav-link']}>{t('nav.overview')}</Link>
            <Link to="/favorites" className={styles['nav-link']}>{t('nav.favorites')}</Link>
            <Link to="/account" className={styles['nav-link']}>{t('nav.account')}</Link>
            <Link to="/collections" className={styles['nav-link']}>Коллекции</Link>
            <Link to="/together" className={styles['nav-link']}>Смотреть вместе</Link>
          </nav>
          <SearchBar />
          {activeRoomId && <Link
            to={`/together/${activeRoomId}`}
            className={styles['room-indicator']}
            title="Вы в комнате — вернуться"
          ><span className={styles['room-status']} /><img src={UsersIcon} alt="" /><span>В комнате</span></Link>}
          <Link
            to="/settings"
            className={`${styles['theme-toggle']} ${styles['settings-link']}`}
            aria-label={t('nav.settings')}
            title={t('nav.settings')}
          >
            <img src={SettingsIcon} alt="" />
          </Link>
          <Link
            to="/notifications"
            className={`${styles['theme-toggle']} ${styles['notifications-link']}`}
            aria-label="Уведомления"
            title="Уведомления"
          >
            <img src={NotificationsIcon} alt="" />
          </Link>
        </header>
        <main className={styles.main}>
          <Outlet/>
        </main>
        <Modal
          isOpen = {isFirstTimeOpening}
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
