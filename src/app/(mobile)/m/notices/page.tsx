import type { Metadata } from "next";

import { MemberNoticeBoard } from "@/components/notices/MemberNoticeBoard";

export const metadata: Metadata = {
  title: "공지사항 · 이용 가이드 | NINETY-NINE VINTAGE",
  robots: { index: false, follow: false },
};

export default function MobileNoticesPage() {
  return <MemberNoticeBoard />;
}
