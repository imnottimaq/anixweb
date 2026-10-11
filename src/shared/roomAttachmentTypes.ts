export {
    MAX_ATTACHMENT_BYTES,
    MAX_VOICE_DURATION_MS,
    type RoomAttachmentKind,
    type RoomAttachment,
    type RoomChatMessage,
} from './roomProtocol';

export interface UploadRoomAttachmentOptions {
    kind: 'image' | 'voice';
    name: string;
    durationMs?: number;
    text?: string;
    uploadId?: string;
}
