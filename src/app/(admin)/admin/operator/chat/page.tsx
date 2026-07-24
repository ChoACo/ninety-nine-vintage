import { Suspense } from "react";
import { OperatorChatConsole } from "@/components/admin/operator/OperatorChatConsole";

export default function OperatorChatPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-[620px] animate-pulse border border-line bg-surface" />
      }
    >
      <OperatorChatConsole />
    </Suspense>
  );
}
