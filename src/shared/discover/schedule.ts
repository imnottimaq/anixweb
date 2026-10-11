import type { Anime } from '../types/api';
export type ScheduleDayKey = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';
export type ScheduleTabKey = 'all' | ScheduleDayKey;

export interface ScheduleResponse {
    code?: number;
    monday?: Anime[];
    tuesday?: Anime[];
    wednesday?: Anime[];
    thursday?: Anime[];
    friday?: Anime[];
    saturday?: Anime[];
    sunday?: Anime[];
}

export interface DayConfig {
    key: ScheduleDayKey;
    labelKey: 'roadmap.discover.schedule.monday' | 'roadmap.discover.schedule.tuesday' | 'roadmap.discover.schedule.wednesday' | 'roadmap.discover.schedule.thursday' | 'roadmap.discover.schedule.friday' | 'roadmap.discover.schedule.saturday' | 'roadmap.discover.schedule.sunday';
    dayIndex: number; // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
}

export const DAYS_CONFIG: readonly DayConfig[] = [
    { key: 'monday', labelKey: 'roadmap.discover.schedule.monday', dayIndex: 1 },
    { key: 'tuesday', labelKey: 'roadmap.discover.schedule.tuesday', dayIndex: 2 },
    { key: 'wednesday', labelKey: 'roadmap.discover.schedule.wednesday', dayIndex: 3 },
    { key: 'thursday', labelKey: 'roadmap.discover.schedule.thursday', dayIndex: 4 },
    { key: 'friday', labelKey: 'roadmap.discover.schedule.friday', dayIndex: 5 },
    { key: 'saturday', labelKey: 'roadmap.discover.schedule.saturday', dayIndex: 6 },
    { key: 'sunday', labelKey: 'roadmap.discover.schedule.sunday', dayIndex: 0 },
] as const;

export function getTodayDayKey(): ScheduleDayKey {
    const currentDay = new Date().getDay();
    const found = DAYS_CONFIG.find(d => d.dayIndex === currentDay);
    return found ? found.key : 'monday';
}

