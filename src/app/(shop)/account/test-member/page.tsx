import type { Metadata } from "next";
import { ProductionTestMemberLogin } from "@/components/features/account/ProductionTestMemberLogin";
import { safeTestMemberReturnTo } from "@/lib/productionTestMember";

export const metadata: Metadata = {
  title: "운영 검증 회원 로그인 | NINETY-NINE VINTAGE",
  robots: { index: false, follow: false, noarchive: true, nosnippet: true },
};

export default async function TestMemberLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const query = await searchParams;
  return (
    <div className="grid min-h-[65vh] place-items-center px-4">
      <ProductionTestMemberLogin returnTo={safeTestMemberReturnTo(query.next)} />
    </div>
  );
}
