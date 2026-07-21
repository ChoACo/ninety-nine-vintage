import { PcLayout } from "@/components/layout/PcLayout";

export default function ShopLayout({ children, modal }: Readonly<{ children: React.ReactNode; modal: React.ReactNode }>) {
  return <PcLayout>{children}{modal}</PcLayout>;
}
