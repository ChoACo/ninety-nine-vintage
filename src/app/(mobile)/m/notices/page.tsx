import type { Metadata } from "next";

import { MemberAccountBoundary } from "@/components/features/account/MemberAccountBoundary";
import { MemberNoticeBoard } from "@/components/notices/MemberNoticeBoard";

export const metadata: Metadata = {
  title: "공지사항 · 이용 가이드 | NINETY-NINE VINTAGE",
  robots: { index: false, follow: false },
};

export default function MobileNoticesPage() {
  return (
    <MemberAccountBoundary basePath="/m" returnTo="/m/notices">
      <MemberNoticeBoard />
    </MemberAccountBoundary>
  );
}
