"use client";

import { Eye } from "lucide-react";
import { useEntryReadOnly } from "@/lib/entryMode";

export function ReadOnlyHomeNotice() {
  const readOnly = useEntryReadOnly();
  if (!readOnly) return null;
  return <div className="mb-6 flex items-start gap-3 border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900"><Eye className="mt-0.5 shrink-0" size={15} /><p><strong>읽기 전용 모드</strong><br />사이트 연결이 복구되면 구매·입찰 기능을 다시 사용할 수 있습니다.</p></div>;
}
