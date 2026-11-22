import { useEffect, useId, useState, type ReactNode } from 'react';
import { RowContext } from './row-context';

export function Row({
  label,
  hint,
  tooltip,
  disabled = false,
  children,
}: Readonly<{
  label: string;
  /** One line of secondary text under the label, like System Settings. */
  hint?: string | undefined;
  tooltip?: string;
  /** Dims the row and disables its control, e.g. an option that depends on
      another one being on. */
  disabled?: boolean;
  children: ReactNode;
}>) {
  const labelId = useId();
  const hintId = useId();
  const tooltipText = hint ? undefined : tooltip;
  const hasTooltip = Boolean(tooltipText);
  const [dismissed, setDismissed] = useState(false);
  const [placeAbove, setPlaceAbove] = useState(false);

  useEffect(() => {
    if (!hasTooltip) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDismissed(true);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [hasTooltip]);

  const revealTooltip = (row: HTMLDivElement) => {
    const paneBottom = row.closest('.pane-body')?.getBoundingClientRect().bottom ?? window.innerHeight;
    setPlaceAbove(paneBottom - row.getBoundingClientRect().bottom < 64);
    setDismissed(false);
  };

  return (
    <div
      className={`row${hint ? ' has-hint' : ''}${hasTooltip ? ' has-tooltip' : ''}${disabled ? ' is-disabled' : ''}`}
      data-tooltip-dismissed={hasTooltip && dismissed ? '' : undefined}
      onPointerEnter={hasTooltip ? (event) => revealTooltip(event.currentTarget) : undefined}
      onFocus={hasTooltip ? (event) => revealTooltip(event.currentTarget) : undefined}
    >
      <span className="row-label">
        <span id={labelId}>{label}</span>
        {hint && <span id={hintId} className="row-hint">{hint}</span>}
      </span>
      <span className="row-control">
        <RowContext.Provider value={{ labelId, hintId: hint || hasTooltip ? hintId : undefined, disabled }}>
          {children}
        </RowContext.Provider>
      </span>
      {tooltipText && (
        <span id={hintId} className="row-tooltip" role="tooltip" data-above={placeAbove ? '' : undefined}>
          {tooltipText}
        </span>
      )}
    </div>
  );
}
