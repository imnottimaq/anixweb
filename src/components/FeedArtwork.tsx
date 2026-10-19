import { useEffect, useRef, useState } from 'react';
import { Modal } from '../modals/ModalTemplate';
import { useApi } from '../shared/apiClient';
import { feedMutation, feedUrl, type FeedChannel } from '../shared/feed';
import { uploadFeedArtwork, validateFeedImage } from '../shared/feedAdmin';
import { cropFeedImage, feedCrop } from '../shared/feedImage';
import { useFeedUpload } from '../shared/useFeedUpload';
import { useTranslation } from '../shared/useTranslation';
import { FeedActionError } from './FeedActions';
import styles from './FeedContent.module.css';
import controls from './FeedControls.module.css';

function CropArtwork({ file, kind, channelId, onDone, onClose }: { file: File; kind: 'avatar' | 'cover'; channelId: number; onDone: (url: string) => void; onClose: () => void }) {
    const api = useApi(), upload = useFeedUpload();
    const { t } = useTranslation();
    const image = useRef<HTMLImageElement>(null);
    const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
    const [failed, setFailed] = useState(false);
    const [zoom, setZoom] = useState(1), [x, setX] = useState(50), [y, setY] = useState(50);
    const aspect = kind === 'avatar' ? 1 : 3;
    useEffect(() => { const next = URL.createObjectURL(file); if (image.current) image.current.src = next; return () => URL.revokeObjectURL(next); }, [file]);
    const crop = dimensions.width ? feedCrop(dimensions.width, dimensions.height, aspect, zoom, x, y) : null;
    return <Modal isOpen onClose={onClose} title={t('feed.cropImage')} size="medium"><div className={styles.form}>
        <div className={styles.cropPreview} style={{ aspectRatio: aspect }}><img ref={image} alt={t('feed.cropPreview')} onError={() => setFailed(true)} onLoad={event => setDimensions({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} style={crop ? { width: `${dimensions.width / crop.width * 100}%`, left: `${-crop.x / crop.width * 100}%`, top: `${-crop.y / crop.height * 100}%` } : undefined} /></div>
        <label>{t('feed.zoom')}<input type="range" min="1" max="3" step="0.01" value={zoom} onChange={event => setZoom(Number(event.target.value))} disabled={upload.pending} /></label>
        <label>{t('feed.horizontalPosition')}<input type="range" min="0" max="100" value={x} onChange={event => setX(Number(event.target.value))} disabled={upload.pending} /></label>
        <label>{t('feed.verticalPosition')}<input type="range" min="0" max="100" value={y} onChange={event => setY(Number(event.target.value))} disabled={upload.pending} /></label>
        <div className={`${styles.actions} ${controls.formActions}`}><button className={controls.primary} type="button" disabled={!crop || failed || upload.pending} onClick={() => void upload.run(async signal => {
            if (!image.current) throw new Error('Missing image');
            const cropped = await cropFeedImage(image.current, aspect, zoom, x, y);
            signal.throwIfAborted();
            return uploadFeedArtwork(api, channelId, kind, cropped, signal);
        }, onDone)}>{t(upload.pending ? 'feed.uploading' : 'feed.uploadCrop')}</button><button className={controls.secondary} type="button" disabled={upload.pending} onClick={onClose}>{t('feed.cancel')}</button></div>
        <FeedActionError error={upload.error || failed} />
    </div></Modal>;
}

export default function FeedArtwork({ channel }: { channel: FeedChannel }) {
    const api = useApi(), deletion = useFeedUpload();
    const { t } = useTranslation();
    const [avatar, setAvatar] = useState(channel.avatar), [cover, setCover] = useState(channel.cover);
    const [selection, setSelection] = useState<{ kind: 'avatar' | 'cover'; file: File } | null>(null);
    const [invalid, setInvalid] = useState(false), [confirm, setConfirm] = useState(false);
    return <section className={styles.form} aria-label={t('feed.artwork')}><h2>{t('feed.artwork')}</h2>
        <div className={controls.artworkGrid}>{(['avatar', 'cover'] as const).map(kind => <div key={kind} className={controls.artworkSlot}>
            {feedUrl(kind === 'avatar' ? avatar : cover) && <img className={kind === 'avatar' ? styles.artworkAvatar : styles.cover} src={feedUrl(kind === 'avatar' ? avatar : cover)!} alt={t(`feed.${kind}`)} />}
            <label>{t(`feed.${kind}`)}<input type="file" accept="image/jpeg,image/png,image/webp,image/gif" disabled={deletion.pending} onChange={event => {
                const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; setInvalid(false);
                if (file) { try { validateFeedImage(file); setSelection({ kind, file }); } catch { setInvalid(true); } }
            }} /></label>
        </div>)}</div>
        <p className={styles.meta}>{t('feed.imageRequirements')}</p>
        {cover && <div className={controls.artworkActions}><button className={controls.danger} type="button" disabled={deletion.pending} onClick={() => setConfirm(true)}>{t('feed.deleteCover')}</button></div>}
        <FeedActionError error={invalid || deletion.error} />
        {selection && <CropArtwork file={selection.file} kind={selection.kind} channelId={channel.id} onClose={() => setSelection(null)} onDone={url => { if (selection.kind === 'avatar') setAvatar(url); else setCover(url); setSelection(null); }} />}
        <Modal isOpen={confirm} onClose={() => { if (!deletion.pending) setConfirm(false); }} title={t('feed.deleteCover')} size="small"><p>{t('feed.deleteWarning')}</p><div className={controls.formActions}><button className={controls.danger} type="button" disabled={deletion.pending} onClick={() => void deletion.run(() => feedMutation(api, 'post', `/channel/cover/delete/${channel.id}`), () => { setCover(null); setConfirm(false); })}>{t('feed.delete')}</button><button className={controls.secondary} type="button" disabled={deletion.pending} onClick={() => setConfirm(false)}>{t('feed.cancel')}</button></div><FeedActionError error={deletion.error} /></Modal>
    </section>;
}
