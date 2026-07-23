import type { Metadata } from "next";
import { PolicyPage } from "@/components/layout/PolicyPage";

export const metadata: Metadata = { title: "이용약관", alternates: { canonical: "/terms", media: { "only screen and (max-width: 1279px)": "/m/terms" } } };

export default function TermsPage() { return <PolicyPage eyebrow="서비스 안내 · 이용약관" title="이용약관" paragraphs={["NINETY-NINE VINTAGE는 빈티지 상품의 경매와 즉시구매를 제공하는 쇼핑 서비스입니다.", "경매 마감, 입찰, 낙찰, 수동 계좌이체 및 보관·합배송은 상품 상세와 주문 화면에 표시된 운영 기준을 따릅니다.", "정식 운영 약관의 최종 문구는 사업자 검토 후 이 페이지에 반영됩니다."]} />; }
