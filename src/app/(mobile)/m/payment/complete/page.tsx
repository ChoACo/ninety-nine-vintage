import type { Metadata } from "next";
import PaymentCompletePage from "@/app/(shop)/payment/complete/page";

export const metadata: Metadata = { title: "결제 결과", robots: { follow: false, index: false } };
export default function MobilePaymentCompletePage() { return <PaymentCompletePage />; }
