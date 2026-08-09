import type { Metadata } from "next";
import { PolicyPage } from "@/components/layout/PolicyPage";
import { privacyPolicyParagraphs } from "@/lib/legalPolicies";

export const metadata: Metadata = { title: "개인정보처리방침", alternates: { canonical: "/privacy", media: { "only screen and (max-width: 1279px)": "/m/privacy" } } };

export default function PrivacyPage() { return <PolicyPage eyebrow="서비스 안내 · 개인정보" title="개인정보처리방침" paragraphs={privacyPolicyParagraphs} />; }
