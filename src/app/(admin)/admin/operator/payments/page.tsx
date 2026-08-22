import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function OperatorPaymentsPage() {
  redirect("/admin/operator/orders");
}
