import type { LyricsPlaceholderState, NotFoundReason } from './lyrics-state';

export function LyricsPlaceholderIcon({
    state,
    notFoundReason,
    className,
}: Readonly<{
    state: LyricsPlaceholderState;
    notFoundReason?: NotFoundReason | null | undefined;
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
        if (notFoundReason === 'Instrumental') {
            return (
                <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                    <path d="M3 18v-6a9 9 0 0 1 18 0v6" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
            );
        }
        if (notFoundReason === 'Classical') {
            return (
                <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                    <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5Z" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M6 6h10M6 10h10M6 14h10" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
            );
        }
        if (notFoundReason === 'Soundtrack') {
            return (
                <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                    <rect x="3" y="3" width="18" height="18" rx="2" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M9 3v18M15 3v18M3 9h6M3 15h6M15 9h6M15 15h6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
            );
        }
        return (
            <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                <path d="M9 18V5l12-2v13" strokeLinecap="round" strokeLinejoin="round" />
                <circle cx="6" cy="18" r="3" />
                <circle cx="18" cy="16" r="3" />
                <path d="m3 3 18 18" strokeLinecap="round" />
            </svg>
        );
    }

    if (state === 'idle') {
        return (
            <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                <path d="M9 18V5l12-2v13" strokeLinecap="round" strokeLinejoin="round" />
                <circle cx="6" cy="18" r="3" />
                <circle cx="18" cy="16" r="3" />
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
