export function plural(value: number, one: string, few: string, many: string) {
    const lastTwoDigits = Math.abs(value) % 100;
    const lastDigit = lastTwoDigits % 10;

    if (lastTwoDigits >= 11 && lastTwoDigits <= 14) return many;
    if (lastDigit === 1) return one;
    if (lastDigit >= 2 && lastDigit <= 4) return few;
    return many;
}
