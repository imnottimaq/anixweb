import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { useRoomPresence } from '../shared/contexts/roomContext';
import { REACTION_TTL_MS, type RoomReaction } from '../shared/roomProtocol';
import { ReactionIcon } from './ReactionIcon';
import styles from './RoomSocial.module.css';

export type { RoomReaction };

export interface ReactionOverlayProps {
    reactions?: RoomReaction[];
    compact?: boolean;
}

// A cached clock snapshot lets React render consistently while expiry timers
// update the external store. It retains no expired IDs or per-event timers.
class ReactionClock {
    private time: number;
    constructor(time: number) { this.time = time; }
    getSnapshot = () => this.time;
    subscribe(source: RoomReaction[], serverNow: () => number, notify: () => void) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const update = () => {
            this.time = Math.max(this.time, serverNow());
            notify();
            const remaining = source
                .filter(reaction => reaction.createdAt <= this.time + REACTION_TTL_MS)
                .map(reaction => reaction.createdAt + REACTION_TTL_MS - this.time)
                .filter(delay => delay > 0);
            if (remaining.length) timer = setTimeout(update, Math.max(1, Math.min(REACTION_TTL_MS, ...remaining)));
        };
        update();
        return () => { if (timer !== undefined) clearTimeout(timer); };
    }
}

function getHorizontalPosition(id: string): number {
    let hash = 0;
    for (let i = 0; i < id.length; i++) {
        hash = ((hash << 5) - hash + id.charCodeAt(i)) | 0;
    }
    const normalized = Math.abs(hash) % 65;
    return 15 + normalized;
}

export default function ReactionOverlay({ reactions: propReactions, compact = false }: ReactionOverlayProps = {}) {
    const presence = useRoomPresence();
    const activeSource = propReactions ?? presence.reactions;

    const [clock] = useState(() => new ReactionClock(presence.serverNow()));
    const subscribeClock = useCallback((notify: () => void) =>
        clock.subscribe(activeSource, presence.serverNow, notify), [activeSource, clock, presence.serverNow]);
    const currentServerTime = useSyncExternalStore(subscribeClock, clock.getSnapshot, clock.getSnapshot);

    const [prefersReducedMotion, setPrefersReducedMotion] = useState(() => {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
        return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    });

    useEffect(() => {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
        const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
        const onChange = (e: MediaQueryListEvent) => setPrefersReducedMotion(e.matches);
        if (mql.addEventListener) {
            mql.addEventListener('change', onChange);
            return () => mql.removeEventListener('change', onChange);
        }
    }, []);

    const seen = new Set<string>();
    const renderedReactions = (activeSource ?? [])
        .filter(r => {
            if (seen.has(r.id)) return false;
            seen.add(r.id);
            const age = currentServerTime - r.createdAt;
            return age < REACTION_TTL_MS && age >= -REACTION_TTL_MS;
        })
        .slice(compact ? -1 : -25);

    return (
        <div
            className={`${styles.reactionOverlay} ${compact ? styles.compactOverlay : ''} ${prefersReducedMotion ? styles.reducedMotion : ''}`}
            data-testid="reaction-overlay"
            data-reduced-motion={prefersReducedMotion ? 'true' : 'false'}
            aria-hidden="true"
        >
            {renderedReactions.map(reaction => (
                <div
                    key={reaction.id}
                    className={`${styles.reactionBubble} ${prefersReducedMotion ? styles.reducedMotionItem : ''}`}
                    style={compact ? { left: 0, right: 0, marginInline: 'auto', width: 'max-content' } : { left: `${getHorizontalPosition(reaction.id)}%` }}
                    data-testid="reaction-bubble"
                >
                    <span className={styles.reactionEmoji}>
                        <ReactionIcon emoji={reaction.emoji} size={22} />
                    </span>
                    <span className={styles.reactionSender}>{reaction.login}</span>
                </div>
            ))}
        </div>
    );
}
