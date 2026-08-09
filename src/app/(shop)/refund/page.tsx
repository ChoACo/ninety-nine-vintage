import type { Metadata } from "next";
import { PolicyPage } from "@/components/layout/PolicyPage";
import { refundPolicyParagraphs } from "@/lib/legalPolicies";

export const metadata: Metadata = { title: "환불·취소 정책", alternates: { canonical: "/refund", media: { "only screen and (max-width: 1279px)": "/m/refund" } } };

export default function RefundPage() { return <PolicyPage eyebrow="서비스 안내 · 환불·취소" title="환불·취소 정책" paragraphs={refundPolicyParagraphs} />; }
