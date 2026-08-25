import { AdminWorkspaceShell } from "@/components/admin/AdminWorkspaceShell";
import OperatorInquiryBadge from "@/components/admin/operator/OperatorInquiryBadge";
import { OperatorContextBar } from "@/components/admin/operator/OperatorContextBar";
import { OperatorPendingBadge } from "@/components/admin/operator/OperatorPendingBadge";
import { OperatorStoreScopeSelector } from "@/components/admin/operator/OperatorStoreScopeSelector";
import { StandaloneBackModal } from "@/components/layout/StandaloneBackModal";

const navigation = [
  { group: "대시보드", exact: true, href: "/admin/operator", label: "오늘 할 일", description: "지금 처리할 판매 업무", icon: "dashboard" },
  { group: "경매 & 거래", href: "/admin/operator/auctions", label: "실시간 경매 운영", description: "입찰·마감 모니터", icon: "auctions" },
  { group: "상품 & 재고", exact: true, href: "/admin/operator/products", label: "상품 목록", description: "공개·비공개 상품 관리", icon: "products" },
  { group: "상품 & 재고", exact: true, href: "/admin/operator/products/new", label: "새 상품 등록", description: "사진·실측·판매 방식", icon: "register" },
  { group: "경매 & 거래", href: "/admin/operator/sales", label: "매출 분석", description: "KPI·차트·정산 원장", icon: "revenue" },
  { group: "경매 & 거래", href: "/admin/operator/orders", label: "판매·주문", description: "결제·배송·거래 상태", icon: "orders", badge: <OperatorPendingBadge kind="orders" /> },
  { group: "경매 & 거래", href: "/admin/operator/unpaid", label: "미결제 낙찰", description: "정산 미완료 경매", icon: "auctions" },
  { group: "보관함 & 출고", href: "/admin/operator/storage", label: "보관함", description: "회원별 보관·D-Day", icon: "vault" },
  { group: "보관함 & 출고", href: "/admin/operator/shipping", label: "보관함·출고 관리", description: "패킹·송장 일괄 처리", icon: "shipping", badge: <OperatorPendingBadge kind="shipping" /> },
  { group: "고객 소통 & 설정", href: "/admin/operator/inquiries", label: "문의", description: "고객 문의 분할 화면", icon: "inquiries", badge: <OperatorInquiryBadge /> },
  { group: "고객 소통 & 설정", href: "/admin/operator/community", label: "공지", description: "매장 한 줄 배너와 운영 안내", icon: "inquiries" },
  { group: "고객 소통 & 설정", href: "/admin/operator/platform", label: "매장 설정", description: "등급·계좌·운영 정보", icon: "settings" },
] as const;
// Legacy labels are retained only in source history for migration checks: label: "오늘의 할 일" · label: "판매 중 상품" · label: "상품 등록" · label: "판매 내역" · 출고·보관부터 송장까지.

export default function OperatorLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <AdminWorkspaceShell
      contentHeader={<StandaloneBackModal />}
      description="상품 등록부터 배송과 정산까지 한 매장의 판매 업무를 처리합니다."
      eyebrow="운영자 업무 공간"
      navigation={navigation}
      contextBar={<OperatorContextBar />}
      operatorMode
      title="판매센터"
      utility={<OperatorStoreScopeSelector />}
    >
      {children}
    </AdminWorkspaceShell>
  );
}
