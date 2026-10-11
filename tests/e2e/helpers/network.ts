import type { Page, Route } from '@playwright/test';
import {
  mockProfile,
  mockAnime1,
  mockAnimeDetail,
  mockDubs,
  mockSources,
  mockEpisodes,
  mockCollection1,
  createPagedResponse,
} from '../fixtures/mockData';

// 1x1 transparent PNG in base64
const TRANSPARENT_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

export async function setupDeterministicNetwork(page: Page, options: {
  isLoggedIn?: boolean;
} = {}) {
  // Catch-all route to prevent external leaks while allowing local dev server
  await page.route('**/*', async (route: Route) => {
    const url = route.request().url();

    // Allow local vite dev server and internal URLs
    if (
      url.startsWith('http://127.0.0.1:') ||
      url.startsWith('http://localhost:') ||
      url.startsWith('data:') ||
      url.startsWith('blob:')
    ) {
      return route.continue();
    }

    // Fulfill image requests with transparent PNG
    if (
      /\.(jpg|jpeg|png|gif|webp|svg)(\?.*)?$/i.test(url) ||
      url.includes('/avatar') ||
      url.includes('images.example.com')
    ) {
      return route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: TRANSPARENT_PNG,
      });
    }

    // Shikimori proxy
    if (url.includes('shikimori.one')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: { animes: [{ name: 'Shingeki no Kyojin', russian: 'Атака титанов' }] },
        }),
      });
    }

    // Default API mocks for api-s.anixsekai.com
    if (url.includes('api-s.anixsekai.com')) {
      const parsedUrl = new URL(url);
      const path = parsedUrl.pathname;

      // Profile info check on app start
      if (path === '/profile/info') {
        if (options.isLoggedIn) {
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              code: 0,
              id: mockProfile.id,
              profile: mockProfile,
            }),
          });
        }
        return route.fulfill({
          status: 401,
          contentType: 'application/json',
          body: JSON.stringify({ code: 1, message: 'Unauthorized' }),
        });
      }

      // Default filter releases (Homepage)
      if (path.startsWith('/filter/')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(createPagedResponse([mockAnime1])),
        });
      }

      // Default release detail
      if (path === `/release/${mockAnimeDetail.id}` || path === '/release/101') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ code: 0, release: mockAnimeDetail }),
        });
      }

      // Dubs & Sources & Episodes for player
      if (path.includes('/episode/')) {
        const segments = path.split('/').filter(Boolean);
        // segments: ['episode', releaseId, dubId?, sourceId?]
        if (segments.length >= 4) {
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ code: 0, episodes: mockEpisodes }),
          });
        }
        if (segments.length === 3) {
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ code: 0, sources: mockSources }),
          });
        }
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ code: 0, types: mockDubs }),
        });
      }

      // Default collection
      if (path === `/collection/${mockCollection1.id}` || path === '/collection/201') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ code: 0, collection: mockCollection1 }),
        });
      }

      if (path === `/collection/${mockCollection1.id}/releases/0` || path === '/collection/201/releases/0') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(createPagedResponse([mockAnime1])),
        });
      }

      // Unhandled API route defaults to safe empty response
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ code: 0, content: [] }),
      });
    }

    // Default fallback: abort external network call
    return route.abort();
  });
}
