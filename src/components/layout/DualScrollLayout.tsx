import type { ReactNode } from "react";

interface DualScrollLayoutProps {
  children: ReactNode;
  sidebar: ReactNode;
  sidebarLabel: string;
}

export function DualScrollLayout({
  children,
  sidebar,
  sidebarLabel,
}: Readonly<DualScrollLayoutProps>) {
  return (
    <div
      className="grid min-w-0 items-start gap-8 md:h-[calc(100dvh-var(--desktop-page-chrome,11.25rem))] md:min-h-[32rem] md:grid-cols-[18rem_minmax(0,1fr)] md:overflow-hidden"
      data-dual-scroll-layout
    >
      <aside
        aria-label={sidebarLabel}
        className="sticky top-0 hidden h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-line bg-card md:flex"
      >
        <div
          className="independent-scroll no-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain px-4"
          data-independent-scroll-sidebar
        >
          {sidebar}
        </div>
      </aside>
      <div
        className="independent-scroll no-scrollbar min-w-0 md:h-full md:min-h-0 md:overflow-y-auto md:overscroll-contain md:pr-2"
        data-independent-scroll-main
      >
        {children}
      </div>
    </div>
  );
}
