import type { Metadata } from "next";
import { InquiryCenter } from "@/components/features/inquiry/InquiryCenter";
export const metadata: Metadata = { title: "1:1 고객 문의" };
export default function InquiryPage() { return <div className="space-y-8"><header><p className="eyebrow text-muted">CUSTOMER SUPPORT</p><h1 className="mt-3 text-4xl font-black tracking-[-.08em]">1:1 고객 문의</h1></header><InquiryCenter /></div>; }
