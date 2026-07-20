import type { ReactNode } from "react";

type NoticeVariant = "neutral" | "success" | "warning" | "error";

const noticeClasses: Record<NoticeVariant, string> = {
  neutral: "border border-line bg-surface",
  success: "border border-emerald-200 bg-emerald-50 text-emerald-800",
  warning: "border border-amber-200 bg-amber-50 text-amber-900",
  error: "border border-red-200 bg-red-50 text-red-700",
};

export function StatusNotice({
  children,
  className = "",
  variant = "neutral",
}: Readonly<{
  children: ReactNode;
  className?: string;
  variant?: NoticeVariant;
}>) {
  return (
    <div
      aria-live="polite"
      className={`${noticeClasses[variant]} px-4 py-3 text-xs ${className}`.trim()}
      role={variant === "error" ? "alert" : "status"}
    >
      {children}
    </div>
  );
}
