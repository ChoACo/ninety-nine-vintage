import { AdminWorkspaceShell } from "@/components/admin/AdminWorkspaceShell";
import { EmployeeOwnerScopeBridge } from "@/components/admin/employee/EmployeeOwnerScopeBridge";
import { StandaloneBackModal } from "@/components/layout/StandaloneBackModal";

const navigation = [
  { exact: true, href: "/admin/employee", label: "오늘의 작업", description: "우선 처리할 매장 업무" },
  { href: "/admin/employee/fulfillment", label: "상품 준비", description: "입출고와 보관" },
  { href: "/admin/employee/parcels", label: "포장·송장", description: "택배 요청과 발송" },
  { href: "/admin/employee/inquiries", label: "문의", description: "구매자 응대" },
  { href: "/admin/employee/community", label: "공지·소통", description: "운영 안내와 질문·답변" },
] as const;

export default function EmployeeLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      <EmployeeOwnerScopeBridge />
<AdminWorkspaceShell
        contentHeader={<StandaloneBackModal />}
        description="오늘 배정된 상품 준비·포장·문의 업무에 집중합니다."
        eyebrow="Staff workspace"
        navigation={navigation}
        title="직원센터"
      >
        {children}
      </AdminWorkspaceShell>
    </>
  );
}
