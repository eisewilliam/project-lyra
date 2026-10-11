import { createContext, useContext } from 'react';

export type RowIds = { labelId: string; hintId: string | undefined };

export const RowContext = createContext<RowIds | undefined>(undefined);

/**
 * Accessible-name wiring for the control inside a `Row`: spread onto the
 * focusable element so screen readers announce the row's visible label (and
 * hint) instead of an unnamed "switch" or "slider".
 */
export function useRowAria(): { 'aria-labelledby'?: string; 'aria-describedby'?: string } {
  const ids = useContext(RowContext);
  if (!ids) return {};
  return ids.hintId
    ? { 'aria-labelledby': ids.labelId, 'aria-describedby': ids.hintId }
    : { 'aria-labelledby': ids.labelId };
}
