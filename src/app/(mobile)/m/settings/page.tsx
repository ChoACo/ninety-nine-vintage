import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = { title: "설정", robots: { follow: false, index: false } };

export default function MobileSettingsPage() {
  redirect("/m/account");
}
