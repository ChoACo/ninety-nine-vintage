import { AdminWorkspaceShell } from "@/components/admin/AdminWorkspaceShell";
import { OperatorStoreScopeSelector } from "@/components/admin/operator/OperatorStoreScopeSelector";
import { StandaloneBackModal } from "@/components/layout/StandaloneBackModal";

const navigation = [
  { group: "오늘 할 일", exact: true, href: "/admin/operator", label: "오늘 할 일", description: "지금 처리할 판매 업무" },
  { group: "내 상품 관리", exact: true, href: "/admin/operator/products", label: "판매 중 상품", description: "현재 공개된 상품" },
  { group: "내 상품 관리", href: "/admin/operator/products/registration", label: "상품 등록", description: "간편 등록과 엑셀 등록" },
  { group: "판매 내역", href: "/admin/operator/sales", label: "판매 내역", description: "결제·배송·거래 상태" },
  { group: "매장 설정", href: "/admin/operator/platform", label: "매장 설정", description: "등급·계좌·운영 정보" },
  { group: "공지", href: "/admin/operator/community", label: "공지", description: "운영 안내와 질문·답변" },
] as const;
// Legacy labels are retained only in source history for migration checks: label: "오늘의 할 일" · 출고·보관부터 송장까지.

export default function OperatorLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <AdminWorkspaceShell
      contentHeader={<StandaloneBackModal />}
      description="상품 등록부터 배송과 정산까지 한 매장의 판매 업무를 처리합니다."
      eyebrow="Seller workspace"
      navigation={navigation}
      title="판매센터"
      utility={<OperatorStoreScopeSelector />}
    >
      {children}
    </AdminWorkspaceShell>
  );
}
