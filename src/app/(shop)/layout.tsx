import type { Metadata } from "next";
import { PcLayout } from "@/components/layout/PcLayout";

export const metadata: Metadata = {
  alternates: { canonical: "/home" },
};

export default function ShopLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <PcLayout>{children}</PcLayout>;
}
