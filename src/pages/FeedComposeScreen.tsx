import { FeedLink as Link } from '../shared/feedNavigation';
import { useLocation, useSearchParams } from 'react-router-dom';
import { PageHeader, PageLayout } from '../components/PageLayout';
import PageState from '../components/PageState';
import { FeedArticleBody } from '../components/FeedContent';
import { FeedActionError } from '../components/FeedActions';
import { useApi } from '../shared/apiClient';
import { useUser } from '../shared/contexts/userContext';
import { feedId, loadEditorChannels, loadFeedArticle, loadFeedChannel, loadFeedSuggestion, loadFeedPostingRestriction, saveFeedArticle, type FeedArticle, type FeedBlock, type FeedChannel } from '../shared/feed';
import { useAsyncLoad } from '../shared/useAsyncLoad';
import { useTranslation } from '../shared/useTranslation';
import styles from '../components/FeedContent.module.css';
import { resolveFeedEmbed, uploadFeedMedia, validateFeedImage } from '../shared/feedAdmin';
import { useFeedUpload } from '../shared/useFeedUpload';
import { FeedIcon } from '../components/FeedIcons';
import editorStyles from './FeedEditor.module.css';
import { FeedBack } from '../shared/feedNavigation';
import { useFeedPosition, useFeedSavedNavigation } from '../shared/useFeedNavigation';
import { useFeedDraftState } from '../shared/useFeedDraftState';
import FeedPostingGate from '../components/FeedPostingGate';
import { trailOf } from '../shared/feedNavigationState';

