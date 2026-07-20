import { PcLayout } from "@/components/layout/PcLayout";

export default function ShopLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <PcLayout>{children}</PcLayout>;
}
