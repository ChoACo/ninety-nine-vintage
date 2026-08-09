import { OperatorPaymentsConsole } from "@/components/admin/operator/OperatorPaymentsConsole";
import { OwnerPaymentConfirmationQueue } from "@/components/admin/owner/OwnerPaymentConfirmationQueue";

export const dynamic = "force-dynamic";

export default function OwnerPaymentsPage() {
  return <><OwnerPaymentConfirmationQueue /><OperatorPaymentsConsole /></>;
}