function plain(value: unknown) { const element = document.createElement('template'); element.innerHTML = typeof value === 'string' ? value.replace(/<br\s*\/?>/gi, '\n') : ''; return element.content.textContent ?? ''; }
function escaped(value: string) { return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>'); }

function Editor({ channels, article, channelId, repostId, suggestion }: { channels: FeedChannel[]; article?: FeedArticle; channelId?: number; repostId?: number; suggestion: boolean }) {
    const api = useApi();
    const navigate = useFeedSavedNavigation();
    const { t } = useTranslation();
    const [selected, setSelected] = useFeedDraftState('compose:channel', article?.channel.id ?? channelId ?? channels[0]?.id ?? 0);
    const [signed, setSigned] = useFeedDraftState('compose:signed', article?.is_signed ?? true);
    const [blocks, setBlocks] = useFeedDraftState<FeedBlock[]>('compose:blocks', () => article?.payload?.blocks ?? [{ id: crypto.randomUUID(), type: 'paragraph', data: { text: '' } }]);
    const [preview, setPreview] = useFeedDraftState('compose:preview', false);
    const action = useFeedUpload();
    const upload = useFeedUpload();
    const busy = action.pending || upload.pending;
    const update = (index: number, data: Record<string, unknown>) => setBlocks(values => values.map((block, i) => i === index ? { ...block, data: { ...block.data, ...data } } : block));
    const add = (type: string) => setBlocks(values => [...values, { id: crypto.randomUUID(), type, data: type === 'media' ? { items: [] } : type === 'list' ? { items: [''], style: 'unordered' } : type === 'embed' ? { url: '' } : { text: '', ...(type === 'header' && { level: 3 }) } }]);
    return <form className={`${styles.form} ${editorStyles.composeForm}`} onSubmit={event => { event.preventDefault(); if (busy) return;
        const content = blocks.filter(block => block.type === 'media' ? Array.isArray(block.data?.items) && block.data.items.length > 0 : block.type === 'embed' ? Boolean(block.data?.url) : block.type === 'header' || block.type === 'paragraph' || block.type === 'quote' ? Boolean(plain(block.data?.text).trim()) : true);
        void action.run(async signal => {
            const prepared = [];
            for (const block of content) {
                prepared.push(block.type === 'embed' && !block.data?.hash ? { ...block, data: await resolveFeedEmbed(api, selected, String(block.data?.url ?? ''), { suggestion, edit: Boolean(article) }, AbortSignal.any([signal, AbortSignal.timeout(20000)])) } : block);
            }
            return saveFeedArticle(api, selected, prepared, { editId: article?.id, repostId, signed, suggestion, signal });
        }, saved => navigate(suggestion ? `/feed/channel/${selected}` : `/feed/post/${saved.id}`));
    }}>
        <section className={editorStyles.composeSetup} aria-label={t('feed.channel')}>
        <label className={editorStyles.channelPicker}>{t('feed.channel')}<select required value={selected || ''} onChange={event => setSelected(Number(event.target.value))} disabled={Boolean(article) || busy}><option value="">{t('feed.choose')}</option>{channels.map(channel => <option key={channel.id} value={channel.id}>{channel.title}</option>)}</select></label>
        <div className={editorStyles.uploadArea}><label className={editorStyles.uploadLabel}><FeedIcon name="image" size={19} /><span>{t('feed.uploadImages')}</span><input type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple disabled={!selected || busy || blocks.length >= 50} onChange={event => {
            const files = Array.from(event.currentTarget.files ?? []); event.currentTarget.value = '';
            if (!files.length || busy) return;
            void upload.run(async signal => {
                if (files.length > 50 || blocks.length >= 50) throw new Error('Too many images');
                files.forEach(validateFeedImage);
                // Save each completed image immediately so a later failed upload does not lose it.
                const blockId = crypto.randomUUID();
                for (const file of files) {
                    const item = await uploadFeedMedia(api, selected, file, { suggestion, edit: Boolean(article) }, signal);
                    signal.throwIfAborted();
                    setBlocks(values => {
                        const existing = values.find(block => block.id === blockId);
                        if (!existing) return [...values, { id: blockId, type: 'media', data: { items: [item], item_count: 1 } }];
                        const items = [...(existing.data?.items as unknown[] ?? []), item];
                        return values.map(block => block.id === blockId ? { ...block, data: { items, item_count: items.length } } : block);
                    });
                }
            }, () => undefined);
        }} /></label>
        <p className={styles.meta}>{t('feed.imageRequirements')}</p></div>
        {upload.pending && <p role="status">{t('feed.uploading')}</p>}
        <FeedActionError error={upload.error} />
        {!channels.length && <p>{t('feed.noEditorChannels')} <Link to="/feed/studio">{t('feed.manage')}</Link></p>}
        {repostId && <p>{t('feed.repost')} <Link to={`/feed/post/${repostId}`}>#{repostId}</Link></p>}
        </section>
        <div className={editorStyles.writingColumn}>
        <div className={editorStyles.blocks}>
        {blocks.map((block, index) => <fieldset className={editorStyles.contentBlock} key={block.id ?? index} disabled={busy}>
            <legend>{t('feed.blockNumber', { count: index + 1 })}</legend>
            {(block.type === 'paragraph' || block.type === 'header' || block.type === 'quote') ? <label className={editorStyles.writingField}>{t(block.type === 'header' ? 'feed.heading' : block.type === 'quote' ? 'feed.quote' : 'feed.message')}<textarea className={block.type === 'paragraph' ? editorStyles.messageInput : undefined} maxLength={8000} value={plain(block.data?.text)} onChange={event => update(index, { text: escaped(event.target.value), text_length: event.target.value.length })} /></label>
                : block.type === 'list' && (!Array.isArray(block.data?.items) || block.data.items.every(item => typeof item === 'string')) ? <><label className={editorStyles.writingField}>{t('feed.listItems')}<textarea value={Array.isArray(block.data?.items) ? block.data.items.map(plain).join('\n') : ''} onChange={event => update(index, { items: event.target.value.split('\n').map(escaped) })} /></label><label><input type="checkbox" checked={block.data?.style === 'ordered'} onChange={event => update(index, { style: event.target.checked ? 'ordered' : 'unordered' })} />{t('feed.orderedList')}</label></>
                : block.type === 'media' ? <label className={editorStyles.writingField}>{t('feed.imageUrls')}<textarea value={Array.isArray(block.data?.items) ? block.data.items.map(item => item && typeof item === 'object' ? String((item as Record<string, unknown>).url ?? '') : '').join('\n') : ''} onChange={event => { const existing = Array.isArray(block.data?.items) ? block.data.items : []; const items = event.target.value.split('\n').slice(0, 50).map(url => existing.find(item => item && typeof item === 'object' && (item as Record<string, unknown>).url === url) ?? { id: crypto.randomUUID(), url }); update(index, { items, item_count: items.length }); }} /></label>
                    : block.type === 'embed' ? <label className={editorStyles.writingField}>{t('feed.link')}<input type="url" value={String(block.data?.url ?? '')} onChange={event => setBlocks(values => values.map((value, i) => i === index ? { ...value, data: { url: event.target.value } } : value))} /></label>
                        : <FeedArticleBody article={{ id: 1, channel: { id: 1, title: '' }, payload: { blocks: [block] } }} />}
            <div className={`${styles.actions} ${editorStyles.blockActions}`}><button className={styles.secondaryBtn} type="button" disabled={index === 0 || action.pending} onClick={() => setBlocks(values => { const next = [...values]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; return next; })}>{t('feed.moveUp')}</button><button className={styles.secondaryBtn} type="button" onClick={() => setBlocks(values => values.filter((_, i) => i !== index))}>{t('feed.removeBlock')}</button></div>
        </fieldset>)}
        </div>
        <div className={`${styles.actions} ${styles.blockToolbar} ${editorStyles.blockToolbar}`}>{(['paragraph', 'header', 'media', 'embed', 'quote', 'list', 'delimiter'] as const).map(type => <button type="button" key={type} disabled={blocks.length >= 50 || busy} onClick={() => add(type)}><FeedIcon name={type === 'media' ? 'image' : type === 'embed' ? 'link' : type === 'quote' ? 'quote' : type === 'list' ? 'list' : 'plus'} /><span>{t(`feed.add.${type}`)}</span></button>)}</div>
        <div className={editorStyles.publishBar}>{!suggestion && <label className={editorStyles.signedToggle}><input type="checkbox" checked={signed} onChange={event => setSigned(event.target.checked)} disabled={action.pending} />{t('feed.signed')}</label>}
        <div className={`${styles.actions} ${editorStyles.publishActions}`}><button className={styles.secondaryBtn} type="button" aria-pressed={preview} onClick={() => setPreview(value => !value)}>{t('feed.preview')}</button><button className={`${styles.primaryBtn} ${editorStyles.publishButton}`} disabled={!selected || busy || (!blocks.length && !repostId)}>{t(article ? 'feed.save' : suggestion ? 'feed.suggest' : 'feed.publish')}</button></div></div>
        <FeedActionError error={action.error} />
        {preview && <section className={styles.post} aria-label={t('feed.preview')}><FeedArticleBody article={{ id: article?.id ?? 1, channel: channels.find(channel => channel.id === selected) ?? { id: 1, title: '' }, payload: { blocks } }} /></section>}
        </div>
    </form>;
}

function Compose({ editId, channelId, repostId, suggestion }: { editId?: number; channelId?: number; repostId?: number; suggestion: boolean }) {
    const api = useApi();
    const location = useLocation();
    const navigate = useFeedSavedNavigation();
    const state = useAsyncLoad(async signal => {
        const [channels, article] = await Promise.all([suggestion && channelId ? loadFeedChannel(api, channelId, signal).then(channel => [channel]) : loadEditorChannels(api, signal), editId ? (suggestion ? loadFeedSuggestion(api, editId, signal) : loadFeedArticle(api, editId, signal)) : Promise.resolve(undefined)]);
        const restriction = !editId && !suggestion && !channels.length ? await loadFeedPostingRestriction(api, signal) : null;
        return { channels: article && !channels.some(channel => channel.id === article.channel.id) ? [...channels, article.channel] : channels, article, restriction };
    }, [api, editId, channelId, suggestion]);
    return state.isLoading ? <PageState status="loading" /> : state.error || !state.data ? <PageState status="error" onRetry={state.reload} /> : state.data.restriction ? <FeedPostingGate restriction={state.data.restriction} onClose={() => navigate(trailOf(location.state).at(-1)?.to ?? '/feed')} /> : <Editor channels={state.data.channels} article={state.data.article} channelId={channelId} repostId={repostId} suggestion={suggestion} />;
}

export default function FeedComposeScreen() {
    useFeedPosition();
    const { userToken } = useUser();
    const [params] = useSearchParams();
    const { t } = useTranslation();
    const editId = params.has('edit') ? feedId(params.get('edit')) : undefined;
    const channelId = params.has('channel') ? feedId(params.get('channel')) : undefined;
    const repostId = params.has('repost') ? feedId(params.get('repost')) : undefined;
    const suggestion = params.get('suggestion') === '1';
    const valid = editId !== null && channelId !== null && repostId !== null && !(editId && repostId) && (!suggestion || Boolean(channelId));
    return <PageLayout className={styles.page}><FeedBack /><PageHeader title={t(editId ? 'feed.edit' : 'feed.compose')} />
        {!valid ? <PageState status="error" message={t('feed.invalid')} /> : !userToken ? <><PageState status="empty" message={t('feed.signIn')} /><Link to="/account/login">{t('feed.login')}</Link></> : <Compose key={`${userToken}:${editId}:${channelId}:${repostId}:${suggestion}`} editId={editId} channelId={channelId} repostId={repostId} suggestion={suggestion} />}
    </PageLayout>;
}
