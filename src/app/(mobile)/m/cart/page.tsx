import type { Metadata } from "next";
import { CartExperience } from "@/components/features/cart/CartExperience";
import { StandaloneBackModal } from "@/components/layout/StandaloneBackModal";

export const metadata: Metadata = { title: "장바구니", robots: { follow: false, index: false } };
export default function MobileCartPage() { return <><StandaloneBackModal /><CartExperience basePath="/m" surface="mobile" /></>; }
