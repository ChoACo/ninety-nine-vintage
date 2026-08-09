import type { Metadata } from "next";
import { PolicyPage } from "@/components/layout/PolicyPage";
import { termsPolicyParagraphs } from "@/lib/legalPolicies";
export const metadata: Metadata = { title: "이용약관", alternates: { canonical: "/terms" } };
export default function MobileTermsPage() { return <PolicyPage eyebrow="서비스 안내 · 이용약관" title="이용약관" paragraphs={termsPolicyParagraphs} />; }
