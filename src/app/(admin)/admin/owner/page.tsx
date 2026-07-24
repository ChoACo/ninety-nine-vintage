import { OwnerDashboard } from "@/components/admin/owner/OwnerDashboard";
import { canUseLocalTestAccounts } from "@/lib/localTestAccounts/config";

export const dynamic = "force-dynamic";

export default function OwnerPage() {
  return (
    <OwnerDashboard enableLocalTestMembers={canUseLocalTestAccounts()} />
  );
}
