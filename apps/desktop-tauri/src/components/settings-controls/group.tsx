import type { ReactNode } from 'react';

export function Group({ title, children }: Readonly<{ title: string; children: ReactNode }>) {
  return (
    <section className="group flex flex-col gap-2">
      <h2 className="group-title m-0 ml-3">{title}</h2>
      <div className="group-card">{children}</div>
    </section>
  );
}
