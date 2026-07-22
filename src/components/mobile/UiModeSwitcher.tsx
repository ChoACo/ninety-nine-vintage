"use client";

import { Monitor, Smartphone } from "lucide-react";
import { usePathname } from "next/navigation";
import { useState } from "react";
import type { UiMode } from "@/lib/uiMode";

interface UiModeSwitcherProps {
  className?: string;
  targetMode: Exclude<UiMode, "auto">;
}

export function UiModeSwitcher({ className = "", targetMode }: UiModeSwitcherProps) {
  const pathname = usePathname();
  const [busy, setBusy] = useState(false);
  const Icon = targetMode === "desktop" ? Monitor : Smartphone;
  const label = targetMode === "desktop" ? "PC 화면으로 보기" : "모바일 화면으로 보기";

  const switchMode = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const returnTo = `${pathname}${window.location.search}${window.location.hash}`;
      const response = await fetch("/api/ui-mode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: targetMode, returnTo }),
      });
      const payload = (await response.json().catch(() => null)) as { redirectTo?: string } | null;
      if (!response.ok || !payload?.redirectTo) throw new Error("화면 모드를 바꾸지 못했습니다.");
      window.location.assign(payload.redirectTo);
    } catch {
      setBusy(false);
    }
  };

  return (
    <button className={`inline-flex min-h-11 items-center justify-center gap-2 border border-line px-4 text-xs font-bold disabled:opacity-50 ${className}`} disabled={busy} onClick={() => void switchMode()} type="button">
      <Icon size={16} /> {busy ? "화면 전환 중" : label}
    </button>
  );
}
