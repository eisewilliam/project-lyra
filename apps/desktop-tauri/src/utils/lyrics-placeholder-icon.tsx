import type { LyricsPlaceholderState } from './lyrics-state';

export function LyricsPlaceholderIcon({
    state,
    className,
}: {
    state: LyricsPlaceholderState;
    className?: string;
}) {
    if (state === 'error') {
        return (
            <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                <path d="M12 3.5L21 19H3L12 3.5Z" />
                <path d="M12 9V13" strokeLinecap="round" />
                <circle cx="12" cy="16.5" r="1" fill="currentColor" stroke="none" />
            </svg>
        );
    }

    if (state === 'empty') {
        return (
            <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                <path d="M14 5v9.2a3.5 3.5 0 1 1-1.8-3.07L12.2 8.5l6.3-1.7v5.9a3.5 3.5 0 1 1-1.8-3.07V5.8L14 6.5" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M5 5l14 14" strokeLinecap="round" />
            </svg>
        );
    }

    if (state === 'idle') {
        return (
            <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                <path d="M14 5v9.2a3.5 3.5 0 1 1-1.8-3.07L12.2 8.5l6.3-1.7v5.9a3.5 3.5 0 1 1-1.8-3.07V5.8L14 6.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
        );
    }

    return (
        <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <path d="M5 16V9" strokeLinecap="round" />
            <path d="M10 19V5" strokeLinecap="round" />
            <path d="M15 14V7" strokeLinecap="round" />
            <path d="M20 17v-4" strokeLinecap="round" />
        </svg>
    );
}