declare module 'mux.js' {
    interface Segment {
        type: 'audio' | 'video' | 'combined';
        initSegment: Uint8Array;
        data: Uint8Array;
    }
    interface Transmuxer {
        on(type: 'data', callback: (segment: Segment) => void): void;
        push(data: Uint8Array): void;
        flush(): void;
        dispose(): void;
    }
    const mux: { mp4: { Transmuxer: new (options?: { remux?: boolean; keepOriginalTimestamps?: boolean }) => Transmuxer } };
    export default mux;
}
