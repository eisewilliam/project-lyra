import type { CSSProperties } from 'react';
import type { LyricsPlaceholderState } from './lyrics-state';

/** Lyra's music-note icon (stroked, currentColor). */
export function MusicNoteIcon({
    className,
    style,
}: Readonly<{
    className?: string | undefined;
    style?: CSSProperties | undefined;
}>) {
    return (
        <svg className={className} style={style} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <path d="M9 18V5l12-2v13" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="6" cy="18" r="3" />
            <circle cx="18" cy="16" r="3" />
        </svg>
    );
}

export function LyricsPlaceholderIcon({
    state,
    className,
}: Readonly<{
    state: LyricsPlaceholderState;
    className?: string;
}>) {
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
                <path d="M9 18V5l12-2v13" strokeLinecap="round" strokeLinejoin="round" />
                <circle cx="6" cy="18" r="3" />
                <circle cx="18" cy="16" r="3" />
                <path d="m3 3 18 18" strokeLinecap="round" />
            </svg>
        );
    }

    if (state === 'idle' || state === 'consent') {
        return <MusicNoteIcon className={className} />;
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
