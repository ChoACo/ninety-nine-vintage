import type { Metadata } from "next";
import { InquiryCenter } from "@/components/features/inquiry/InquiryCenter";
export const metadata: Metadata = { title: "내 문의 내역" };
export default function MyInquiriesPage() { return <InquiryCenter listOnly />; }
