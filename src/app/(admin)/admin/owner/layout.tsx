import { AdminWorkspaceShell } from "@/components/admin/AdminWorkspaceShell";

const navigation = [
  { exact: true, href: "/admin/owner", label: "운영 현황", description: "사이트 전체 상태와 우선 업무" },
  { href: "/admin/owner/payments", label: "입금 확인", description: "수동 입금 승인" },
  { href: "/admin/owner/refunds", label: "환불·긴급", description: "환불과 예외 승인" },
  { href: "/admin/owner/stores", label: "매장·직원", description: "매장과 업무 권한" },
  { href: "/admin/owner/members", label: "회원", description: "회원 상태와 권한" },
  { href: "/admin/owner/onboarding", label: "입점 상담", description: "판매 신청 문의" },
  { href: "/admin/owner/platform", label: "정산", description: "그룹·멤버십·정산" },
  { href: "/admin/owner/site-status", label: "시스템", description: "사이트·연동·운영 도구" },
] as const;

export default function OwnerLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <AdminWorkspaceShell
      description="매장 운영과 결제·환불·권한·시스템 정책을 관리합니다."
      eyebrow="Site administration"
      navigation={navigation}
      title="사이트 관리"
    >
      {children}
    </AdminWorkspaceShell>
  );
}
