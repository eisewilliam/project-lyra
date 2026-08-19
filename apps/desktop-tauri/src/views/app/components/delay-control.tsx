export function DelayControl({
  lyricOffsetMs,
  offsetLabel,
  onClose,
  onNudgeOffset,
  onResetOffset,
}: Readonly<{
  lyricOffsetMs: number;
  offsetLabel: string;
  onClose: () => void;
  onNudgeOffset: (deltaMs: number) => void;
  onResetOffset: () => void;
}>) {
  return (
    <div className="delay-control-inline">
      <div className="delay-control-meta">
        <span className="delay-control-title">Lyrics Delay</span>
        <span className="delay-control-value">{offsetLabel}</span>
      </div>
      <div className="delay-control-actions">
        <button
          type="button"
          className="delay-control-btn"
          onClick={() => onNudgeOffset(-100)}
          title="Lyrics earlier"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12" /></svg>
        </button>
        <button
          type="button"
          className="delay-control-btn"
          onClick={() => onNudgeOffset(100)}
          title="Lyrics later"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
        </button>
        <button
          type="button"
          className="delay-control-reset"
          onClick={onResetOffset}
          disabled={lyricOffsetMs === 0}
        >
          Reset
        </button>
        <button
          type="button"
          className="delay-control-close"
          onClick={onClose}
          title="Close"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
        </button>
      </div>
    </div>
  );
}
