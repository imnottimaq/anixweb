import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';

function getPngDimensions(buffer) {
    // Check PNG signature
    assert.equal(buffer[0], 0x89);
    assert.equal(buffer[1], 0x50); // P
    assert.equal(buffer[2], 0x4e); // N
    assert.equal(buffer[3], 0x47); // G
    // IHDR dimensions
    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);
    return { width, height };
}

test('index.html CSP permits localhost and 127.0.0.1 for HTTP/WS and preserves production security', () => {
    const html = readFileSync('index.html', 'utf8');
    const cspMatch = html.match(/content="([^"]*Content-Security-Policy[^"]*)"/i) || html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]*)"/i);
    assert.ok(cspMatch, 'CSP meta tag must exist');
    const csp = cspMatch[1];

    // Check connect-src
    const connectSrcMatch = csp.match(/connect-src\s+([^;]+)/);
    assert.ok(connectSrcMatch, 'connect-src directive must exist');
    const connectSrc = connectSrcMatch[1];

    assert.ok(connectSrc.includes("'self'"), 'connect-src must permit self');
    assert.ok(connectSrc.includes('https:'), 'connect-src must permit https:');
    assert.ok(connectSrc.includes('wss:'), 'connect-src must permit wss:');
    assert.ok(connectSrc.includes('http://localhost:*'), 'connect-src must permit localhost HTTP');
    assert.ok(connectSrc.includes('ws://localhost:*'), 'connect-src must permit localhost WS');
    assert.ok(connectSrc.includes('http://127.0.0.1:*'), 'connect-src must permit 127.0.0.1 HTTP');
    assert.ok(connectSrc.includes('ws://127.0.0.1:*'), 'connect-src must permit 127.0.0.1 WS');

    // Ensure production security: no open wildcard 'http:' or insecure origins
    assert.ok(!connectSrc.includes(' http: '), 'connect-src must not allow unrestricted insecure http:');
    assert.ok(!connectSrc.includes(' ws: '), 'connect-src must not allow unrestricted insecure ws:');
    assert.ok(!csp.includes("'unsafe-eval'"), 'CSP script-src must not allow unsafe-eval');
});

test('index.html links for manifest and apple-touch-icon are relative and base-aware', () => {
    const html = readFileSync('index.html', 'utf8');

    const manifestLink = html.match(/<link\s+[^>]*rel="manifest"[^>]*>/i);
    assert.ok(manifestLink, 'Manifest link must exist');
    assert.ok(manifestLink[0].includes('href="./manifest.webmanifest"') || manifestLink[0].includes('href="manifest.webmanifest"'), 'Manifest link must be relative');

    const appleIconLink = html.match(/<link\s+[^>]*rel="apple-touch-icon"[^>]*>/i);
    assert.ok(appleIconLink, 'Apple touch icon link must exist');
    assert.ok(appleIconLink[0].includes('href="./icons/apple-touch-icon.png"') || appleIconLink[0].includes('href="icons/apple-touch-icon.png"'), 'Apple touch icon link must be relative');
});

test('main.tsx registers service worker using import.meta.env.BASE_URL with explicit scope', () => {
    const mainTsx = readFileSync('src/main.tsx', 'utf8');
    assert.ok(
        mainTsx.includes('import.meta.env.BASE_URL') &&
        mainTsx.includes('navigator.serviceWorker.register') &&
        mainTsx.includes('scope: import.meta.env.BASE_URL'),
        'serviceWorker.register must use import.meta.env.BASE_URL for path and scope'
    );
});

