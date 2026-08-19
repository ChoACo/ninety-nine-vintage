import { redirect } from "next/navigation";

export default function LegacyMobileSettingsPage() {
  redirect("/m/settings");
}
