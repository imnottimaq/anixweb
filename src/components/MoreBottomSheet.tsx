import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from '../shared/useTranslation';
import { useSettings } from '../shared/contexts/settingsContext';
import styles from './MoreBottomSheet.module.css';

interface MoreBottomSheetProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function MoreBottomSheet({ isOpen, onClose }: MoreBottomSheetProps) {
  const { t } = useTranslation();
  const { settings, setSettings } = useSettings();
  const navigate = useNavigate();
  const [isClosing, setIsClosing] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<number | undefined>(undefined);

  const startClose = useCallback(() => {
    if (isClosing || closeTimerRef.current !== undefined) return;
    setIsClosing(true);
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = undefined;
      setIsClosing(false);
      onClose();
    }, 180);
  }, [isClosing, onClose]);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current !== undefined) {
        window.clearTimeout(closeTimerRef.current);
      }
    };
  }, []);

  const [prevIsOpen, setPrevIsOpen] = useState(isOpen);
  if (prevIsOpen !== isOpen) {
    setPrevIsOpen(isOpen);
    if (!isOpen) {
      setIsClosing(false);
    }
  }

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        startClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, startClose]);

  if (!isOpen && !isClosing) return null;

  const handleNavigate = (to: string) => {
    if (closeTimerRef.current !== undefined) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = undefined;
    }
    setIsClosing(false);
    onClose();
    navigate(to);
  };

  const toggleTheme = () => {
    setSettings(prev => ({
      ...prev,
      appearance: {
        ...prev.appearance,
        theme: prev.appearance.theme === 'dark' ? 'light' : 'dark',
      },
    }));
  };

  const isDark = settings.appearance.theme === 'dark';

  return (
    <>
      <div
        className={`${styles.backdrop} ${isClosing ? styles.backdropClosing : ''}`}
        onClick={startClose}
        aria-hidden="true"
      />
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label={t('nav.more')}
        className={`${styles.sheet} ${isClosing ? styles.sheetClosing : ''}`}
      >
        <div className={styles.handleContainer}>
          <div className={styles.handle} />
        </div>

        <div className={styles.header}>
          <h2 className={styles.title}>{t('nav.more')}</h2>
          <button
            type="button"
            className={styles.closeButton}
            onClick={startClose}
            aria-label={t('page.back')}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className={styles.grid}>
          {/* Feed */}
          <button type="button" className={styles.item} onClick={() => handleNavigate('/feed')}>
            <span className={styles.itemIcon}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 11a9 9 0 0 1 9 9" />
                <path d="M4 4a16 16 0 0 1 16 16" />
                <circle cx="5" cy="19" r="1" />
              </svg>
            </span>
            <span className={styles.itemLabel}>{t('nav.feed')}</span>
          </button>

          {/* Watch Together */}
          <button type="button" className={styles.item} onClick={() => handleNavigate('/together')}>
            <span className={styles.itemIcon}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
            </span>
            <span className={styles.itemLabel}>{t('nav.watchTogether')}</span>
          </button>

          {/* Collections */}
          <button type="button" className={styles.item} onClick={() => handleNavigate('/collections')}>
            <span className={styles.itemIcon}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
                <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
              </svg>
            </span>
            <span className={styles.itemLabel}>{t('nav.collections')}</span>
          </button>

          {/* Schedule */}
          <button type="button" className={styles.item} onClick={() => handleNavigate('/schedule')}>
            <span className={styles.itemIcon}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                <line x1="16" y1="2" x2="16" y2="6" />
                <line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
              </svg>
            </span>
            <span className={styles.itemLabel}>{t('nav.schedule')}</span>
          </button>

          {/* Random Anime */}
          <button type="button" className={styles.item} onClick={() => handleNavigate('/random')}>
            <span className={styles.itemIcon}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="16 3 21 3 21 8" />
                <line x1="4" y1="20" x2="21" y2="3" />
                <polyline points="21 16 21 21 16 21" />
                <line x1="15" y1="15" x2="21" y2="21" />
                <line x1="4" y1="4" x2="9" y2="9" />
              </svg>
            </span>
            <span className={styles.itemLabel}>{t('nav.random')}</span>
          </button>

          {/* Notifications */}
          <button type="button" className={styles.item} onClick={() => handleNavigate('/notifications')}>
            <span className={styles.itemIcon}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
            </span>
            <span className={styles.itemLabel}>{t('nav.notifications')}</span>
          </button>

          {/* Downloads */}
          <button type="button" className={styles.item} onClick={() => handleNavigate('/downloads')}>
            <span className={styles.itemIcon}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
            </span>
            <span className={styles.itemLabel}>{t('nav.downloads')}</span>
          </button>

          {/* Settings */}
          <button type="button" className={styles.item} onClick={() => handleNavigate('/settings')}>
            <span className={styles.itemIcon}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            </span>
            <span className={styles.itemLabel}>{t('nav.settings')}</span>
          </button>

          {/* Theme Toggle */}
          <button type="button" className={styles.item} onClick={toggleTheme}>
            <span className={styles.itemIcon}>
              {isDark ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="5" />
                  <line x1="12" y1="1" x2="12" y2="3" />
                  <line x1="12" y1="21" x2="12" y2="23" />
                  <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                  <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                  <line x1="1" y1="12" x2="3" y2="12" />
                  <line x1="21" y1="12" x2="23" y2="12" />
                  <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                  <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                </svg>
              )}
            </span>
            <span className={styles.itemLabel}>{isDark ? t('theme.light') : t('theme.dark')}</span>
          </button>
        </div>
      </div>
    </>
  );
}
