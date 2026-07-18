import type { Metadata } from "next";
import { OwnerPrivatePage } from "@/src/components/owner/OwnerPrivatePage";

export const metadata: Metadata = {
  title: "NINETY-NINE VINTAGE",
  robots: { index: false, follow: false, nocache: true },
};

export default function OwnerPage() {
  return <OwnerPrivatePage />;
}
