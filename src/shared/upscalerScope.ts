type FrameRegistry = {
    request: HTMLVideoElement['requestVideoFrameCallback'];
    cancel: HTMLVideoElement['cancelVideoFrameCallback'];
    pending: Promise<void>;
};
const registries = new WeakMap<HTMLVideoElement, FrameRegistry>();

// Anime4K has no disposal API. Serialize its asynchronous initialization per
// video, keeping the cancelled callback wrapper installed until initialization
// settles. Use the real video: WebGPU requires an HTMLVideoElement, not a Proxy.
export function createUpscalerScope(video: HTMLVideoElement) {
    let registry = registries.get(video);
    if (!registry) {
        registry = {
            request: video.requestVideoFrameCallback.bind(video),
            cancel: video.cancelVideoFrameCallback.bind(video),
            pending: Promise.resolve(),
        };
        registries.set(video, registry);
    }
    const frameRegistry = registry;
    let disposed = false;
    let initializing = false;
    let device: GPUDevice | undefined;
    const frames = new Set<number>();
    const requestFrame: HTMLVideoElement['requestVideoFrameCallback'] = callback => {
        if (disposed) return 0;
        const id = frameRegistry.request((now, metadata) => {
            frames.delete(id);
            if (!disposed) callback(now, metadata);
        });
        frames.add(id);
        return id;
    };
    const restore = () => {
        if (video.requestVideoFrameCallback === requestFrame) video.requestVideoFrameCallback = frameRegistry.request;
    };
    return {
        initialize(render: () => Promise<void>) {
            const task = frameRegistry.pending.then(async () => {
                if (disposed) return;
                initializing = true;
                video.requestVideoFrameCallback = requestFrame;
                try {
                    await render();
                } finally {
                    initializing = false;
                    if (disposed) restore();
                }
            });
            frameRegistry.pending = task.catch(() => {});
            return task;
        },
        useDevice(nextDevice: GPUDevice) {
            if (disposed) {
                nextDevice.destroy();
                throw new Error('Upscaler disposed');
            }
            device = nextDevice;
        },
        dispose() {
            if (disposed) return;
            disposed = true;
            frames.forEach(id => frameRegistry.cancel(id));
            frames.clear();
            device?.destroy();
            if (!initializing) restore();
        },
    };
}
