import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

// Site status is currently managed from the owner dashboard. Keep the
// documented deep link valid while avoiding a second, divergent editor.
export default function OwnerSiteStatusPage() {
  redirect("/admin/owner");
}
