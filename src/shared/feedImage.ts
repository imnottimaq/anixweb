export function feedCrop(width: number, height: number, aspect: number, zoom: number, x: number, y: number) {
    if (![width, height, aspect, zoom, x, y].every(Number.isFinite) || width <= 0 || height <= 0 || aspect <= 0 || zoom < 1 || zoom > 3 || x < 0 || x > 100 || y < 0 || y > 100) throw new Error('Invalid crop');
    const cropWidth = Math.min(width, height * aspect) / zoom;
    const cropHeight = cropWidth / aspect;
    return { width: cropWidth, height: cropHeight, x: (width - cropWidth) * x / 100, y: (height - cropHeight) * y / 100 };
}
export async function cropFeedImage(image: HTMLImageElement, aspect: number, zoom: number, x: number, y: number): Promise<File> {
    const crop = feedCrop(image.naturalWidth, image.naturalHeight, aspect, zoom, x, y);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(Math.min(2048, crop.width)));
    canvas.height = Math.max(1, Math.round(canvas.width / aspect));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Image editing unavailable');
    context.drawImage(image, crop.x, crop.y, crop.width, crop.height, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('Image encoding failed')), 'image/png'));
    return new File([blob], 'channel.png', { type: 'image/png' });
}
