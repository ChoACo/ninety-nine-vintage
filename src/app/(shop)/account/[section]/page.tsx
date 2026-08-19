import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { AccountDashboard } from "@/components/features/account/AccountDashboard";
import { BidHistory } from "@/components/features/account/BidHistory";
import { MemberAccountBoundary } from "@/components/features/account/MemberAccountBoundary";
import { OrderHistory } from "@/components/features/account/OrderHistory";
import { AccountShippingNav } from "@/components/features/account/AccountShippingNav";

const sectionLabels = {
  addresses: "배송지",
  bids: "입찰 현황",
  orders: "주문 내역",
  payments: "결제하기",
  refunds: "환불",
  "shipping-request": "배송 신청",
  shipping: "배송 현황",
  storage: "보관 상품",
} as const;

type AccountSection = keyof typeof sectionLabels;
const dashboardViews = {
  addresses: "addresses",
  payments: "payments",
  refunds: "refunds",
  "shipping-request": "shipping-request",
  shipping: "shipping",
  storage: "storage",
} as const;

export async function generateMetadata({ params }: { params: Promise<{ section: string }> }): Promise<Metadata> {
  const { section } = await params;
  return { title: section in sectionLabels ? sectionLabels[section as AccountSection] : "MY", robots: { follow: false, index: false } };
}

export default async function AccountSectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  if (section === "settings") redirect("/settings");
  if (!(section in sectionLabels)) notFound();
  const returnTo = `/account/${section}`;
  if (section === "orders") return <MemberAccountBoundary returnTo={returnTo}><OrderHistory surface="desktop" /></MemberAccountBoundary>;
  if (section === "bids") return <MemberAccountBoundary returnTo={returnTo}><BidHistory surface="desktop" /></MemberAccountBoundary>;
  const view = dashboardViews[section as keyof typeof dashboardViews];
  return (
    <MemberAccountBoundary returnTo={returnTo}>
      <div data-account-task={section}>
        <header className="mb-8 border-b border-ink pb-5">
          <p className="eyebrow text-muted">MY / {sectionLabels[section as AccountSection]}</p>
          <h1 className="mt-3 text-4xl font-black tracking-[-.08em]">{sectionLabels[section as AccountSection]}</h1>
        </header>
        {["storage", "shipping-request", "shipping", "addresses"].includes(section) && <AccountShippingNav current={section} />}
        <AccountDashboard surface="desktop" view={view} />
      </div>
    </MemberAccountBoundary>
  );
}
