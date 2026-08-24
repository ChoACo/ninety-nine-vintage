import { OperatorOrdersConsole } from "@/components/admin/operator/OperatorOrdersConsole";
import { OperatorShippingConsole } from "@/components/admin/operator/OperatorShippingConsole";

export default function OperatorOrdersPage() {
  return (
    <div className="space-y-8">
      <OperatorOrdersConsole />
      <OperatorShippingConsole presentation="picking-summary" view="requests" />
    </div>
  );
}
