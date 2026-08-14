import { OwnerSiteStatusPanel } from "@/components/admin/owner/OwnerSiteStatusPanel";
import { StorageUsageGauge } from "@/components/admin/owner/StorageUsageGauge";
import { TokenUsageGauge } from "@/components/admin/owner/TokenUsageGauge";

export const dynamic = "force-dynamic";

export default function OwnerSiteStatusPage() {
  return (
    <div className="space-y-8">
      <header className="border-b border-ink pb-6">
        <p className="eyebrow text-muted">관리자 / 시스템</p>
        <h1 className="mt-3 text-3xl font-black tracking-[-.07em] sm:text-4xl">시스템</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-muted">사이트 운영 상태와 데이터 저장공간, 서비스 사용량을 운영 현황과 분리해 관리합니다.</p>
      </header>
      <OwnerSiteStatusPanel />
      <div className="grid gap-4 md:grid-cols-2">
        <TokenUsageGauge />
        <StorageUsageGauge />
      </div>
    </div>
  );
}
