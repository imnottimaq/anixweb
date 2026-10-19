import type { ReactionEmoji } from '../shared/roomProtocol';

export const REACTION_KEYS: readonly ReactionEmoji[] = [
    'heart',
    'laugh',
    'clap',
    'fire',
    'surprise',
    'sad',
] as const;

export const REACTION_MAP: Record<ReactionEmoji, string> = {
    heart: '❤️',
    laugh: '😂',
    clap: '👏',
    fire: '🔥',
    surprise: '😮',
    sad: '😢',
};
