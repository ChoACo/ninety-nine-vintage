import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function OperatorFulfillmentPage() {
  redirect("/admin/operator/storage");
}
