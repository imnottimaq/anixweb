import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useTranslation } from '../shared/useTranslation';
import { useUser } from '../shared/contexts/userContext';
import MoreBottomSheet from './MoreBottomSheet';
import styles from './BottomNav.module.css';

export default function BottomNav() {
  const { t } = useTranslation();
  const { userToken } = useUser();
  const location = useLocation();
  const [openedPathname, setOpenedPathname] = useState<string | null>(null);

  const isMoreOpen = openedPathname === location.pathname;
  const pathname = location.pathname;

  const isHomeActive = pathname === '/';
  const isCatalogActive =
    pathname.startsWith('/overview') ||
    pathname.startsWith('/filter') ||
    pathname.startsWith('/popular');
  const isFavoritesActive = pathname.startsWith('/favorites');
  const isProfileActive = pathname.startsWith('/account');
  const isMoreActive =
    isMoreOpen ||
    pathname.startsWith('/feed') ||
    pathname.startsWith('/together') ||
    pathname.startsWith('/collections') ||
    pathname.startsWith('/collection') ||
    pathname.startsWith('/schedule') ||
    pathname.startsWith('/settings') ||
    pathname.startsWith('/notifications') ||
    pathname.startsWith('/downloads') ||
    pathname.startsWith('/random');

  const profilePath = userToken ? '/account' : '/account/login';

  return (
    <>
      <nav className={styles.bottomNav} aria-label={t('nav.bottom')}>
        {/* 1. Home */}
        <NavLink
          to="/"
          end
          className={`${styles.navItem} ${isHomeActive ? styles.active : ''}`}
          aria-label={t('nav.home')}
        >
          <span className={styles.iconWrapper}>
            <svg viewBox="0 0 24 24" fill="none" strokeLinecap="round" strokeLinejoin="round">
              <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              <polyline points="9 22 9 12 15 12 15 22" />
            </svg>
            {isHomeActive && <span className={styles.activeDot} />}
          </span>
          <span className={styles.label}>{t('nav.home')}</span>
        </NavLink>

        {/* 2. Catalog */}
        <NavLink
          to="/overview"
          className={`${styles.navItem} ${isCatalogActive ? styles.active : ''}`}
          aria-label={t('nav.overview')}
        >
          <span className={styles.iconWrapper}>
            <svg viewBox="0 0 24 24" fill="none" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
            </svg>
            {isCatalogActive && <span className={styles.activeDot} />}
          </span>
          <span className={styles.label}>{t('nav.overview')}</span>
        </NavLink>

        {/* 3. Favorites */}
        <NavLink
          to="/favorites"
          className={`${styles.navItem} ${isFavoritesActive ? styles.active : ''}`}
          aria-label={t('nav.favorites')}
        >
          <span className={styles.iconWrapper}>
            <svg viewBox="0 0 24 24" fill="none" strokeLinecap="round" strokeLinejoin="round">
              <path d="m19 21-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
            </svg>
            {isFavoritesActive && <span className={styles.activeDot} />}
          </span>
          <span className={styles.label}>{t('nav.favorites')}</span>
        </NavLink>

        {/* 4. Profile */}
        <NavLink
          to={profilePath}
          className={`${styles.navItem} ${isProfileActive ? styles.active : ''}`}
          aria-label={t('nav.account')}
        >
          <span className={styles.iconWrapper}>
            <svg viewBox="0 0 24 24" fill="none" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
            {isProfileActive && <span className={styles.activeDot} />}
          </span>
          <span className={styles.label}>{t('nav.account')}</span>
        </NavLink>

        {/* 5. More */}
        <button
          type="button"
          className={`${styles.navItem} ${isMoreActive ? styles.active : ''}`}
          onClick={() => setOpenedPathname(isMoreOpen ? null : location.pathname)}
          aria-label={t('nav.more')}
          aria-expanded={isMoreOpen}
          aria-haspopup="dialog"
        >
          <span className={styles.iconWrapper}>
            <svg viewBox="0 0 24 24" fill="none" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="1.5" />
              <circle cx="19" cy="12" r="1.5" />
              <circle cx="5" cy="12" r="1.5" />
            </svg>
            {isMoreActive && <span className={styles.activeDot} />}
          </span>
          <span className={styles.label}>{t('nav.more')}</span>
        </button>
      </nav>

      {/* More Bottom Sheet */}
      <MoreBottomSheet isOpen={isMoreOpen} onClose={() => setOpenedPathname(null)} />
    </>
  );
}
