import type { RoomCommandPayload, WatchRoomState } from './roomProtocol';

export function roomPlaybackPosition(room: WatchRoomState, serverNow: number) {
    return room.playback.position + (room.playback.paused ? 0
        : Math.max(0, serverNow - room.playback.updatedAt) / 1000 * room.playback.rate);
}

/** Native events report readiness only. User commands originate in controls. */
export class PlaybackBridge {
    private room: WatchRoomState | null = null;
    private epoch = -1;
    private readyEpoch = -1;
    private bufferingEpoch = -1;
    private connected = false;
    private disposed = false;
    private lastPlayAttempt = 0;
    private metadataLoaded = false;
    private video: HTMLVideoElement;
    private send: (command: RoomCommandPayload) => Promise<void>;
    private serverNow: () => number;
    private onError: (message: string) => void;

    constructor(
        video: HTMLVideoElement,
        send: (command: RoomCommandPayload) => Promise<void>,
        serverNow: () => number,
        onError: (message: string) => void,
    ) { this.video = video; this.send = send; this.serverNow = serverNow; this.onError = onError; }

    update(room: WatchRoomState | null, connected: boolean) {
        this.room = room;
        this.connected = connected;
        if (!connected) { this.video.pause(); return; }
        this.synchronize();
    }

    loadedMetadata() { this.metadataLoaded = true; this.synchronize(); }

    synchronize() {
        const room = this.room;
        const video = this.video;
        if (this.disposed || !this.connected || !this.metadataLoaded || !room?.media || video.readyState < 1) return;
        const rawTarget = roomPlaybackPosition(room, this.serverNow());
        // Do not rewind an ended video into its final frames while the host
        // chooses the next episode. An explicit seek earlier still works.
        if (video.ended && rawTarget >= video.duration) { video.pause(); return; }
        const target = Number.isFinite(video.duration) ? Math.min(rawTarget, Math.max(0, video.duration - .05)) : rawTarget;
        const drift = target - video.currentTime;
        const changedEpoch = this.epoch !== room.syncEpoch;
        if (changedEpoch) {
            this.epoch = room.syncEpoch;
            this.readyEpoch = -1;
            this.bufferingEpoch = -1;
        }
        if (!video.seeking && (changedEpoch || Math.abs(drift) > .75) && Math.abs(drift) > .05) {
            video.currentTime = target;
        }
        video.playbackRate = room.playback.rate * (!room.playback.paused && Math.abs(drift) >= .25 && Math.abs(drift) <= .75
            ? (drift > 0 ? 1.05 : .95) : 1);
        if (room.playback.paused) video.pause();
        const buffered = this.hasBuffer(target);
        if (buffered && !video.seeking && Math.abs(video.currentTime - target) < .75 && this.readyEpoch !== room.syncEpoch) {
            this.readyEpoch = room.syncEpoch;
            this.bufferingEpoch = -1;
            this.dispatch({ type: 'ready', epoch: room.syncEpoch }, () => { this.readyEpoch = -1; });
        }
        if (!room.playback.paused && buffered && !video.seeking && video.paused && Date.now() - this.lastPlayAttempt > 1000) {
            this.lastPlayAttempt = Date.now();
            void video.play().catch(() => this.onError('Браузер заблокировал воспроизведение. Нажмите «Включить видео».'));
        }
    }

    buffering() {
        const room = this.room;
        if (this.disposed || !this.connected || !room?.media || this.bufferingEpoch === room.syncEpoch) return;
        this.readyEpoch = -1;
        this.bufferingEpoch = room.syncEpoch;
        this.dispatch({ type: 'buffering', epoch: room.syncEpoch }, () => { this.bufferingEpoch = -1; });
    }

    error(message: string) {
        if (this.room && this.connected && !this.disposed) this.dispatch({ type: 'load_error', epoch: this.room.syncEpoch, message: message.slice(0, 200) });
    }

    dispose() { this.disposed = true; this.video.pause(); }

    private hasBuffer(position: number) {
        if (this.video.readyState < 3) return false;
        for (let i = 0; i < this.video.buffered.length; i++) {
            if (this.video.buffered.start(i) <= position + .1 && this.video.buffered.end(i) >= Math.min(position + .5, this.video.duration)) return true;
        }
        return false;
    }

    private dispatch(command: RoomCommandPayload, retry?: () => void) {
        void this.send(command).catch(() => { if (!this.disposed) retry?.(); });
    }
}
