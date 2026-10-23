import { describe, expect, it } from 'vitest';
import { ACCENT_COLOR_PRESETS, BACKGROUND_COLOR_PRESETS, applyTheme, getAccentTextColor, getAccessibleAccent, mixHex } from '../../src/shared/theme';

// Calculate the WCAG ratio independently of the theme's implementation.
function contrast(first: string, second: string): number {
    const luminance = (hex: string) => {
        const short = hex.slice(1);
        const expanded = short.length === 3 ? [...short].map(channel => channel + channel).join('') : short;
        const channels = [0, 2, 4].map(offset => {
            const value = Number.parseInt(expanded.slice(offset, offset + 2), 16) / 255;
            return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
        });
        return .2126 * channels[0] + .7152 * channels[1] + .0722 * channels[2];
    };
    const a = luminance(first), b = luminance(second);
    return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
}

const accents = [...ACCENT_COLOR_PRESETS.map(preset => preset.color), '#000000', '#ffffff', '#777777', '#767676', '#ffff00', '#00ffff', '#ff00ff', '#abc'];
const backgrounds = [...BACKGROUND_COLOR_PRESETS.map(preset => preset.color), '#777777', '#808080', '#ff6060', '#d9e8ff', '#1d283b'];

describe('accessible accent color calculations', () => {
    it('uses dark text on the default coral and passes ordinary-text contrast', () => {
        const foreground = getAccentTextColor();
        expect(foreground).not.toBe('#ffffff');
        expect(contrast('#FF6060', foreground)).toBeGreaterThanOrEqual(4.5);
    });

    it.each(accents)('provides readable labels for preset/custom accent %s and its hover fill', accent => {
        expect(contrast(accent, getAccentTextColor(accent))).toBeGreaterThanOrEqual(4.5);
        const hover = mixHex(accent, '#ffffff', .15);
        expect(contrast(hover, getAccentTextColor(hover))).toBeGreaterThanOrEqual(4.5);
    });

    it('uses the black fallback when neither the standard dark nor white candidate passes', () => {
        expect(contrast('#777777', '#1d1f24')).toBeLessThan(4.5);
        expect(contrast('#777777', '#ffffff')).toBeLessThan(4.5);
        expect(getAccentTextColor('#777777')).toBe('#000000');
        expect(contrast('#777777', getAccentTextColor('#777777'))).toBeGreaterThanOrEqual(4.5);
    });

    it.each(backgrounds)('keeps links and focus indicators readable against %s', background => {
        for (const accent of accents) {
            expect(contrast(getAccessibleAccent(accent, background), background), `link ${accent} on ${background}`).toBeGreaterThanOrEqual(4.5);
            expect(contrast(getAccessibleAccent(accent, background, 3), background), `focus ${accent} on ${background}`).toBeGreaterThanOrEqual(3);
        }
    });

    it('preserves already accessible accents and mixes shorthand hex and endpoints correctly', () => {
        expect(getAccessibleAccent('#ffffff', '#000000')).toBe('#ffffff');
        expect(getAccessibleAccent('#000000', '#ffffff', 3)).toBe('#000000');
        expect(mixHex('#000', '#fff', 0)).toBe('#000000');
        expect(mixHex('#000', '#fff', 1)).toBe('#ffffff');
        expect(mixHex('#000', '#fff', .5)).toBe('#808080');
        expect(mixHex('#ff6060', '#ffffff', .15)).toBe('#ff7878');
    });

    it('sets white text on accent background in light theme with custom colors', () => {
        applyTheme({
            theme: 'light',
            highContrast: false,
            compactMode: false,
            language: 'russian',
            defaultCardType: 'vertical',
            customColors: {
                enabled: true,
                backgroundColor: '#ffffff',
                accentColor: '#FF6060',
                textColor: '#1d1f24',
                autoTextColor: true,
            },
        });
        expect(document.documentElement.style.getPropertyValue('--accent-text-color')).toBe('#ffffff');
        expect(document.documentElement.style.getPropertyValue('--accent-foreground')).toBe('#ffffff');
        expect(document.documentElement.style.getPropertyValue('--feed-accent-foreground')).toBe('#ffffff');
    });
});
