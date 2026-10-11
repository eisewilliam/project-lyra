import { useId, type ReactNode } from 'react';
import { RowContext } from './row-context';

export function Row({
  label,
  hint,
  children,
}: Readonly<{
  label: string;
  /** One line of secondary text under the label, like System Settings. */
  hint?: string;
  children: ReactNode;
}>) {
  const labelId = useId();
  const hintId = useId();
  return (
    <div className="row flex min-h-14 items-center justify-between box-border px-4 py-1.5 text-[13.5px]">
      <span className="row-label flex flex-1 flex-col gap-0.5">
        <span id={labelId}>{label}</span>
        {hint && <span id={hintId} className="row-hint">{hint}</span>}
      </span>
      <span className="row-control flex items-center gap-3">
        <RowContext.Provider value={{ labelId, hintId: hint ? hintId : undefined }}>
          {children}
        </RowContext.Provider>
      </span>
    </div>
  );
}
