import type { Metadata } from "next";
import { CartView } from "@/components/features/commerce/CartView";

export const metadata: Metadata = { title: "장바구니", robots: { follow: false, index: false } };
export default function MobileCartPage() { return <CartView basePath="/m" surface="mobile" />; }
