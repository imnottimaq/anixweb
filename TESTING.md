# Testing Guide

This document describes the automated test infrastructure, commands, fixture boundaries, browser prerequisites, coverage reports, and known hardware/provider boundaries for `anixweb` and sibling `anixweb-server`.

---

## Test Suites and Commands

### `anixweb` (Frontend Client)

| Command | Suite | Runner / Engine | Description |
|---|---|---|---|
| `npm test` | Aggregate Suite | `node:test` + Vitest | Runs both node unit tests and React UI component tests. |
| `npm run test:unit` | Baseline Node Tests | `node --test tests/*.test.mjs` | Fast protocol, parser, crypto, and architecture contract tests. |
| `npm run test:ui` | React Component / Hook Suite | Vitest (`jsdom` + `@testing-library/react`) | Real React DOM rendering, user interactions, and hook lifecycles. |
| `npm run test:coverage` | UI Coverage Report | Vitest (`@vitest/coverage-v8`) | Measures code coverage for `src/**/*.{ts,tsx}` in text, HTML, and JSON formats. |
| `npm run test:e2e` | Standalone Page E2E Tests | `@playwright/test` | Real browser tests validating critical user flows on the configured local Vite port. |
| `npm run lint` | Linter | ESLint Flat Config | Validates TypeScript and React code conventions. |
| `npm run build` | Typecheck & Bundle | `tsc -b && vite build` | Typechecks source and tests, compiles production bundle. |

### `anixweb-server` (Backend Worker & Durable Objects)

| Command | Suite | Runner / Engine | Description |
|---|---|---|---|
| `npm test` | Worker & Integration Suite | `node --experimental-strip-types --test tests/*.test.ts` | Miniflare/workerd tests for HTTP proxy, ticket auth, and Durable Objects. |
| `npm run test:browser` | Real Multi-Browser Fixtures | `node --test tests/browser.mjs tests/socialBrowser.mjs tests/attachmentsBrowser.mjs` | Multi-context Chromium tests driving real Worker playback, chat, reactions, voice/image attachments, cleanup, and reconnect history. |
| `npm run test:social:browser` | Room Chat & Reactions | `node --test tests/socialBrowser.mjs` | Focused real Worker + Chromium social scenario. |
| `npm run build` | Typecheck & Bundle | `tsc --noEmit && wrangler deploy --dry-run` | TypeScript verification and Wrangler bundling check. |

---

## Fixture Boundaries and Mocking Strategy

1. **Client UI Tests (`tests/ui/`)**:
   - Executes in a simulated DOM environment (`jsdom`).
   - Uses real imported React components and hooks under test.
   - Network requests (`fetch`, WebSocket) and routing are mocked at deterministic boundary levels without mocking internal React component internals.
   - Accessible labels and roles (`getByRole`, `getByLabelText`, `getByText`) are used for element queries.

2. **Client E2E Tests (`tests/e2e/`)**:
   - Uses local Chromium instances via Playwright.
   - Network routing blocks external internet requests. Upstream APIs (`/api/v2/...`, room tickets, media CDN endpoints) are intercepted deterministically via `page.route` or local fixture servers.
   - Standalone page tests use the Vite port in `playwright.config.ts`. Worker room fixtures select free ports and isolate their Vite caches so they can run together.

3. **Server Worker Tests (`tests/*.test.ts`)**:
   - Runs against Miniflare 5 / Cloudflare workerd runtime, testing actual Worker request handling and Durable Object alarms.
   - Timing-sensitive tests (e.g. 7-second readiness barrier, empty room TTL) use controlled clock steps or direct durable alarm triggers rather than large wall-clock delays.

4. **Multi-Browser Integration Fixture (`tests/browser.mjs`)**:
   - Cross-repository integration check testing dual Chromium browser contexts connecting to a live local Miniflare instance and exchanging playback commands over WebSockets.

---

## Browser Installation

`npm run test:production` builds the real app under `/anixweb/` and runs route recovery checks in Chromium, Firefox, and WebKit. Chromium additionally verifies service-worker installation, an unvisited lazy route opening offline, and offline reloads. Install these browsers with `npx playwright install chromium firefox webkit` (`--with-deps` on Linux). To run only the installed Chromium browser locally, use `npm run test:production -- --project chromium`.

`tests/serviceWorker.test.mjs` exercises failed installation rollback, version transitions, scope-isolated cleanup, and API/media cache exclusions. Build tests also verify that every emitted precache asset exists for both root and subpath builds. Service workers are registered only in production; development uses Vite directly. Production worker updates wait for the previous version's tabs to close, keeping HTML and lazy chunks on the same build.

