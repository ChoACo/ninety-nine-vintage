import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

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
export async function generateMetadata({ params }: { params: Promise<{ section: string }> }): Promise<Metadata> {
  const { section } = await params;
  return { title: section in sectionLabels ? sectionLabels[section as AccountSection] : "MY", robots: { follow: false, index: false } };
}

export default async function AccountSectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  if (section === "settings") redirect("/settings");
  if (!(section in sectionLabels)) notFound();
  redirect(`/account?task=${encodeURIComponent(section === "shipping-request" ? "storage" : section)}`);
}
