import { Fragment, useId, useMemo, useState, type ReactNode } from 'react';
import { FeedLink as Link } from '../shared/feedNavigation';
import RemoteImage from './RemoteImage';
import { feedId, feedUrl, type FeedArticle, type FeedBlock, type FeedChannel } from '../shared/feed';
import { useTranslation } from '../shared/useTranslation';
import styles from './FeedContent.module.css';
import { FeedVote, FeedPostActions } from './FeedActions';
import { FeedIcon } from './FeedIcons';
import ImageLightbox from './ImageLightbox';

function Spoiler({ children }: { children: ReactNode }) {
    const [open, setOpen] = useState(false);
    const id = useId();
    const { t } = useTranslation();
    return <span className={styles.spoiler}><button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(value => !value)}>{t(open ? 'feed.hideSpoiler' : 'feed.spoiler')}</button><span id={id} hidden={!open}>{children}</span></span>;
}

/** Convert the editor's inline HTML into an allowlisted React tree, never raw HTML. */
export function FeedRichText({ html }: { html: string }) {
    return useMemo(() => {
        const template = document.createElement('template');
        template.innerHTML = html.slice(0, 200000);
        let count = 0;
        const render = (node: Node, key: string, depth: number): ReactNode => {
            if (++count > 3000 || depth > 20) return null;
            if (node.nodeType === Node.TEXT_NODE) {
                const value = node.textContent ?? '';
                if (node.parentElement?.closest('a')) return value;
                return value.split(/(#[\p{L}\p{N}_]+)/gu).map((part, index) => part.startsWith('#') && part.length > 1 && ++count <= 3000 ? <Link key={`${key}-tag-${index}`} to={`/feed?q=${encodeURIComponent(part)}`}>{part}</Link> : part);
            }
            if (!(node instanceof HTMLElement)) return null;
            const tag = node.tagName.toLowerCase();
            if (['script', 'style', 'iframe', 'object', 'embed', 'svg', 'math', 'img', 'form', 'input'].includes(tag)) return null;
            const children = Array.from(node.childNodes).map((child, index) => render(child, `${key}-${index}`, depth + 1));
            if (node.classList.contains('spoiler')) return <Spoiler key={key}>{children}</Spoiler>;
            if (tag === 'br') return <br key={key} />;
            if (tag === 'a') {
                const href = feedUrl(node.getAttribute('href'));
                if (href) return <a key={key} href={href} target="_blank" rel="noopener noreferrer">{children}</a>;
            }
            if (tag === 'b' || tag === 'strong') return <strong key={key}>{children}</strong>;
            if (tag === 'i' || tag === 'em') return <em key={key}>{children}</em>;
            if (tag === 's' || tag === 'del') return <s key={key}>{children}</s>;
            if (tag === 'u') return <u key={key}>{children}</u>;
            if (tag === 'code') return <code key={key}>{children}</code>;
            return <Fragment key={key}>{children}</Fragment>;
        };
        return <>{Array.from(template.content.childNodes).map((node, index) => render(node, String(index), 0))}</>;
    }, [html]);
}

function FeedImage({ src, images = [src] }: { src: string; images?: string[] }) {
    const [failed, setFailed] = useState(false);
    const [attempt, setAttempt] = useState(0);
    const [open, setOpen] = useState(false);
    const { t } = useTranslation();
    if (failed) return <div className={styles.mediaError} role="status"><p>{t('feed.mediaError')}</p><button type="button" onClick={() => { setFailed(false); setAttempt(value => value + 1); }}>{t('feed.retryImage')}</button></div>;
    return <><button type="button" className={styles.mediaTrigger} aria-label={t('imageViewer.open')} onClick={() => setOpen(true)}><RemoteImage key={attempt} src={src} alt={t('feed.image')} loading="lazy" className={styles.image} onStateChange={state => { if (state === 'error') setFailed(true); }} onError={() => setFailed(true)} /></button>
        {open && <ImageLightbox images={images.map(url => ({ src: url, alt: t('feed.image') }))} initialIndex={Math.max(0, images.indexOf(src))} onClose={() => setOpen(false)} />}</>;
}

function Text({ value }: { value: unknown }) { return typeof value === 'string' ? <FeedRichText html={value} /> : null; }
function ListItems({ items, depth = 0 }: { items: unknown[]; depth?: number }) {
    if (depth > 6) return null;
    return <>{items.slice(0, 200).map((item, index) => {
        const value = typeof item === 'string' ? { content: item } : item && typeof item === 'object' ? item as Record<string, unknown> : {};
        return <li key={index}><Text value={value.content} />{Array.isArray(value.items) && <ul><ListItems items={value.items} depth={depth + 1} /></ul>}</li>;
    })}</>;
}

function Block({ block }: { block: FeedBlock }) {
    const { t } = useTranslation();
    const data = block.data;
    if (!data || typeof data !== 'object') return null;
    switch (block.type ?? block.name) {
        case 'header': return <h3><Text value={data.text} /></h3>;
        case 'paragraph': return <p><Text value={data.text} /></p>;
        case 'quote': return <blockquote><Text value={data.text} />{typeof data.caption === 'string' && <cite><Text value={data.caption} /></cite>}</blockquote>;
        case 'list': return data.style === 'ordered' ? <ol><ListItems items={Array.isArray(data.items) ? data.items : []} /></ol> : <ul><ListItems items={Array.isArray(data.items) ? data.items : []} /></ul>;
        case 'code': return typeof data.code === 'string' ? <pre>{data.code}</pre> : null;
        case 'delimiter': return <hr />;
        case 'media': {
            const sources = (Array.isArray(data.items) ? data.items : []).slice(0, 50).map(item => feedUrl(item && typeof item === 'object' ? (item as Record<string, unknown>).url : undefined)).filter((src): src is string => Boolean(src));
            const images = sources.filter(src => !/\.(mp4|webm)(?:\?|$)/i.test(src));
            return <div className={styles.media}>{sources.map((src, index) => {
            return /\.(mp4|webm)(?:\?|$)/i.test(src) ? <video key={src} src={src} controls preload="none" aria-label={t('feed.image')} /> : <FeedImage key={`${src}-${index}`} src={src} images={images} />;
        })}</div>;
        }
        case 'embed': {
            const href = feedUrl(data.url);
            if (!href) return null;
            const image = feedUrl(data.image);
            return <div className={styles.embed}>{image && <FeedImage src={image} />}<a href={href} target="_blank" rel="noopener noreferrer">{typeof data.title === 'string' ? data.title : t('feed.external')}</a></div>;
        }
        default: return typeof data.text === 'string' ? <p><Text value={data.text} /></p> : null;
    }
}

export function FeedArticleBody({ article, preview = false, ancestors = [] }: { article: FeedArticle; preview?: boolean; ancestors?: number[] }) {
    const { t } = useTranslation();
    if (article.is_deleted) return <p>{t('feed.deleted')}</p>;
    const blocks = Array.isArray(article.payload?.blocks) ? article.payload.blocks : [];
    const original = article.repost_article;
    const showOriginal = original && feedId(original.id) && original.id !== article.id && !ancestors.includes(original.id);
    return <div className={styles.body}>{blocks.slice(0, preview ? 3 : 200).map((block, index) => block && typeof block === 'object' ? <Block key={block.id ?? index} block={block} /> : null)}
        {showOriginal && <section className={styles.repost} aria-label={t('feed.originalPost')}>
            <header className={styles.repostHeading}>
                <FeedIcon name="repost" size={17} />
                {original.channel && feedId(original.channel.id) ? <Link className={styles.identity} to={`/feed/channel/${original.channel.id}`}>
                    <RemoteImage src={feedUrl(original.channel.avatar)} className={styles.avatar} alt="" loading="lazy" />
                    <span>{original.channel.title}</span>
                </Link> : <Link to={`/feed/post/${original.id}`}>{t('feed.originalPost')}</Link>}
            </header>
            {ancestors.length < 2 && <FeedArticleBody article={original} preview={preview} ancestors={[...ancestors, article.id]} />}
            <Link className={styles.repostOpen} to={`/feed/post/${original.id}`}>{t('feed.originalPost')}</Link>
        </section>}
    </div>;
}

export function FeedArticleCard({ article, detail = false }: { article: FeedArticle; detail?: boolean }) {
    const { t, formatDate, formatNumber } = useTranslation();
    return <article className={`${styles.post} ${detail ? '' : styles.preview}`}>
        <header className={styles.postHeader}>
            <Link to={`/feed/channel/${article.channel.id}`} className={styles.identity}>
                <RemoteImage src={feedUrl(article.channel.avatar)} className={styles.avatar} alt="" loading="lazy" />
                <span>{article.channel.title}</span>
            </Link>
            {article.is_pinned && <span className={styles.pinnedBadge}><FeedIcon name="pin" size={13} />{t('feed.pinned')}</span>}
            {typeof article.creation_date === 'number' && Number.isFinite(article.creation_date) && article.creation_date > 0 && article.creation_date < 8640000000000 && <time className={styles.meta} dateTime={new Date(article.creation_date * 1000).toISOString()}>{formatDate(article.creation_date * 1000, { dateStyle: 'medium', timeStyle: 'short' })}</time>}
        </header>
        <FeedArticleBody article={article} preview={!detail} />
        <footer className={styles.postFooter}>
            <Link className={styles.postStat} to={`/feed/post/${article.id}#comments`} aria-label={t('feed.comments', { count: article.comment_count ?? 0 })} title={t('feed.comments', { count: article.comment_count ?? 0 })}><FeedIcon name="comment" size={18} /><span>{formatNumber(article.comment_count ?? 0)}</span></Link>
            <FeedVote id={article.id} type="article" vote={article.vote} count={article.vote_count} />
            <span className={styles.postStat} role="img" aria-label={t('feed.reposts', { count: article.repost_count ?? 0 })} title={t('feed.reposts', { count: article.repost_count ?? 0 })}><FeedIcon name="repost" size={18} /><span aria-hidden="true">{formatNumber(article.repost_count ?? 0)}</span></span>
            {!detail && <Link className={styles.read} to={`/feed/post/${article.id}`}>{t('feed.read')}</Link>}
        </footer>
        {detail && <FeedPostActions article={article} />}
    </article>;
}

export function FeedChannelCard({ channel }: { channel: FeedChannel }) {
    const { t } = useTranslation();
    return <Link className={styles.channel} to={`/feed/channel/${channel.id}`}>
        <RemoteImage src={feedUrl(channel.avatar)} className={styles.avatar} alt="" loading="lazy" />
        <span><strong>{channel.title}</strong><small>{t('feed.subscribers', { count: channel.subscriber_count ?? 0 })}</small></span>
    </Link>;
}
