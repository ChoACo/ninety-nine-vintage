import type { Metadata } from "next";
import { Suspense } from "react";
import { MemberAccountBoundary } from "@/components/features/account/MemberAccountBoundary";
import { MyDashboard } from "@/components/features/mypage/MyDashboard";
import { OrderTimelineSkeleton } from "@/components/skeletons/MySkeletons";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "주문·배송 | NINETY-NINE VINTAGE", robots: { index: false, follow: false } };

export default function MyOrdersPage() {
  return <MemberAccountBoundary returnTo="/my/orders"><Suspense fallback={<OrderTimelineSkeleton />}><MyDashboard initialTab="orders" /></Suspense></MemberAccountBoundary>;
}
