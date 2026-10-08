import type { TranslationKey } from './i18n';
export function roomErrorKey(error: string): TranslationKey {
    if (error.includes('INVITE_REQUIRED') || error.includes('HTTP 403')) return 'roomUX.errorInvite';
    if (error.includes('ROOM_CLOSED') || error.includes('HTTP 410')) return 'roomUX.errorClosed';
    if (error.includes('ROOM_KICKED')) return 'roomUX.errorKicked';
    if (error.includes('ROOM_NOT_FOUND') || error.includes('HTTP 404') || error.includes('INVALID_ROOM')) return 'roomUX.errorMissing';
    if (error.includes('AUTH_') || error.includes('SESSION_') || error.includes('HTTP 401')) return 'roomUX.errorAuth';
    if (error.includes('CONTROL_REQUIRED') || error.includes('HOST_REQUIRED')) return 'roomUX.errorPermissions';
    return 'roomV2.commandError';
}
