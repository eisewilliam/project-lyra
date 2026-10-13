import { useId, type ReactNode } from 'react';
import { RowContext } from './row-context';

export function Row({
  label,
  hint,
  disabled = false,
  children,
}: Readonly<{
  label: string;
  /** One line of secondary text under the label, like System Settings. */
  hint?: string;
  /** Dims the row and disables its control, e.g. an option that depends on
      another one being on. */
  disabled?: boolean;
  children: ReactNode;
}>) {
  const labelId = useId();
  const hintId = useId();
  return (
    <div className={`row${hint ? ' has-hint' : ''}${disabled ? ' is-disabled' : ''}`}>
      <span className="row-label">
        <span id={labelId}>{label}</span>
        {hint && <span id={hintId} className="row-hint">{hint}</span>}
      </span>
      <span className="row-control">
        <RowContext.Provider value={{ labelId, hintId: hint ? hintId : undefined, disabled }}>
          {children}
        </RowContext.Provider>
      </span>
    </div>
  );
}
