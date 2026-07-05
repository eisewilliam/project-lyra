import type { ReactNode } from 'react';

export function Row({ label, children }: Readonly<{ label: string; children: ReactNode }>) {
  return (
    <div className="row">
      <span className="row-label">{label}</span>
      <span className="row-control">{children}</span>
    </div>
  );
}
