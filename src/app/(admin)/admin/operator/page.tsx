import { OperatorConsole } from "@/components/admin/operator/OperatorConsole";
import { canUseLocalTestAccounts } from "@/lib/localTestAccounts/config";

export const dynamic = "force-dynamic";
export default function OperatorPage() {
  return (
    <OperatorConsole enableLocalTestMembers={canUseLocalTestAccounts()} />
  );
}
