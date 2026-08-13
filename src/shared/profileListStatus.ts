import type { TranslationKey } from './i18n';

type ProfileListStatus = { labelKey: TranslationKey; color: string } | null;

export const profileListStatus: Record<0 | 1 | 2 | 3 | 4 | 5, ProfileListStatus> = {
    0: null,
    1: { labelKey: 'status.watching', color: 'watching' },
    2: { labelKey: 'status.planned', color: 'plan' },
    3: { labelKey: 'status.watched', color: 'completed' },
    4: { labelKey: 'status.hold_on', color: 'hold' },
    5: { labelKey: 'status.dropped', color: 'dropped' },
};
