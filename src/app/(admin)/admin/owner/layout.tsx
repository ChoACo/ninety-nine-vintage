import { AdminWorkspaceShell } from "@/components/admin/AdminWorkspaceShell";
import { OwnerHeader } from "@/components/admin/owner/OwnerHeader";
import { StandaloneBackModal } from "@/components/layout/StandaloneBackModal";

const navigation = [
  { group: "플랫폼 총괄", exact: true, href: "/admin/owner", label: "Executive Dashboard", description: "GMV·수익·경매·보관 현황", icon: "dashboard" },
  { group: "판매센터 & 조직", href: "/admin/owner/stores", label: "판매센터", description: "센터 승인·수수료·운영자", icon: "products" },
  { group: "판매센터 & 조직", href: "/admin/owner/members", label: "사용자·RBAC", description: "회원·운영자·직원 권한", icon: "inquiries" },
  { group: "판매센터 & 조직", href: "/admin/owner/onboarding", label: "입점 상담", description: "신규 판매센터 입점 심사", icon: "inquiries" },
  { group: "통합 정산 & 금융", href: "/admin/owner/payments", label: "입금 확인", description: "수동 입금 승인", icon: "orders" },
  { group: "통합 정산 & 금융", href: "/admin/owner/settlements", label: "송금·정산", description: "월·목 지급 명세와 이월", icon: "orders" },
  { group: "통합 정산 & 금융", href: "/admin/owner/platform", label: "센터 요금제", description: "수수료·서비스 정책", icon: "settings" },
  { group: "통합 정산 & 금융", href: "/admin/owner/refunds", label: "환불·긴급", description: "환불과 예외 승인", icon: "shipping" },
  { group: "플랫폼 룰 & 콘텐츠", href: "/admin/owner/rules/auction", label: "경매 전역 룰", description: "일정·비상 제어실", icon: "auctions" },
  { group: "플랫폼 룰 & 콘텐츠", href: "/admin/owner/community", label: "콘텐츠·공지", description: "운영 안내와 전역 콘텐츠", icon: "inquiries" },
  { group: "보안 & 감사 로그", href: "/admin/owner/site-status", label: "시스템 상태", description: "인프라·연동·보안", icon: "settings" },
] as const;
// Legacy navigation contract: label: "운영 현황" · label: "매장·직원" · label: "회원" · label: "입점 상담" · label: "공지·소통" · label: "정산" · label: "시스템".

export default function OwnerLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <AdminWorkspaceShell
      contentHeader={<StandaloneBackModal />}
      description="매장 운영과 결제·환불·권한·시스템 정책을 관리합니다."
      eyebrow="Site administration"
      navigation={navigation}
      contextBar={<OwnerHeader />}
      title="사이트 관리"
      workspaceMode="owner"
    >
      {children}
    </AdminWorkspaceShell>
  );
}
