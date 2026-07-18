import type { Metadata } from "next";
import { OwnerPrivatePage } from "@/src/components/owner/OwnerPrivatePage";

export const metadata: Metadata = {
  title: "운영 보안 메뉴",
  robots: { index: false, follow: false, nocache: true },
};

export default function OwnerPage() {
  return <OwnerPrivatePage />;
}
