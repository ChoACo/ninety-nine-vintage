import type { Metadata } from "next";
import { PolicyPage } from "@/components/layout/PolicyPage";
export const metadata: Metadata = { title: "환불·취소 정책", alternates: { canonical: "/refund" } };
export default function MobileRefundPage() { return <PolicyPage eyebrow="서비스 안내 · 환불·취소" title="환불·취소 정책" paragraphs={["즉시구매 주문은 상품 잠금과 수동 입금 확인 상태를 기준으로 취소 가능 여부를 판단합니다.", "경매 낙찰 상품은 낙찰 후 결제 기한과 미결제 제재 정책이 적용됩니다.", "환불·취소의 최종 조건과 배송비 처리 기준은 정식 운영 정책 확정 후 이 페이지에 반영됩니다."]} />; }
