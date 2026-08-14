type WebGpuNavigator = Navigator & {
    gpu?: { requestAdapter: () => Promise<unknown | null> };
};

export function isSafariBrowser() {
    return /Safari\//i.test(navigator.userAgent)
        && !/(Chrome|Chromium|CriOS|FxiOS|EdgiOS|OPiOS|Android)/i.test(navigator.userAgent);
}

// Firefox/Zen exposes WebGPU, but currently cannot pass an HTMLVideoElement
// to GPUQueue.copyExternalImageToTexture — the API Anime4K-WebGPU relies on.
export function canUseAnime4KVideo() {
    return !/Firefox\//i.test(navigator.userAgent) && Boolean((navigator as WebGpuNavigator).gpu);
}

export async function checkAnime4KVideoSupport() {
    const gpu = (navigator as WebGpuNavigator).gpu;
    if (!canUseAnime4KVideo() || !gpu) return false;

    try {
        return Boolean(await gpu.requestAdapter());
    } catch {
        return false;
    }
}
