"use client";

import { ArrowLeft, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

export function ModalShell({ children, label }: Readonly<{ children: React.ReactNode; label: string }>) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") router.back();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      returnFocusRef.current?.focus();
    };
  }, [router]);

  return (
    <div className="fixed inset-0 z-[110] overflow-y-auto bg-black/60 backdrop-blur-md" role="presentation">
      <div className="flex min-h-full items-center justify-center p-0 [padding-bottom:env(safe-area-inset-bottom)] [padding-top:env(safe-area-inset-top)] md:p-6" onMouseDown={(event) => event.target === event.currentTarget && router.back()}>
        <div aria-label={label} aria-modal="true" className="min-h-screen w-full bg-paper text-ink shadow-2xl outline-none md:min-h-0 md:max-h-[calc(100vh-3rem)] md:max-w-3xl md:overflow-y-auto" ref={dialogRef} role="dialog" tabIndex={-1}>
          <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-line bg-paper/95 px-4 backdrop-blur-md md:px-6">
            <button className="inline-flex items-center gap-2 text-xs font-bold" onClick={() => router.back()} type="button"><ArrowLeft size={16} /> 뒤로 가기</button>
            <p className="truncate px-4 text-xs font-bold">{label}</p>
            <button aria-label={`${label} 닫기`} className="grid size-10 place-items-center" onClick={() => router.back()} type="button"><X size={18} /></button>
          </header>
          <div className="p-4 md:p-6">{children}</div>
        </div>
      </div>
    </div>
  );
}
