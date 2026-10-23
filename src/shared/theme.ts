import type { AppSettings } from './types/settings';

export interface ColorPreset {
    label: string;
    color: string;
}

export const ACCENT_COLOR_PRESETS: readonly ColorPreset[] = [
    { label: 'Коралловый', color: '#FF6060' },
    { label: 'Индиго', color: '#6366F1' },
    { label: 'Фиолетовый', color: '#A855F7' },
    { label: 'Изумрудный', color: '#10B981' },
    { label: 'Янтарный', color: '#F59E0B' },
    { label: 'Голубой', color: '#0EA5E9' },
    { label: 'Розовый', color: '#EC4899' },
    { label: 'Классический серый', color: '#e5e4df' },
] as const;

export const BACKGROUND_COLOR_PRESETS: readonly ColorPreset[] = [
    { label: 'OLED Чёрный', color: '#000000' },
    { label: 'Тёмный угольный', color: '#161616' },
    { label: 'Глубокий синий', color: '#0b0f19' },
    { label: 'Ночной фиолетовый', color: '#130f1e' },
    { label: 'Хвойная ночь', color: '#0a1410' },
    { label: 'Светло-серый', color: '#f7f8fa' },
    { label: 'Чистый белый', color: '#ffffff' },
] as const;

export function getLuminance(hex: string): number {
    try {
        let clean = hex.replace('#', '').trim();
        if (clean.length === 3) {
            clean = clean.split('').map(c => c + c).join('');
        }
        if (clean.length !== 6) return 0.5;

        const r = parseInt(clean.substring(0, 2), 16) / 255;
        const g = parseInt(clean.substring(2, 4), 16) / 255;
        const b = parseInt(clean.substring(4, 6), 16) / 255;

        if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return 0.5;

        const [rLin, gLin, bLin] = [r, g, b].map(v => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
        return 0.2126 * rLin + 0.7152 * gLin + 0.0722 * bLin;
    } catch {
        return 0.5;
    }
}

export function getContrastRatio(hex1: string, hex2: string): number {
    const l1 = getLuminance(hex1);
    const l2 = getLuminance(hex2);
    const lighter = Math.max(l1, l2);
    const darker = Math.min(l1, l2);
    return (lighter + 0.05) / (darker + 0.05);
}

export function getAutoTextColor(bgHex: string): { textColor: string; secondaryTextColor: string; isDark: boolean } {
    const lum = getLuminance(bgHex);
    const isDark = lum < 0.185;
    return {
        textColor: isDark ? '#f4f5f7' : '#1d1f24',
        secondaryTextColor: isDark ? '#aeb3bd' : '#686e7b',
        isDark,
    };
}

export function getAccentTextColor(accentHex = '#FF6060', darkCandidate = '#1d1f24', whiteCandidate = '#ffffff'): string {
    const candidates = [darkCandidate, whiteCandidate, '#000000'];
    return candidates.find(color => getContrastRatio(accentHex, color) >= 4.5)
        ?? candidates.reduce((best, color) => getContrastRatio(accentHex, color) > getContrastRatio(accentHex, best) ? color : best);
}

export function mixHex(first: string, second: string, amount: number): string {
    const expand = (value: string) => value.length === 4 ? '#' + [...value.slice(1)].map(c => c + c).join('') : value;
    const a = expand(first), b = expand(second);
    return '#' + [1, 3, 5].map(offset => Math.round(parseInt(a.slice(offset, offset + 2), 16) * (1 - amount) + parseInt(b.slice(offset, offset + 2), 16) * amount).toString(16).padStart(2, '0')).join('');
}

export function getAccessibleAccent(accent: string, background: string, minimum = 4.5): string {
    if (getContrastRatio(accent, background) >= minimum) return accent;
    const target = getContrastRatio('#000000', background) > getContrastRatio('#ffffff', background) ? '#000000' : '#ffffff';
    for (let step = 1; step <= 100; step++) {
        const mixed = mixHex(accent, target, step / 100);
        if (getContrastRatio(mixed, background) >= minimum) return mixed;
    }
    return target;
}

const CUSTOM_STYLE_PROPERTIES = [
    '--background-color',
    '--surface-page',
    '--card-bg',
    '--lighter-background-color',
    '--text-color',
    '--text-secondary',
    '--border-color',
    '--accent-color',
    '--lighter-accent-color',
    '--accent-text-color',
    '--accent-foreground',
    '--focus-ring-color',
    '--accent-link-color',
    '--accent-hover-foreground',
    '--feed-accent-foreground',
    '--control-border',
    '--error-color',
];

export function applyTheme(appearance: AppSettings['appearance']): () => void {
    if (typeof window === 'undefined') return () => {};

    const root = document.documentElement;
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    const update = () => {
        const { theme, highContrast, customColors } = appearance;

        // 1. High contrast attribute
        if (highContrast) {
            root.dataset.highContrast = 'true';
        } else {
            delete root.dataset.highContrast;
        }

        // 2. Compact mode attribute
        if (appearance.compactMode) {
            root.dataset.compact = 'true';
        } else {
            delete root.dataset.compact;
        }

        // 2. Resolve effective theme and apply color properties
        let effectiveTheme: 'light' | 'dark';

        if (customColors?.enabled && !highContrast) {
            root.dataset.customColors = 'true';

            const bgLuminance = getLuminance(customColors.backgroundColor);
            let isBgDark: boolean;
            let finalTextColor: string;
            let finalSecondaryTextColor: string;

            if (customColors.autoTextColor) {
                const auto = getAutoTextColor(customColors.backgroundColor);
                isBgDark = auto.isDark;
                finalTextColor = auto.textColor;
                finalSecondaryTextColor = auto.secondaryTextColor;
            } else {
                finalTextColor = customColors.textColor || '#f4f5f7';
                finalSecondaryTextColor = `color-mix(in srgb, ${finalTextColor} 70%, transparent)`;
                const textLum = getLuminance(finalTextColor);
                isBgDark = textLum >= bgLuminance;
            }

            effectiveTheme = isBgDark ? 'dark' : 'light';
            const accentText = !isBgDark && getContrastRatio(customColors.accentColor, '#ffffff') >= 2.0
                ? '#ffffff'
                : getAccentTextColor(customColors.accentColor);

            root.style.setProperty('--background-color', customColors.backgroundColor);
            root.style.setProperty('--surface-page', customColors.backgroundColor);
            root.style.setProperty('--text-color', finalTextColor);
            root.style.setProperty('--text-secondary', finalSecondaryTextColor);
            root.style.setProperty('--accent-color', customColors.accentColor);
            const hoverAccent = mixHex(customColors.accentColor, '#ffffff', .15);
            root.style.setProperty('--lighter-accent-color', hoverAccent);
            const hoverAccentText = !isBgDark && getContrastRatio(hoverAccent, '#ffffff') >= 2.0
                ? '#ffffff'
                : getAccentTextColor(hoverAccent);
            root.style.setProperty('--accent-hover-foreground', hoverAccentText);
            root.style.setProperty('--accent-link-color', getAccessibleAccent(customColors.accentColor, customColors.backgroundColor));
            root.style.setProperty('--feed-accent-foreground', accentText);
            root.style.setProperty('--control-border', getAccessibleAccent('#777777', customColors.backgroundColor, 3));
            root.style.setProperty('--error-color', getAccessibleAccent('#eb5757', customColors.backgroundColor));
            root.style.setProperty('--accent-text-color', accentText);
            root.style.setProperty('--accent-foreground', accentText);
            root.style.setProperty('--focus-ring-color', getAccessibleAccent(customColors.accentColor, customColors.backgroundColor, 3));

            if (isBgDark) {
                root.style.setProperty('--card-bg', `color-mix(in srgb, ${customColors.backgroundColor} 92%, white 8%)`);
                root.style.setProperty('--lighter-background-color', `color-mix(in srgb, ${customColors.backgroundColor} 82%, white 18%)`);
                root.style.setProperty('--border-color', `color-mix(in srgb, ${customColors.backgroundColor} 75%, white 25%)`);
            } else {
                root.style.setProperty('--card-bg', `color-mix(in srgb, ${customColors.backgroundColor} 96%, black 4%)`);
                root.style.setProperty('--lighter-background-color', `color-mix(in srgb, ${customColors.backgroundColor} 90%, black 10%)`);
                root.style.setProperty('--border-color', `color-mix(in srgb, ${customColors.backgroundColor} 85%, black 15%)`);
            }
        } else {
            delete root.dataset.customColors;
            for (const prop of CUSTOM_STYLE_PROPERTIES) {
                root.style.removeProperty(prop);
            }

            const systemPrefersDark = mediaQuery.matches;
            if (theme === 'system') {
                effectiveTheme = systemPrefersDark ? 'dark' : 'light';
            } else {
                effectiveTheme = theme === 'dark' ? 'dark' : 'light';
            }
        }

        root.dataset.theme = effectiveTheme;
        root.style.colorScheme = effectiveTheme;
    };

    update();

    if (appearance.theme === 'system' && (!appearance.customColors?.enabled || appearance.highContrast)) {
        mediaQuery.addEventListener('change', update);
        return () => mediaQuery.removeEventListener('change', update);
    }

    return () => {};
}
