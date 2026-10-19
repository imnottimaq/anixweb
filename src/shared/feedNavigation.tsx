import type { MouseEvent } from 'react';
import { Link, useLocation, useNavigate, useResolvedPath, type LinkProps } from 'react-router-dom';
import { useTranslation } from './useTranslation';
import type { TranslationKey } from './i18n';
import { trailOf, internalFeedPath, feedChildState } from './feedNavigationState';
import styles from '../components/FeedContent.module.css';

function plainClick(event: MouseEvent<HTMLAnchorElement>, target?: string) {
    return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && (!target || target === '_self');
}

/** Native-like parent navigation while retaining normal links, new tabs, and browser history. */
export function FeedLink({ to, state, onClick, target, replace, ...props }: LinkProps) {
    const location = useLocation(), navigate = useNavigate(), resolved = useResolvedPath(to);
    return <Link {...props} to={to} target={target} replace={replace} state={state} onClick={event => {
        onClick?.(event);
        if (event.defaultPrevented || !plainClick(event, target) || !internalFeedPath(location.pathname) || !internalFeedPath(resolved.pathname)) return;
        event.preventDefault();
        const current = `${location.pathname}${location.search}${location.hash}`;
        const destination = `${resolved.pathname}${resolved.search}${resolved.hash}`;
        const samePage = location.pathname === resolved.pathname && location.search === resolved.search;
        navigate(to, { replace: replace || samePage, state: feedChildState(location, state, destination !== current && !samePage) });
    }} />;
}

export function FeedBack({ fallbackTo = '/feed', fallbackLabel = 'feed.back' }: { fallbackTo?: string; fallbackLabel?: TranslationKey }) {
    const location = useLocation(), navigate = useNavigate(), { t } = useTranslation();
    const trail = trailOf(location.state), parent = trail.at(-1);
    return <Link className={styles.back} to={parent?.to ?? fallbackTo} state={{ feedTrail: trail.slice(0, -1) }} onClick={event => {
        if (!plainClick(event) || !parent) return;
        const index: unknown = window.history.state?.idx;
        if (parent.index !== null && typeof index === 'number' && index === parent.index + 1) { event.preventDefault(); navigate(-1); }
    }}>{t(parent?.label ?? fallbackLabel)}</Link>;
}

