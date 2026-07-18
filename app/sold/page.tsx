import type { Metadata } from "next";

import { SoldArchivePage } from "@/src/components/sold/SoldArchivePage";

export const metadata: Metadata = {
  title: "판매 완료 상품 | 나인티 나인 빈티지",
  description: "판매 완료된 빈티지 상품의 낙찰가와 공개 닉네임을 확인합니다.",
};

export default function SoldPage() {
  return <SoldArchivePage />;
}
