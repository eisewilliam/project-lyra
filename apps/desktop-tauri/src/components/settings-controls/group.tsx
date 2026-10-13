import type { ReactNode } from 'react';

/** A titled run of rows. Flat: space and hairlines separate groups, not cards. */
export function Group({ title, children }: Readonly<{ title: string; children: ReactNode }>) {
  return (
    <section className="group">
      <h2 className="group-title m-0">{title}</h2>
      <div className="group-rows">{children}</div>
    </section>
  );
}
