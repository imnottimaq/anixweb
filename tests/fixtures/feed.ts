import type { FeedArticle, FeedChannel, FeedComment } from '../../src/shared/feed';

export const feedChannel: FeedChannel = { id: 7, title: 'Anime journal', description: 'News, artwork and episode discussions.', avatar: 'https://images.example.com/feed-avatar.jpg', subscriber_count: 120, is_blog: false };
export const feedArticle: FeedArticle = {
    id: 41, channel: feedChannel, creation_date: 1792100000, comment_count: 1, vote_count: 12, repost_count: 2,
    payload: { blocks: [
        { id: 'heading', type: 'header', data: { text: 'A new season begins', level: 2 } },
        { id: 'text', type: 'paragraph', data: { text: 'Discover the <strong>new releases</strong> and share your impressions.' } },
        { id: 'image', type: 'media', data: { items: [{ url: 'https://images.example.com/feed-art.jpg', width: 640, height: 360 }] } },
        { id: 'full', type: 'paragraph', data: { text: 'The full article continues here, beyond the feed preview.' } },
    ] },
};
export const feedComment: FeedComment = { id: 81, profile: { id: 19, login: 'Reader' }, message: 'Looking forward to the premiere.', timestamp: 1792100100, reply_count: 1, is_spoiler: false };
export function feedPage<T>(content: T[], total_count = content.length) { return { code: 0, content, total_count, total_page_count: 0, current_page: 0 }; }
