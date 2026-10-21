import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';

/** Generate the worker from the actual bundle so every lazy route is available offline. */
export function offlineShell(): Plugin {
    let root: string;
    return {
        name: 'anixweb-offline-shell',
        apply: 'build',
        configResolved(config) { root = config.root; },
        generateBundle: {
            order: 'post',
            handler(_options, bundle) {
                const template = readFileSync(resolve(root, 'public/sw.js'), 'utf8');
                const files = Object.keys(bundle).filter(file => file !== 'sw.js' && !file.endsWith('.map')).sort();
                const version = createHash('sha256').update(template);
                for (const file of files) {
                    const output = bundle[file];
                    version.update(file).update(output.type === 'chunk' ? output.code : output.source);
                }
                for (const file of [
                    'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png',
                    'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png',
                ]) version.update(readFileSync(resolve(root, 'public', file)));
                const isExcludedFromPrecache = (file: string) => file.includes('anime4k');
                const assets = files.filter(file => file !== 'index.html' && !isExcludedFromPrecache(file));
                const optionalAssets = files.filter(file => isExcludedFromPrecache(file));
                this.emitFile({
                    type: 'asset', fileName: 'sw.js',
                    source: template
                        .replace('__BUILD_VERSION__', version.digest('hex').slice(0, 20))
                        .replace('const BUILD_ASSETS = [];', `const BUILD_ASSETS = ${JSON.stringify(assets)};`)
                        .replace('const OPTIONAL_ASSETS = [];', `const OPTIONAL_ASSETS = ${JSON.stringify(optionalAssets)};`),
                });
            },
        },
    };
}
