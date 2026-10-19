import type { WatchRoomState } from './roomProtocol';

export function roomPlaybackAccess(room: WatchRoomState | null, profileId: number) {
    const member = room?.participants.find(participant => participant.profileId === profileId && participant.connected);
    const control = Boolean(member && (member.canControl || room?.hostId === profileId));
    return { control, pause: Boolean(member && (control || room?.allowParticipantPause !== false)) };
}
