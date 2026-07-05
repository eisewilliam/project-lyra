import type { ReactNode } from 'react';

export function Group({ title, children }: Readonly<{ title: string; children: ReactNode }>) {
  return (
    <section className="group">
      <h2 className="group-title">{title}</h2>
      <div className="group-card">{children}</div>
    </section>
  );
}
