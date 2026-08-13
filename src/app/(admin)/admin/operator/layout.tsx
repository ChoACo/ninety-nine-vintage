import { AdminWorkspaceShell } from "@/components/admin/AdminWorkspaceShell";
import { OperatorStoreScopeSelector } from "@/components/admin/operator/OperatorStoreScopeSelector";

const navigation = [
  { exact: true, href: "/admin/operator", label: "오늘의 할 일", description: "지금 처리할 판매 업무" },
  { exact: true, href: "/admin/operator/products", label: "상품 관리", description: "판매 중인 상품" },
  { href: "/admin/operator/products/registration", label: "상품 등록", description: "간편 등록과 엑셀 등록" },
  { href: "/admin/operator/winners", label: "주문·낙찰", description: "결제와 구매자 확인" },
  { href: "/admin/operator/fulfillment", label: "준비·배송", description: "출고·보관부터 송장까지", matchPrefixes: ["/admin/operator/storage", "/admin/operator/shipping", "/admin/operator/exceptions"] },
  { href: "/admin/operator/chat", label: "회원 채팅", description: "구매자 문의와 상담" },
  { href: "/admin/operator/revenue", label: "매출·정산", description: "판매 대금과 내역" },
  { href: "/admin/operator/platform", label: "매장 설정", description: "등급·계좌·운영 정보" },
] as const;

export default function OperatorLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <AdminWorkspaceShell
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
