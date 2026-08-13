import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AccountDashboard } from "@/components/features/account/AccountDashboard";
import { BidHistory } from "@/components/features/account/BidHistory";
import { MemberAccountBoundary } from "@/components/features/account/MemberAccountBoundary";
import { OrderHistory } from "@/components/features/account/OrderHistory";
import { NicknameSettings } from "@/components/account/NicknameSettings";
import { SimpleModeToggle } from "@/components/features/accessibility/SimpleModeToggle";

const sectionLabels = {
  addresses: "배송지",
  bids: "입찰 현황",
  orders: "주문 내역",
  payments: "결제하기",
  refunds: "환불",
  settings: "계정·화면 설정",
  shipping: "배송 현황",
  storage: "보관 상품",
} as const;

type AccountSection = keyof typeof sectionLabels;
const dashboardViews = {
  addresses: "addresses",
  payments: "payments",
  refunds: "refunds",
  shipping: "shipping",
  storage: "storage",
} as const;

export async function generateMetadata({ params }: { params: Promise<{ section: string }> }): Promise<Metadata> {
  const { section } = await params;
  return { title: section in sectionLabels ? sectionLabels[section as AccountSection] : "MY", robots: { follow: false, index: false } };
}

export default async function AccountSectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  if (!(section in sectionLabels)) notFound();
  const returnTo = `/account/${section}`;
  if (section === "orders") return <MemberAccountBoundary returnTo={returnTo}><OrderHistory surface="desktop" /></MemberAccountBoundary>;
  if (section === "bids") return <MemberAccountBoundary returnTo={returnTo}><BidHistory surface="desktop" /></MemberAccountBoundary>;
  if (section === "settings") return (
    <MemberAccountBoundary returnTo={returnTo}>
      <div className="space-y-8">
        <header className="border-b border-ink pb-5"><p className="eyebrow text-muted">MY / 설정</p><h1 className="mt-3 text-4xl font-black tracking-[-.08em]">계정·화면 설정</h1></header>
        <div className="max-w-md"><SimpleModeToggle detailed /></div>
        <div className="max-w-md"><NicknameSettings /></div>
      </div>
    </MemberAccountBoundary>
  );
  const view = dashboardViews[section as keyof typeof dashboardViews];
  return (
    <MemberAccountBoundary returnTo={returnTo}>
      <div data-account-task={section}>
        <header className="mb-8 border-b border-ink pb-5">
          <p className="eyebrow text-muted">MY / {sectionLabels[section as AccountSection]}</p>
          <h1 className="mt-3 text-4xl font-black tracking-[-.08em]">{sectionLabels[section as AccountSection]}</h1>
        </header>
        <AccountDashboard surface="desktop" view={view} />
      </div>
    </MemberAccountBoundary>
  );
}
