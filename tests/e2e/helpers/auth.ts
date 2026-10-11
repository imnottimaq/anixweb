import type { Page } from '@playwright/test';
import { mockProfile } from '../fixtures/mockData';

export interface AuthStateOptions {
  isLoggedIn?: boolean;
  onboarded?: boolean;
  userId?: number;
  login?: string;
  token?: string;
  settings?: Record<string, unknown>;
}

export async function seedStorageState(page: Page, options: AuthStateOptions = {}) {
  const {
    isLoggedIn = false,
    onboarded = true,
    userId = mockProfile.id,
    login = mockProfile.login,
    token = 'test-auth-token-123',
    settings,
  } = options;

  await page.addInitScript(
    ({ isLoggedIn, onboarded, userId, login, token, settings }) => {
      if (sessionStorage.getItem('__storage_seeded') === 'true') {
        return;
      }
      sessionStorage.setItem('__storage_seeded', 'true');

      if (onboarded) {
        localStorage.setItem('onboarded', 'true');
      } else {
        localStorage.removeItem('onboarded');
      }

      if (isLoggedIn) {
        document.cookie = `anixart_token=${token}; path=/; max-age=86400`;
        localStorage.setItem('user_id', String(userId));
        localStorage.setItem(
          'user_room_identity',
          JSON.stringify({ id: userId, login, avatar: null }),
        );
      } else {
        document.cookie = 'anixart_token=; path=/; max-age=0';
        localStorage.removeItem('user_id');
        localStorage.removeItem('user_token');
        localStorage.removeItem('user_room_identity');
      }

      if (settings) {
        localStorage.setItem('app_settings', JSON.stringify(settings));
      }
    },
    { isLoggedIn, onboarded, userId, login, token, settings },
  );
}