Room closure regression tests distinguish server acknowledgement/`room_closed` from network loss, denial, and timeout. Failed closure retains membership and confirmation controls for retry. Settings restore tests render `App` and edit local settings during both profile validation and cloud loading. Search browser tests cover success followed by a failed different query and retry.

Playwright Chromium browser binaries are required for running E2E tests:
```bash
npx playwright install chromium
```
On Linux CI environments, include OS dependencies:
```bash
npx playwright install chromium --with-deps
```

---

## Coverage Reports

Room social regression checks live in `tests/ui/social.test.tsx` and `tests/ui/roomSocialBoundaries.test.tsx`, with Worker cases in `anixweb-server/tests/social.test.ts` and `socialBoundaries.test.ts`. They cover plain-text rendering, sending/errors, keyboard isolation, unread history at the 50-message cap, reaction expiry/deduplication/timer cleanup, authoritative identities, and durable rate limits. The real social browser fixture uses actual Worker WebSockets and saves `test-results/watch-room-chat.png` and `watch-room-reaction.png` in the client repository.

Coverage is generated by Vitest using the V8 coverage provider:
- **Text summary**: Printed directly to stdout.
- **HTML report**: Written to `coverage/index.html` (viewable in browser).
- **JSON summary**: Written to `coverage/coverage-final.json`.

*Note: Vitest coverage instrumentally measures real client application code under `src/`. Node-level `.mjs` suites run separately under `node:test`.*

---

## Untested Hardware and Provider Boundaries

1. **WebGPU / Anime4K Shader Acceleration**:
   - Headless test environments (CI, jsdom, headless Chromium without GPU flags) lack physical WebGPU adapter access.
   - GPU upscaling tests verify lifecycle destruction and fallback paths; hardware shader execution requires physical GPU hardware.
2. **Third-Party Upstream Video CDNs & OAuth**:
   - External provider video streams (Sibnet, VK, OK) and real user accounts require valid external sessions and network access.
   - Automated test suites do not make unauthenticated or authenticated calls to live third-party production servers; all external boundaries are exercised via local fixtures and mock responses.


## Room image and voice attachment tests

Run `npm test`, `npm run lint`, and `npm run build` in this client repository. In `../anixweb-server`, run `npm test`, `npm run build`, and `npm run test:browser` (all three real Worker browser fixtures), or `npm run test:attachments:browser` for attachments alone.

The attachment browser fixture uploads and decodes a real PNG, records through native MediaRecorder with a fake microphone, plays received audio in another browser context, reloads history, checks private file access and exact 5,000,000-byte boundaries, and inspects actual SQLite storage after host closure. It checks the composer at desktop and 390 px mobile widths. No physical microphone is used. Its screenshot is `test-results/watch-room-attachments.png`.

Regression suites cover denied/pending microphone permission, cancel/restart races, stale recorder events, disconnect stop and draft retention, account changes, URL ownership, upload cancellation and retry IDs. Worker fault injection checks atomic file/history/receipt/eviction writes, durable cleanup retry, room-directory outages, and automatic empty-room expiry. The 5 MB limit applies to images and voice; recordings stop at 120 seconds. Attachment bytes stay in room storage, disappear on host closure or empty-room expiry, and are evicted when their messages leave the last-50-message history.


## Roadmap and release-menu regressions

`npx playwright test tests/e2e/releaseContextMenu.spec.ts tests/e2e/settings.spec.ts tests/e2e/roadmap.integration.spec.ts` exercises card metadata without redundant release reads, mutation retry/locking, persisted unassigned shortcuts, the initial favorites tab, weekly comment JSON identity references, schedule outage recovery, Popular pagination and later-page retry, real MP4 file bytes, focus loss during loading, and fullscreen denial/retry and quality changes.

The media browser checks use a public W3C Sintel MP4 fixture, cached by the Worker fixtures under the OS temporary directory. Set `ANIXWEB_TEST_VIDEO` to an existing MP4 for offline runs. The roadmap page suite fetches the public fixture if no cached file exists; application/provider requests remain intercepted at API boundaries. Fullscreen denial is injected once, followed by a real Chromium fullscreen request from a button click. Safari fallback is covered with production helper/media doubles; it is not a physical Safari test.

`node --test tests/roadmapTransferRegression.test.mjs` covers transfer regressions including MAL numeric status semantics, external service ID ownership, generic XML identifiers, season identity, cancelled/failed exports, duplicate destination conflicts, and cancellation between mutations. Import/export tests use fixture accounts and never change a live Anixart or Shikimori list.
