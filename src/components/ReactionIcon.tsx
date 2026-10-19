import type { ReactionEmoji } from '../shared/roomProtocol';
import { REACTION_MAP } from './roomSocialConstants';

interface ReactionIconProps {
    emoji: ReactionEmoji;
    size?: number | string;
    className?: string;
    'aria-hidden'?: boolean | 'true' | 'false';
}

export function ReactionIcon({ emoji, size = 20, className, 'aria-hidden': ariaHidden = true }: ReactionIconProps) {
    return <span data-reaction={emoji} className={className} aria-hidden={ariaHidden} style={{ fontSize: size, lineHeight: 1 }}>
        {REACTION_MAP[emoji]}
    </span>;
}
