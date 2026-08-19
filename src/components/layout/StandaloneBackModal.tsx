"use client";

import { ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";

export function StandaloneBackModal({
  label = "뒤로 가기",
}: Readonly<{
  label?: string;
}>) {
  const router = useRouter();
  return (
    <div className="mb-6 mt-2 flex justify-end">
      <button
        aria-label={label}
        className="inline-flex items-center gap-2 rounded-full border border-line bg-paper px-4 py-2.5 text-xs font-bold text-ink shadow-card transition-all duration-300 hover:-translate-y-0.5 hover:bg-surface active:scale-95"
        onClick={() => router.back()}
        type="button"
      >
        <ArrowLeft size={16} />
        {label}
      </button>
    </div>
  );
}