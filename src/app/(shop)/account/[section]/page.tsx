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

export default async function AccountSectionPage({ params, searchParams }: { params: Promise<{ section: string }>; searchParams: Promise<{ productId?: string | string[] }> }) {
  const { section } = await params;
  if (section === "settings") redirect("/settings");
  if (!(section in sectionLabels)) notFound();
  if (section === "payments") {
    const productId = (await searchParams).productId;
    redirect(typeof productId === "string" ? `/checkout?type=auction&id=${encodeURIComponent(productId)}` : "/checkout?type=auction");
  }
  if (section === "orders" || section === "shipping") redirect("/my/orders");
  if (section === "storage" || section === "shipping-request") redirect("/my/vault");
  redirect(section === "bids" ? "/my?tab=auction" : "/my");
}