test('manifest.webmanifest has relative start_url, scope, and relative icon paths', () => {
    assert.ok(existsSync('public/manifest.webmanifest'));
    const manifest = JSON.parse(readFileSync('public/manifest.webmanifest', 'utf8'));

    assert.equal(manifest.name, 'Anixweb');
    assert.equal(manifest.short_name, 'Anixweb');
    assert.equal(manifest.start_url, './');
    assert.equal(manifest.scope, './');
    assert.equal(manifest.display, 'standalone');
    assert.equal(manifest.theme_color, '#121212');

    assert.ok(Array.isArray(manifest.icons) && manifest.icons.length >= 4);
    for (const icon of manifest.icons) {
        assert.ok(!icon.src.startsWith('/'), `Icon path must be relative: ${icon.src}`);
        assert.ok(existsSync(join('public', icon.src)), `Icon file must exist: ${icon.src}`);
    }

    const maskable = manifest.icons.find(i => i.purpose === 'maskable');
    assert.ok(maskable, 'Maskable icon must be defined in manifest');
    assert.equal(maskable.sizes, '512x512');
});

test('service worker public/sw.js implements scope-aware caching, safe cache deletion and strict exclusions', () => {
    const sw = readFileSync('public/sw.js', 'utf8');

    // Scope-aware cache name
    assert.ok(sw.includes('self.registration.scope'), 'sw.js must derive base from self.registration.scope');
    assert.ok(sw.includes('anixweb-v2-'), 'sw.js must isolate cache name with anixweb-v2-');

    // Safe activate deletion
    assert.ok(sw.includes("startsWith('anixweb-')") || sw.includes('startsWith(CACHE_PREFIX)'), 'activate must only delete caches matching this app prefix');

    // Prohibited cache paths
    assert.ok(sw.includes('/api/v2/user'), 'sw.js must never cache user account API');
    assert.ok(sw.includes('/api/v2/session'), 'sw.js must never cache session API');
    assert.ok(sw.includes('/corsproxy'), 'sw.js must never cache corsproxy');
    assert.ok(sw.includes('/agentproxy'), 'sw.js must never cache agentproxy');

    // Scope relative static assets
    assert.ok(sw.includes('STATIC_ASSETS'), 'sw.js must define STATIC_ASSETS');
});

test('icons exist with exact dimensions and proper formatting', () => {
    // Logo and SVG
    assert.ok(existsSync('public/icons/logo.svg'), 'logo.svg must exist');
    assert.ok(existsSync('public/icons/icon.svg'), 'icon.svg must exist');

    const logoSvg = readFileSync('public/icons/logo.svg', 'utf8');
    assert.ok(logoSvg.includes('<svg') && logoSvg.includes('viewBox="0 0 512 512"'), 'logo.svg must be valid 512x512 SVG');

    // 192x192
    const icon192 = readFileSync('public/icons/icon-192.png');
    assert.deepEqual(getPngDimensions(icon192), { width: 192, height: 192 });

    // 512x512
    const icon512 = readFileSync('public/icons/icon-512.png');
    assert.deepEqual(getPngDimensions(icon512), { width: 512, height: 512 });

    // 180x180 Apple touch icon
    const appleIcon = readFileSync('public/icons/apple-touch-icon.png');
    assert.deepEqual(getPngDimensions(appleIcon), { width: 180, height: 180 });

    // 512x512 Maskable icon
    const maskable512 = readFileSync('public/icons/icon-maskable-512.png');
    assert.deepEqual(getPngDimensions(maskable512), { width: 512, height: 512 });

    // Masked previews
    assert.ok(existsSync('public/icons/previews/preview-32-circle-masked.png'));
    assert.ok(existsSync('public/icons/previews/preview-64-circle-masked.png'));
    assert.ok(existsSync('public/icons/previews/preview-192-circle-masked.png'));
});

test('Vite build succeeds for root base path and subpath /anixweb/', { timeout: 60000 }, () => {
    // Build root base path
    execSync('npx vite build', { env: { ...process.env, BASE_PATH: '/' }, stdio: 'pipe' });
    const rootHtml = readFileSync('dist/index.html', 'utf8');
    assert.ok(rootHtml.includes('manifest.webmanifest'), 'Built root HTML includes manifest');

    // Build subpath base path
    execSync('npx vite build', { env: { ...process.env, BASE_PATH: '/anixweb/' }, stdio: 'pipe' });
    const subpathHtml = readFileSync('dist/index.html', 'utf8');
    assert.ok(subpathHtml.includes('/anixweb/'), 'Built subpath HTML uses /anixweb/ base');
});
