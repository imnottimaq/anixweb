import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const ICONS_DIR = join(process.cwd(), 'public', 'icons');
const LOGO_URL = 'https://anixart-app.com/assets/images/logo.svg?v2';

async function main() {
    await mkdir(ICONS_DIR, { recursive: true });

    console.log('Fetching official Anixart logo from:', LOGO_URL);
    let logoSvg;
    try {
        const res = await fetch(LOGO_URL);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        logoSvg = await res.text();
    } catch (err) {
        console.error('Failed to fetch official logo:', err);
        throw err;
    }

    // Vendor logo.svg and icon.svg
    await writeFile(join(ICONS_DIR, 'logo.svg'), logoSvg, 'utf8');
    await writeFile(join(ICONS_DIR, 'icon.svg'), logoSvg, 'utf8');
    console.log('Saved public/icons/logo.svg and public/icons/icon.svg');

    // Extract path and gradient content from logoSvg to compose inside other SVGs
    // The logoSvg structure is:
    // <svg ... viewBox="0 0 512 512"> ... </svg>
    // We can extract everything inside <svg ...> and </svg>
    const innerContentMatch = logoSvg.match(/<svg[^>]*>([\s\S]*?)<\/svg>/i);
    if (!innerContentMatch) {
        throw new Error('Failed to parse inner content of logo.svg');
    }
    const innerContent = innerContentMatch[1];

    // Measure exact bounds of inner artwork using Playwright Chromium
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    // Maskable SVG design:
    // Background: #121212 full bleed (512x512)
    // Safe circle: center (256, 256), radius 204.8 (80% diameter)
    // In original 512x512 viewBox, the logo spans from x ≈ 25 to 487, y ≈ 12 to 500.
    // Distance from center (256, 256) to corners is around 295px.
    // To fit within r=204.8 with a small margin (say r ≈ 190-195 max distance):
    // scale factor = 195 / 295 ≈ 0.66.
    // Let's test scale factor so that every non-background pixel has distance <= 204.8 from (256, 256).

    // Let's construct a maskable SVG template with a scale parameter
    function createMaskableSvg(scale = 0.66) {
        // SVG transform: scale around center (256, 256)
        // transform="translate(256, 256) scale(scale) translate(-256, -256)"
        return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <rect width="512" height="512" fill="#121212"/>
  <g transform="translate(256, 256) scale(${scale}) translate(-256, -256)">
    ${innerContent}
  </g>
</svg>`;
    }

    // Function to check pixel clipping outside the safe circle:
    // Safe circle: (x - 256)^2 + (y - 256)^2 <= 204.8^2
    // Any pixel with distance > 204.8 MUST have color #121212 (rgba 18, 18, 18, 255)
    async function verifyMaskable(scale) {
        const svg = createMaskableSvg(scale);
        await page.setContent(`<!DOCTYPE html><html><body style="margin:0;padding:0;background:#000000">${svg}</body></html>`);
        const result = await page.evaluate(() => {
            const canvas = document.createElement('canvas');
            canvas.width = 512;
            canvas.height = 512;
            const ctx = canvas.getContext('2d');
            const svgEl = document.querySelector('svg');
            const xml = new XMLSerializer().serializeToString(svgEl);
            const img = new Image();
            return new Promise((resolve) => {
                img.onload = () => {
                    ctx.drawImage(img, 0, 0);
                    const imgData = ctx.getImageData(0, 0, 512, 512).data;
                    let clippedPixels = 0;
                    let maxDistance = 0;
                    for (let y = 0; y < 512; y++) {
                        for (let x = 0; x < 512; x++) {
                            const idx = (y * 512 + x) * 4;
                            const r = imgData[idx];
                            const g = imgData[idx + 1];
                            const b = imgData[idx + 2];
                            // Check if pixel is part of artwork (not background #121212 = 18, 18, 18)
                            const isBg = Math.abs(r - 18) <= 2 && Math.abs(g - 18) <= 2 && Math.abs(b - 18) <= 2;
                            if (!isBg) {
                                const dist = Math.hypot(x - 256, y - 256);
                                if (dist > maxDistance) maxDistance = dist;
                                if (dist > 204.8) {
                                    clippedPixels++;
                                }
                            }
                        }
                    }
                    resolve({ clippedPixels, maxDistance });
                };
                img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);
            });
        });
        return result;
    }

    // Find best scale that maximizes logo size while strictly 0 clipped pixels outside 204.8 safe radius
    let chosenScale = 0.66;
    for (let s = 0.72; s >= 0.60; s -= 0.01) {
        const check = await verifyMaskable(s);
        console.log(`Testing scale ${s.toFixed(2)}: max distance = ${check.maxDistance.toFixed(1)}px, clipped pixels = ${check.clippedPixels}`);
        if (check.clippedPixels === 0 && check.maxDistance <= 200) {
            chosenScale = s;
            console.log(`Selected safe scale: ${chosenScale.toFixed(2)} with max distance ${check.maxDistance.toFixed(1)}px (safe limit: 204.8px)`);
            break;
        }
    }

    const maskableSvg = createMaskableSvg(chosenScale);
    await writeFile(join(ICONS_DIR, 'icon-maskable.svg'), maskableSvg, 'utf8');

    // Apple touch icon (180x180):
    // Apple recommends opaque background #121212 and safe padding for rounded corners (~22% radius = 40px on 180px)
    // Safe inner area ~ 140x140 => scale ≈ 0.75 inside 180x180
    function createAppleTouchSvg() {
        return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 180" width="180" height="180">
  <rect width="180" height="180" fill="#121212"/>
  <g transform="translate(90, 90) scale(${180 / 512 * 0.75}) translate(-256, -256)">
    ${innerContent}
  </g>
</svg>`;
    }

    // Function to render an SVG string directly to a PNG file using Playwright
    async function renderSvgToPng(svgStr, width, height, outputPath) {
        const renderPage = await browser.newPage({
            viewport: { width, height },
            deviceScaleFactor: 1
        });
        await renderPage.setContent(`<!DOCTYPE html><html><head><style>
* { margin:0; padding:0; overflow:hidden; }
body { width:${width}px; height:${height}px; background: transparent; }
svg { width:${width}px; height:${height}px; display:block; }
</style></head><body>${svgStr}</body></html>`);

        const element = await renderPage.locator('svg');
        await element.screenshot({ path: outputPath, omitBackground: true });
        await renderPage.close();
    }

    // Standard icons (192, 512) for purpose: "any"
    // Using clean vector logo scaled directly to 192 and 512 (with slight padding ~92% so artwork doesn't touch exact edges)
    function createAnyIconSvg(size) {
        return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
  <g transform="translate(${size / 2}, ${size / 2}) scale(${size / 512 * 0.92}) translate(-256, -256)">
    ${innerContent}
  </g>
</svg>`;
    }

    console.log('Rendering raster icons...');
    await renderSvgToPng(createAnyIconSvg(192), 192, 192, join(ICONS_DIR, 'icon-192.png'));
    await renderSvgToPng(createAnyIconSvg(512), 512, 512, join(ICONS_DIR, 'icon-512.png'));
    await renderSvgToPng(createAppleTouchSvg(), 180, 180, join(ICONS_DIR, 'apple-touch-icon.png'));
    await renderSvgToPng(maskableSvg, 512, 512, join(ICONS_DIR, 'icon-maskable-512.png'));

    // Favicons
    await renderSvgToPng(createAnyIconSvg(32), 32, 32, join(ICONS_DIR, 'favicon-32x32.png'));
    await renderSvgToPng(createAnyIconSvg(16), 16, 16, join(ICONS_DIR, 'favicon-16x16.png'));

    console.log('Rendered all icons successfully!');

    // Verification step:
    // "Render icon previews at 32/64/192 and test circular mask to verify no clipping."
    const previewsDir = join(ICONS_DIR, 'previews');
    await mkdir(previewsDir, { recursive: true });

    for (const previewSize of [32, 64, 192]) {
        // Render preview with circular mask applied
        const previewSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="${previewSize}" height="${previewSize}">
  <defs>
    <clipPath id="circleMask">
      <circle cx="256" cy="256" r="204.8"/>
    </clipPath>
  </defs>
  <rect width="512" height="512" fill="#121212"/>
  <g clip-path="url(#circleMask)">
    <rect width="512" height="512" fill="#121212"/>
    <g transform="translate(256, 256) scale(${chosenScale}) translate(-256, -256)">
      ${innerContent}
    </g>
  </g>
  <circle cx="256" cy="256" r="204.8" fill="none" stroke="rgba(255,255,255,0.3)" stroke-width="2"/>
</svg>`;
        await renderSvgToPng(previewSvg, previewSize, previewSize, join(previewsDir, `preview-${previewSize}-circle-masked.png`));
    }
    console.log('Saved preview images at 32, 64, 192 in public/icons/previews/');

    await browser.close();
}

main().catch(err => {
    console.error('Error:', err);
    process.exit(1);
});
