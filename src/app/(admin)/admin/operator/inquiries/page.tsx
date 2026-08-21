import { Suspense } from "react";
import { OperatorChatConsole } from "@/components/admin/operator/OperatorChatConsole";

export default function OperatorInquiriesPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-[620px] animate-pulse border border-line bg-surface" />
      }
    >
      <OperatorChatConsole
        basePath="/admin/operator/inquiries"
        conversationType="product"
      />
    </Suspense>
  );
}