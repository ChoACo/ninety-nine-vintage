import { OwnerPlatformConsole } from "@/components/admin/owner/OwnerPlatformConsole";
import { OwnerPlanApprovalPanel } from "@/components/admin/owner/OwnerPlanApprovalPanel";
import { OwnerSiteAdministration } from "@/components/admin/owner/OwnerSiteAdministration";

export default function OwnerPlatformPage() {
  return <><OwnerSiteAdministration /><OwnerPlanApprovalPanel /><OwnerPlatformConsole /></>;
}
