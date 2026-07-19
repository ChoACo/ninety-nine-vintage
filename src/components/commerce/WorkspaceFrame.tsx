import type { ReactNode } from "react";

export function WorkspaceFrame({
  eyebrow,
  title,
  description,
  actions,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <main className="mx-auto w-full max-w-[1760px] px-10 pb-24 pt-10">
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-10 border-b-2 border-[var(--text-strong)] pb-7">
        <div>
          <p className="nn-kicker">{eyebrow}</p>
          <h1 className="nn-page-title mt-4">{title}</h1>
          <p className="mt-5 max-w-2xl text-sm font-medium leading-6 text-[var(--text-muted)]">{description}</p>
        </div>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </header>
      <div className="mt-8">{children}</div>
    </main>
  );
}
