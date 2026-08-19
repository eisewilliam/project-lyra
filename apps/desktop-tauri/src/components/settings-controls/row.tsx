import type { ReactNode } from 'react';

export function Row({ label, children }: Readonly<{ label: string; children: ReactNode }>) {
  return (
    <div className="row flex min-h-14 items-center justify-between box-border px-4 py-1.5 text-[13.5px]">
      <span className="row-label flex-1">{label}</span>
      <span className="row-control flex items-center gap-3">{children}</span>
    </div>
  );
}
