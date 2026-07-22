import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AccountDashboard } from "@/components/features/account/AccountDashboard";
import { BidHistory } from "@/components/features/account/BidHistory";
import { OrderHistory } from "@/components/features/account/OrderHistory";

const sectionLabels = {
  addresses: "배송지",
  bids: "입찰 현황",
  orders: "주문 내역",
  refunds: "환불",
  saved: "찜 목록",
  shipping: "배송 현황",
  storage: "보관 상품",
} as const;

type AccountSection = keyof typeof sectionLabels;

export async function generateMetadata({ params }: { params: Promise<{ section: string }> }): Promise<Metadata> {
  const { section } = await params;
  return { title: section in sectionLabels ? sectionLabels[section as AccountSection] : "내 정보", robots: { follow: false, index: false } };
}

export default async function MobileAccountSectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  if (!(section in sectionLabels)) notFound();
  if (section === "orders") return <OrderHistory basePath="/m" />;
  if (section === "bids") return <BidHistory basePath="/m" />;
  return <div data-account-task={section}><div className="mb-6 border-b border-ink pb-4"><p className="eyebrow text-muted">내 정보 / {sectionLabels[section as AccountSection]}</p><h1 className="mt-3 text-3xl font-black tracking-[-.08em]">{sectionLabels[section as AccountSection]}</h1></div><AccountDashboard basePath="/m" /></div>;
}
